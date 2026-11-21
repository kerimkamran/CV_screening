// S3-UP-10: the browser-test fixtures exist on a clean checkout once make-zips.mjs has run (no
// Python step), and the two large ZIPs are what their names say.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { ensureZips, OUT, TOO_MANY_ENTRIES } from '../../e2e/fixtures/make-zips.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every file named in e2e/fixtures/files.ts exists after make-zips.mjs', async () => {
  await ensureZips();
  const src = readFileSync(join(root, 'e2e/fixtures/files.ts'), 'utf8');
  const names = [...src.matchAll(/\b(?:file|built)\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(names.length >= 8, `found ${names.length} names`);
  const missing = names.filter((n) => !existsSync(join(OUT, n)));
  assert.deepEqual(missing, []);
});

test('too-many.zip holds more than 1,000 entries; oversize.zip holds one entry above 10 MB', async () => {
  await ensureZips();
  const many = await JSZip.loadAsync(readFileSync(join(OUT, 'too-many.zip')));
  const n = Object.values(many.files).filter((f) => !f.dir).length;
  assert.equal(n, TOO_MANY_ENTRIES);
  assert.ok(n > 1000);
  const big = await JSZip.loadAsync(readFileSync(join(OUT, 'oversize.zip')));
  const sizes = Object.values(big.files).map((f) => f._data?.uncompressedSize ?? 0);
  assert.equal(sizes.filter((s) => s > 10 * 1024 * 1024).length, 1);
});
