import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

/**
 * A ZIP upload goes to a private temp file, never into memory (Stage 3, S3-UP-06).
 * - Where: `os.tmpdir()`, in its own folder from `mkdtemp` (mode 0700), named
 *   `cv-zip-<pid>-…`, the file mode 0600. Same pattern as the Word conversion (`docx-convert.ts`).
 * - At most the byte cap reaches the disk: beyond it the stream is drained and counted, not written.
 * - The caller removes the folder in `finally`; a boot sweep removes the folders of dead processes.
 */

export const SPOOL_PREFIX = 'cv-zip-';

export interface Spooled {
  dir: string;
  path: string;
  /** Bytes that arrived (all of them, also past the cap). */
  bytes: number;
  tooLarge: boolean;
  /** The first bytes of the file, to tell a real ZIP ("PK") from a renamed file. */
  head: Buffer;
}

/** Free space in the temp folder, in bytes; null when the platform cannot tell. */
export async function freeTempBytes(dir = tmpdir()): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** Write a stream to a new private temp file, keeping at most `cap` bytes. */
export async function spoolToTemp(
  stream: AsyncIterable<Buffer | string>,
  cap: number,
  base = tmpdir(),
): Promise<Spooled> {
  const dir = await mkdtemp(join(base, `${SPOOL_PREFIX}${process.pid}-`));
  const path = join(dir, 'upload.zip');
  let bytes = 0;
  let kept = 0;
  const head: Buffer[] = [];
  let headLen = 0;
  const limiter = new Transform({
    transform(raw: Buffer | string, _enc, done) {
      const c = typeof raw === 'string' ? Buffer.from(raw) : raw;
      bytes += c.length;
      if (headLen < 8) {
        head.push(c.subarray(0, 8 - headLen));
        headLen += Math.min(c.length, 8 - headLen);
      }
      if (kept >= cap) return done();
      const room = cap - kept;
      const part = c.length <= room ? c : c.subarray(0, room);
      kept += part.length;
      done(null, part);
    },
  });
  try {
    await pipeline(stream, limiter, createWriteStream(path, { mode: 0o600 }));
  } catch (e) {
    await removeSpool(dir);
    throw e;
  }
  return { dir, path, bytes, tooLarge: bytes > cap, head: Buffer.concat(head) };
}

/** Remove a spool folder. Never throws. */
export async function removeSpool(dir: string | undefined): Promise<void> {
  if (!dir) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * At boot: remove every `cv-zip-*` folder left by a crash. A folder of this very process is removed
 * too (nothing is in flight at boot; containers reuse the same process ID); a folder of another
 * LIVE process stays, so parallel test workers do not delete each other's files.
 */
export async function sweepSpools(base = tmpdir()): Promise<number> {
  let removed = 0;
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return 0;
  }
  for (const n of names) {
    const m = new RegExp(`^${SPOOL_PREFIX}(\\d+)-`).exec(n);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid !== process.pid && alive(pid)) continue;
    await removeSpool(join(base, n));
    removed++;
  }
  return removed;
}
