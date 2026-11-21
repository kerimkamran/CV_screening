import { isZipCvName, MAX_ZIP_ENTRIES } from '@cv/shared';

/**
 * "About n CVs" for a ZIP before it is sent (Stage 3, S3-UP-08). Reads only the end of the file
 * (at most 1 MB + 64 KB: 64 KB to find the end record, 1 MB for the directory) and counts the names
 * in its directory with the same rules as the server's reader (`@cv/shared` zip-names). Nothing is
 * unpacked, and the server never trusts this number: it is a hint for the room warning only.
 * Returns null when it cannot tell (no readable directory, or one that does not fit in the bytes
 * read); the file is still sent.
 */

export const ZIP_TAIL_BYTES = 1024 * 1024 + 64 * 1024;

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;

const utf8 = new TextDecoder('utf-8');
const latin = new TextDecoder('latin1');

/** Count CV names in a ZIP's directory, from the last bytes of the file. */
export function countZipCvs(tail: Uint8Array, fileSize: number): number | null {
  const v = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const tailStart = fileSize - tail.byteLength;
  // The end record is at least 22 bytes from the end; a comment can push it up to 64 KB further.
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= Math.max(0, tail.byteLength - 22 - 65_535); i--) {
    if (v.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  let entries = v.getUint16(eocd + 10, true);
  let cdSize = v.getUint32(eocd + 12, true);
  let cdOffset = v.getUint32(eocd + 16, true);
  // ZIP64: the real numbers are in the ZIP64 end record, found through its locator.
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || v.getUint32(loc, true) !== ZIP64_LOCATOR) return null;
    const recAbs = Number(v.getBigUint64(loc + 8, true));
    const rec = recAbs - tailStart;
    if (rec < 0 || rec + 56 > tail.byteLength || v.getUint32(rec, true) !== ZIP64_EOCD) return null;
    entries = Number(v.getBigUint64(rec + 32, true));
    cdSize = Number(v.getBigUint64(rec + 40, true));
    cdOffset = Number(v.getBigUint64(rec + 48, true));
  }
  let p = cdOffset - tailStart;
  if (p < 0 || p + cdSize > tail.byteLength) return null; // the directory does not fit
  let count = 0;
  for (let k = 0; k < entries; k++) {
    if (p + 46 > tail.byteLength || v.getUint32(p, true) !== CENTRAL) return null;
    const flags = v.getUint16(p + 8, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const raw = tail.subarray(p + 46, p + 46 + nameLen);
    const name = ((flags & 0x800) !== 0 ? utf8 : latin).decode(raw).replaceAll('\\', '/');
    if (!name.endsWith('/') && isZipCvName(name)) count++;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return Math.min(count, MAX_ZIP_ENTRIES);
}

/** Read at most the last 1 MB + 64 KB of a ZIP `File` and count its CVs (null: cannot tell). */
export async function estimateZipCvs(file: Blob): Promise<number | null> {
  try {
    const start = Math.max(0, file.size - ZIP_TAIL_BYTES);
    const buf = new Uint8Array(await file.slice(start, file.size).arrayBuffer());
    return countZipCvs(buf, file.size);
  } catch {
    return null;
  }
}
