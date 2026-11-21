#!/usr/bin/env node
// Writes the two large ZIP fixtures of the browser tests in Node, with the installed JSZip, so a
// clean checkout and CI need no Python step (S3-UP-10). Fixed bytes, not random: the same file every
// time. Every person is invented.
//   oversize.zip : one CV and one STORED entry of 11 MB (over the 10 MB per-file limit)
//   too-many.zip : 1,100 tiny CVs (over the 1,000 entries the server examines in one ZIP)
//   node e2e/fixtures/make-zips.mjs           write both (missing ones only, unless --force)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

export const OUT = join(dirname(fileURLToPath(import.meta.url)), 'files');
export const TOO_MANY_ENTRIES = 1100;
const cv = (name, lines) =>
  `Name: ${name}\n${lines.join('\n')}\n${'Padding text for length. '.repeat(10)}`;

/** 11 MB of fixed, hardly compressible bytes (a simple generator, the same on every machine). */
function fixedBytes(n) {
  const b = Buffer.alloc(n);
  let x = 2463534242;
  for (let i = 0; i < n; i += 4) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    b.writeUInt32LE(x >>> 0, i);
  }
  return b;
}

export async function makeOversize(path = join(OUT, 'oversize.zip')) {
  const z = new JSZip();
  z.file('small-cv.txt', cv('Oversize Zip Person', ['BGP routing.']), { compression: 'DEFLATE' });
  z.file('big.txt', fixedBytes(11 * 1024 * 1024), { compression: 'STORE' });
  writeFileSync(
    path,
    await z.generateAsync({ type: 'nodebuffer', date: new Date(Date.UTC(2026, 0, 1)) }),
  );
  return path;
}

export async function makeTooMany(path = join(OUT, 'too-many.zip')) {
  const z = new JSZip();
  const date = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < TOO_MANY_ENTRIES; i++)
    z.file(`cv-${String(i).padStart(4, '0')}.txt`, cv(`Many Person ${i}`, ['BGP routing.']), {
      date,
    });
  writeFileSync(path, await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return path;
}

/** Make the two files when missing (or always, with force). */
export async function ensureZips({ force = false } = {}) {
  mkdirSync(OUT, { recursive: true });
  const o = join(OUT, 'oversize.zip');
  const t = join(OUT, 'too-many.zip');
  if (force || !existsSync(o)) await makeOversize(o);
  if (force || !existsSync(t)) await makeTooMany(t);
  return { oversize: o, tooMany: t };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await ensureZips({ force: process.argv.includes('--force') });
  console.log('zip fixtures:', r);
}
