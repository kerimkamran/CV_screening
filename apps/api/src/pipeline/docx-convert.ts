import { execFile, spawn } from 'node:child_process';
import { constants as fsc } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotWordError, sanitizeDocx } from './docx-sanitize';

/**
 * Word to PDF with LibreOffice, run as a hardened child process (Stage 2, S2-BE7).
 *
 * The file is sanitised first (see docx-sanitize.ts). The converter then runs:
 *  - with a minimal, explicit environment, never the API's own (which holds the session and
 *    encryption secrets);
 *  - with the import filter forced to Word 2007 XML, so a renamed ODT or RTF is refused;
 *  - in a private temp directory (mode 0700) and a profile that turns off macros and link updates;
 *  - at low priority, in its own process group, killed as a whole after 60 seconds.
 * Output over 20 MB or 50 pages is refused. The temp directory is removed in `finally`.
 */

export class RenditionError extends Error {
  constructor(
    message: string,
    /** False when trying again cannot help (not a Word file, too big, too many pages). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'RenditionError';
  }
}

export const LIMITS = { timeoutMs: 60_000, maxPdfBytes: 20 * 1024 * 1024, maxPages: 50 };
const TMP_PREFIX = 'cv-rendition-';

export interface ConvertOptions {
  soffice?: string;
  timeoutMs?: number;
  maxPdfBytes?: number;
  maxPages?: number;
  /** A profile directory kept between conversions (faster start); a fresh one per call by default. */
  profileDir?: string;
}

/** The profile settings: no macros, no link or field updates, no OpenCL. */
const PROFILE_XCU = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Field" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Chart" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseOpenCL" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="ShowTipOfTheDay" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
`;

export async function prepareProfile(dir: string): Promise<void> {
  await mkdir(join(dir, 'user'), { recursive: true, mode: 0o700 });
  await writeFile(join(dir, 'user', 'registrymodifications.xcu'), PROFILE_XCU, { mode: 0o600 });
}

/** Is the converter installed? Looks the name up on PATH, or checks the path given. */
export async function converterAvailable(soffice = 'soffice'): Promise<boolean> {
  const dirs = soffice.includes('/') ? [''] : (process.env['PATH'] ?? '').split(':');
  for (const d of dirs) {
    try {
      await access(d ? join(d, soffice) : soffice, fsc.X_OK);
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/** Remove what an earlier process left behind (a crash during a conversion). */
export async function sweepTemp(): Promise<number> {
  const { readdir } = await import('node:fs/promises');
  let n = 0;
  try {
    for (const name of await readdir(tmpdir())) {
      if (!name.startsWith(TMP_PREFIX)) continue;
      await rm(join(tmpdir(), name), { recursive: true, force: true }).then(
        () => n++,
        () => undefined,
      );
    }
  } catch {
    /* nothing to sweep */
  }
  return n;
}

function pagesOf(file: string, bytes: Buffer): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'pdfinfo',
      [file],
      { timeout: 10_000, env: { PATH: process.env['PATH'] ?? '' } },
      (err, out) => {
        const m = !err && /^Pages:\s+(\d+)/m.exec(String(out));
        if (m) return resolve(Number(m[1]));
        // No pdfinfo: count page objects.
        resolve((bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length);
      },
    );
  });
}

function runConverter(
  args: string[],
  opts: { soffice: string; cwd: string; home: string; timeoutMs: number },
) {
  return new Promise<{ code: number | null; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(opts.soffice, args, {
      cwd: opts.cwd,
      detached: true, // its own process group, so a timeout can kill every helper it started
      stdio: 'ignore',
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: opts.home,
        TMPDIR: opts.cwd,
        LANG: 'C.UTF-8',
        SAL_USE_VCLPLUGIN: 'svp',
      },
    });
    let timedOut = false;
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    };
    try {
      if (child.pid) setPriority(child.pid, 10);
    } catch {
      /* a lower priority is a courtesy, not a requirement */
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, opts.timeoutMs);
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      killGroup(); // helpers that outlive the launcher
      resolve({ code, timedOut });
    });
  });
}

export async function convertDocxToPdf(
  docx: Buffer,
  o: ConvertOptions = {},
): Promise<{ pdf: Buffer; pages: number }> {
  const soffice = o.soffice ?? 'soffice';
  const maxPdf = o.maxPdfBytes ?? LIMITS.maxPdfBytes;
  const maxPages = o.maxPages ?? LIMITS.maxPages;
  let clean: Buffer;
  try {
    clean = await sanitizeDocx(docx);
  } catch (e) {
    if (e instanceof NotWordError) throw new RenditionError(e.message, false);
    throw new RenditionError('This Word file could not be prepared.', false);
  }
  const dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  try {
    const input = join(dir, 'cv.docx');
    const outDir = join(dir, 'out');
    await mkdir(outDir, { mode: 0o700 });
    await writeFile(input, clean, { mode: 0o600 });
    const profile = o.profileDir ?? join(dir, 'profile');
    await prepareProfile(profile);
    const { code, timedOut } = await runConverter(
      [
        '--headless',
        '--norestore',
        '--nologo',
        '--nodefault',
        '--nolockcheck',
        '--nofirststartwizard',
        `-env:UserInstallation=file://${profile}`,
        '--infilter=MS Word 2007 XML',
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        outDir,
        input,
      ],
      { soffice, cwd: dir, home: dir, timeoutMs: o.timeoutMs ?? LIMITS.timeoutMs },
    ).catch((e: NodeJS.ErrnoException) => {
      throw new RenditionError(
        e.code === 'ENOENT'
          ? 'The converter is not installed.'
          : `The converter could not start: ${e.message}`,
        false,
      );
    });
    if (timedOut) throw new RenditionError('The conversion took too long.', true);
    const out = join(outDir, 'cv.pdf');
    const size = await stat(out).then(
      (s) => s.size,
      () => 0,
    );
    if (code !== 0 || size === 0)
      throw new RenditionError('The converter produced no pages.', true);
    if (size > maxPdf) throw new RenditionError('The converted file is too large.', false);
    const pdf = await readFile(out);
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new RenditionError('The converter produced no pages.', true);
    const pages = await pagesOf(out, pdf);
    if (pages > maxPages)
      throw new RenditionError(`This file has more than ${maxPages} pages.`, false);
    return { pdf, pages };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
