import JSZip from 'jszip';

/**
 * Safe unpacking of a ZIP of resumes (design spec 6.1.4). The archive is untrusted:
 * - names are only ever used as labels, never as paths (no file is written to disk), and an entry
 *   that tries to climb out with ".." or an absolute path is skipped and reported;
 * - archives inside archives are not opened;
 * - limits on entries, on each file and on the total, and the bytes are counted while reading, so a
 *   decompression bomb that lies about its size is cut off;
 * - nothing is dropped silently: everything that is not unpacked comes back with a reason, except
 *   operating-system litter (folders, __MACOSX, .DS_Store, Office lock files).
 */

export interface ZipLimits {
  /** Entries examined at most. */
  maxEntries: number;
  /** One unpacked file, in bytes. */
  maxEntryBytes: number;
  /** All unpacked files together, in bytes. */
  maxTotalBytes: number;
  /** Declared unpacked size over packed size above which an entry is refused. */
  maxRatio: number;
}

export interface Unpacked {
  files: { name: string; data: Buffer }[];
  skipped: { name: string; reason: string; code?: string }[];
}

/** One thing found in a ZIP: a file to take in, or an entry that was skipped (with its reason). */
export type ZipEntry =
  | { kind: 'file'; index: number; name: string; data: Buffer }
  | { kind: 'skipped'; index: number; name: string; reason: string; code: string };

export class ZipProblem extends Error {}

const WANTED = /\.(pdf|docx|txt)$/i;
const ARCHIVE = /\.(zip|rar|7z|gz|tgz|tar|bz2|xz)$/i;

const isLitter = (path: string) => {
  const parts = path.split('/');
  const base = parts[parts.length - 1] ?? '';
  return (
    parts.includes('__MACOSX') ||
    base === '' ||
    base === '.DS_Store' ||
    base === 'Thumbs.db' ||
    base === 'desktop.ini' ||
    base.startsWith('~$') ||
    base.startsWith('._')
  );
};

/** Read one entry, counting bytes as they come so a lying header cannot exhaust memory. */
function readCapped(entry: JSZip.JSZipObject, cap: number): Promise<Buffer | 'too-big'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    const stream = entry.nodeStream('nodebuffer');
    stream.on('data', (c: Buffer) => {
      n += c.length;
      if (n > cap) {
        stream.removeAllListeners();
        stream.on('error', () => undefined);
        (stream as unknown as { destroy?: () => void }).destroy?.();
        return resolve('too-big');
      }
      chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Entries one at a time (S2-BE2): only one unpacked file is in memory at once, so a ZIP of 100 CVs
 * costs the size of its largest CV, not the sum. `index` counts the examined entries, in order, and
 * is the stable position of the entry inside its parent upload item.
 */
export async function* iterateZip(buf: Buffer, limits: ZipLimits): AsyncGenerator<ZipEntry> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf, { checkCRC32: false });
  } catch {
    throw new ZipProblem("Couldn't open this ZIP file");
  }
  let total = 0;
  let seen = 0;
  let index = 0;
  for (const [rawName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const name = rawName.replaceAll('\\', '/');
    if (isLitter(name)) continue;
    const label = name.split('/').slice(-2).join('/').slice(0, 200);
    const skip = (reason: string, code: string): ZipEntry => ({
      kind: 'skipped',
      index: index++,
      name: label,
      reason,
      code,
    });
    if (++seen > limits.maxEntries) {
      yield skip('Too many files in the ZIP', 'too_many_entries');
      continue;
    }
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
      yield skip('Unsafe file path', 'unsafe_path');
      continue;
    }
    if (ARCHIVE.test(name)) {
      yield skip('An archive inside the ZIP is not opened', 'nested_archive');
      continue;
    }
    if (!WANTED.test(name)) {
      yield skip('Only PDF, DOCX and TXT files', 'wrong_type');
      continue;
    }
    const meta = (
      entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } }
    )._data;
    const declared = meta?.uncompressedSize ?? 0;
    const packed = Math.max(meta?.compressedSize ?? 1, 1);
    if (declared > limits.maxEntryBytes) {
      yield skip('Over the size limit', 'too_large');
      continue;
    }
    if (declared / packed > limits.maxRatio && declared > 1024 * 1024) {
      yield skip('Unusually compressed, not opened', 'suspicious_ratio');
      continue;
    }
    if (total + declared > limits.maxTotalBytes) {
      yield skip('The ZIP is larger than the limit', 'zip_too_large');
      continue;
    }
    const data = await readCapped(
      entry,
      Math.min(limits.maxEntryBytes, limits.maxTotalBytes - total),
    );
    if (data === 'too-big') {
      yield skip('Over the size limit', 'too_large');
      continue;
    }
    total += data.length;
    yield { kind: 'file', index: index++, name: label, data };
  }
}

export async function unpackZip(buf: Buffer, limits: ZipLimits): Promise<Unpacked> {
  const out: Unpacked = { files: [], skipped: [] };
  for await (const e of iterateZip(buf, limits)) {
    if (e.kind === 'file') out.files.push({ name: e.name, data: e.data });
    else out.skipped.push({ name: e.name, reason: e.reason, code: e.code });
  }
  return out;
}
