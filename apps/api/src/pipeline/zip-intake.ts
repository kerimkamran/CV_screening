import { isZipLitter, ZIP_ARCHIVE_NAME, ZIP_CV_NAME } from '@cv/shared';
import yauzl from 'yauzl';

/**
 * Safe unpacking of a ZIP of CVs (design spec 6.1.4; Stage 3, S3-UP-06). The archive is untrusted:
 * - it is read from a temp file with a streaming reader (`yauzl`), one entry at a time, so the
 *   archive itself is never held in memory (only the entry being taken in, at most its cap);
 * - the directory is read first and every skip is decided from it, so a skipped entry is never
 *   unpacked; an encrypted entry refuses the whole ZIP before anything is stored;
 * - names are only ever labels, never paths (nothing is written under an entry's name), and an
 *   entry that tries to climb out with ".." or an absolute path is skipped and reported;
 * - archives inside archives are not opened;
 * - limits on entries, on each file and on the total; the bytes are counted while reading and the
 *   reader also checks each entry's length against its header, so a bomb that lies is cut off;
 * - an entry that cannot be read becomes `bad_zip_entry` for that entry only;
 * - past the entry limit ONE row says so and the reading stops (S3-UP-06: bounded work);
 * - nothing is dropped silently: everything not unpacked comes back with a reason, except
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

const BAD_ENTRY = 'A file inside the ZIP could not be read';

/**
 * Tidy a name the way the earlier reader (JSZip `utils.resolve`) did, so labels and positions stay
 * the same: "." and empty middle parts go, ".." removes the part before it. A leading "/" and a
 * drive letter stay, and are reported as an unsafe path. Names are only ever labels.
 */
export function tidyName(path: string): string {
  const parts = path.split('/');
  const out: string[] = [];
  parts.forEach((part, i) => {
    if (part === '.' || (part === '' && i !== 0 && i !== parts.length - 1)) return;
    if (part === '..') out.pop();
    else out.push(part);
  });
  return out.join('/');
}

/** Decode a name ourselves (UTF-8 flag or CP437), so an unsafe path is a per-entry row. */
function nameOf(e: yauzl.Entry): string {
  const raw = e.fileName as unknown;
  if (typeof raw === 'string') return raw;
  return yauzl.getFileNameLowLevel(e.generalPurposeBitFlag, raw as Buffer, e.extraFields, false);
}

/** Read one entry, counting bytes as they come so a lying header cannot exhaust memory. */
async function readEntry(zip: yauzl.ZipFile, e: yauzl.Entry, cap: number) {
  const stream = await zip.openReadStreamPromise(e);
  const chunks: Buffer[] = [];
  let n = 0;
  try {
    for await (const c of stream as AsyncIterable<Buffer>) {
      n += c.length;
      if (n > cap) {
        stream.destroy();
        return 'too-big' as const;
      }
      chunks.push(c);
    }
  } catch (err) {
    stream.destroy();
    throw err;
  }
  return Buffer.concat(chunks);
}

/**
 * Entries one at a time. `index` counts the examined entries in directory order and is the stable
 * position of the entry inside its parent upload item, exactly as with the earlier in-memory reader.
 * `source` is a path to the spooled ZIP; a Buffer is accepted for tests and small callers.
 */
export async function* iterateZip(
  source: string | Buffer,
  limits: ZipLimits,
): AsyncGenerator<ZipEntry> {
  let zip: yauzl.ZipFile;
  const opts: yauzl.Options = {
    lazyEntries: true,
    autoClose: false,
    decodeStrings: false,
    validateEntrySizes: true,
  };
  try {
    zip =
      typeof source === 'string'
        ? await yauzl.openPromise(source, opts)
        : await yauzl.fromBufferPromise(source, opts);
  } catch {
    throw new ZipProblem("Couldn't open this ZIP file");
  }
  try {
    // Pass 1: the directory, up to the entry limit. Every skip is decided here.
    type Planned =
      | { kind: 'read'; e: yauzl.Entry; label: string }
      | { kind: 'skip'; label: string; reason: string; code: string };
    const plan: Planned[] = [];
    let seen = 0;
    let total = 0;
    let over = false;
    let overLabel = '';
    try {
      for await (const e of zip.eachEntry()) {
        const name = tidyName(nameOf(e).replaceAll('\\', '/'));
        if (name.endsWith('/') || isZipLitter(name)) continue;
        const label = name.split('/').slice(-2).join('/').slice(0, 200);
        if (++seen > limits.maxEntries) {
          over = true;
          overLabel = label;
          break;
        }
        if (e.isEncrypted()) throw new ZipProblem('This ZIP is protected with a password');
        const skip = (reason: string, code: string) =>
          plan.push({ kind: 'skip', label, reason, code });
        if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
          skip('Unsafe file path', 'unsafe_path');
          continue;
        }
        if (ZIP_ARCHIVE_NAME.test(name)) {
          skip('An archive inside the ZIP is not opened', 'nested_archive');
          continue;
        }
        if (!ZIP_CV_NAME.test(name)) {
          skip('Only PDF, DOCX, TXT and MD files', 'wrong_type');
          continue;
        }
        const declared = e.uncompressedSize;
        const packed = Math.max(e.compressedSize, 1);
        if (declared > limits.maxEntryBytes) {
          skip('Over the size limit', 'too_large');
          continue;
        }
        if (declared / packed > limits.maxRatio && declared > 1024 * 1024) {
          skip('Unusually compressed, not opened', 'suspicious_ratio');
          continue;
        }
        if (total + declared > limits.maxTotalBytes) {
          skip('The ZIP is larger than the limit', 'zip_too_large');
          continue;
        }
        total += declared;
        plan.push({ kind: 'read', e, label });
      }
    } catch (err) {
      if (err instanceof ZipProblem) throw err;
      throw new ZipProblem("Couldn't open this ZIP file");
    }

    // Pass 2: unpack what the directory allowed, in the same order, one entry in memory at a time.
    let index = 0;
    let read = 0;
    for (const p of plan) {
      if (p.kind === 'skip') {
        yield { kind: 'skipped', index: index++, name: p.label, reason: p.reason, code: p.code };
        continue;
      }
      let data: Buffer | 'too-big';
      try {
        data = await readEntry(
          zip,
          p.e,
          Math.min(limits.maxEntryBytes, Math.max(limits.maxTotalBytes - read, 0)),
        );
      } catch {
        yield {
          kind: 'skipped',
          index: index++,
          name: p.label,
          reason: BAD_ENTRY,
          code: 'bad_zip_entry',
        };
        continue;
      }
      if (data === 'too-big') {
        yield {
          kind: 'skipped',
          index: index++,
          name: p.label,
          reason: 'Over the size limit',
          code: 'too_large',
        };
        continue;
      }
      read += data.length;
      yield { kind: 'file', index: index++, name: p.label, data };
    }
    if (over) {
      yield {
        kind: 'skipped',
        index: index++,
        name: overLabel,
        reason: 'Too many files in the ZIP',
        code: 'too_many_entries',
      };
    }
  } finally {
    zip.close();
  }
}

export async function unpackZip(source: string | Buffer, limits: ZipLimits): Promise<Unpacked> {
  const out: Unpacked = { files: [], skipped: [] };
  for await (const e of iterateZip(source, limits)) {
    if (e.kind === 'file') out.files.push({ name: e.name, data: e.data });
    else out.skipped.push({ name: e.name, reason: e.reason, code: e.code });
  }
  return out;
}
