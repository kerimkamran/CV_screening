import { crc32 } from 'node:zlib';

/**
 * A plain ZIP writer for "Download CVs" (Stage 2, S2-BE8). STORE only (CVs are PDFs and Word files,
 * which are compressed already), UTF-8 names, no ZIP64: the download limits (500 files, 1 GB) keep
 * every offset under 4 GB. Because nothing is compressed the exact length is known before the first
 * byte, so phones show a real progress bar.
 */

export interface ZipEntry {
  name: string;
  size: number;
  modified: Date;
}

const LOCAL = 30;
const CENTRAL = 46;
const END = 22;

/** Cleans an original filename for the archive. An empty result becomes `cv.<ext>`. */
export function safeName(name: string, ext = 'pdf'): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 180);
  return base || `cv.${ext}`;
}

/** Makes names unique without regard to case: `cv.pdf`, `cv (2).pdf`, `cv (3).pdf`. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    const dot = n.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, ''];
    let out = n;
    for (let i = 2; seen.has(out.toLowerCase()); i++) out = `${stem} (${i})${ext}`;
    seen.add(out.toLowerCase());
    return out;
  });
}

/** The exact size of the archive these entries make. */
export function zipLength(entries: ZipEntry[]): number {
  let n = END;
  for (const e of entries) {
    const len = Buffer.byteLength(e.name, 'utf8');
    n += LOCAL + len + e.size + CENTRAL + len;
  }
  return n;
}

function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/**
 * Writes an archive one file at a time. `add` returns the bytes to send for that file (its header
 * and its content); `finish` returns the directory and the end record. The caller sends the pieces
 * in order and may stop early (a cancelled download).
 */
export class ZipStream {
  private offset = 0;
  private readonly central: Buffer[] = [];
  private count = 0;

  add(name: string, data: Buffer, modified: Date): Buffer[] {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const { time, date } = dosTime(modified);
    const local = Buffer.alloc(LOCAL);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const c = Buffer.alloc(CENTRAL);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt16LE(0, 30); // extra
    c.writeUInt16LE(0, 32); // comment
    c.writeUInt16LE(0, 34); // disk
    c.writeUInt16LE(0, 36); // internal attributes
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
    c.writeUInt32LE(this.offset, 42);
    this.central.push(c, nameBuf);
    this.offset += LOCAL + nameBuf.length + data.length;
    this.count++;
    return [local, nameBuf, data];
  }

  finish(): Buffer[] {
    const size = this.central.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(END);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(this.offset, 16);
    end.writeUInt16LE(0, 20);
    return [...this.central, end];
  }
}
