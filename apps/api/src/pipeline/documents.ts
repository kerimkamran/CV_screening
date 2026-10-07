import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const MAX_TEXT_CHARS = 60_000;
export const MIN_READABLE_CHARS = 200;

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export type Kind = 'pdf' | 'docx' | 'txt';

/** Decide the format from content, not the filename: magic bytes first. */
export function sniff(buf: Buffer, filename: string): Kind | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b)
    return filename.toLowerCase().endsWith('.docx') ? 'docx' : null;
  if (/\.(txt|md)$/i.test(filename) && !buf.subarray(0, 4096).includes(0)) return 'txt';
  return null;
}

export const MIME: Record<Kind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/** Canonical text form. Evidence offsets are defined against exactly this string. */
export function normalizeText(raw: string): string {
  return raw
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A PDF's text with the offsets where each page starts, so a quotation can be given a page. */
export interface TextWithPages {
  text: string;
  /** Offsets into `text` where pages 1, 2, 3 … start; null when the format has no fixed pages. */
  pageStarts: number[] | null;
}

const PAGE = '\uE000';

export async function extractTextWithPages(buf: Buffer, kind: Kind): Promise<TextWithPages> {
  if (kind !== 'pdf') return { text: await extractText(buf, kind), pageStarts: null };
  const raw = (await pdfToText(buf, 20_000, 5_000_000, true)).replaceAll('\f', PAGE);
  const pages = normalizeText(raw)
    .split(PAGE)
    .map((p) => p.trim());
  let text = '';
  const pageStarts: number[] = [];
  for (const [i, page] of pages.entries()) {
    if (!page && i === pages.length - 1) break; // pdftotext ends the last page with a break
    if (text) text += '\n\n';
    pageStarts.push(text.length);
    text += page;
  }
  return { text, pageStarts: pageStarts.length > 1 ? pageStarts : null };
}

/** 1-based page that holds a character offset; null when pages are not known. */
export function pageAt(pageStarts: number[] | null | undefined, offset: number): number | null {
  if (!pageStarts?.length) return null;
  let page = 1;
  for (const [i, start] of pageStarts.entries()) {
    if (start <= offset) page = i + 1;
    else break;
  }
  return page;
}

export async function extractText(buf: Buffer, kind: Kind): Promise<string> {
  switch (kind) {
    case 'pdf':
      return normalizeText(await pdfToText(buf));
    case 'docx': {
      const mammoth = await import('mammoth');
      return normalizeText((await mammoth.extractRawText({ buffer: buf })).value);
    }
    default:
      return normalizeText(buf.toString('utf8'));
  }
}

/**
 * Poppler's pdftotext, fed over stdin so nothing touches disk. Chosen over pure-JS parsers for
 * robustness on real-world CVs. A hard timeout and output cap bound a hostile or pathological file.
 */
export function pdfToText(
  buf: Buffer,
  timeoutMs = 20_000,
  maxBytes = 5_000_000,
  keepPageBreaks = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pdftotext',
      ['-enc', 'UTF-8', ...(keepPageBreaks ? [] : ['-nopgbrk']), '-', '-'],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) child.kill('SIGKILL');
      else chunks.push(c);
    });
    child.on('error', (e) => (clearTimeout(timer), reject(e)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && size <= maxBytes) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`pdftotext exited ${code}`));
    });
    child.stdin.on('error', () => undefined); // the child may exit before reading everything
    child.stdin.end(buf);
  });
}

/** Why a vacancy Word file cannot be used. The message is shown to the recruiter as is. */
export class VacancyFileProblem extends Error {}

/**
 * Text of a vacancy (job description) Word file for the Home screen. Nothing is stored here: the
 * recruiter reviews the text, and it is saved with the vacancy only when they start a screening.
 */
export async function readVacancyDocx(buf: Buffer, filename: string): Promise<string> {
  const isCfb = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  if (isCfb) {
    // Both an old .doc and a password-protected .docx are OLE containers.
    throw new VacancyFileProblem(
      /\.doc$/i.test(filename)
        ? 'Save it as .docx and try again'
        : 'This file is locked with a password',
    );
  }
  if (sniff(buf, filename) !== 'docx') throw new VacancyFileProblem('Only Word files (.docx) here');
  let text: string;
  try {
    text = await extractText(buf, 'docx');
  } catch {
    throw new VacancyFileProblem("Couldn't find text in this file");
  }
  if (text.length < 20) throw new VacancyFileProblem("Couldn't find text in this file");
  return text.slice(0, 40_000);
}
