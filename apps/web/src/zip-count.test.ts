import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { countZipCvs, estimateZipCvs, ZIP_TAIL_BYTES } from './zip-count';

/** "About n CVs" for a ZIP (S3-UP-08): the directory only, at most the last 1 MB + 64 KB. */

const zipOf = async (entries: Record<string, string>, comment?: string) => {
  const z = new JSZip();
  for (const [n, d] of Object.entries(entries)) z.file(n, d);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', comment });
};

describe('countZipCvs', () => {
  it('counts CV names: 3 CVs and a photo give 3', async () => {
    const buf = await zipOf({ 'a.pdf': 'x', 'b.docx': 'x', 'c/d.txt': 'x', 'photo.jpg': 'x' });
    expect(countZipCvs(buf, buf.length)).toBe(3);
  });

  it('leaves out folders, system litter and nested archives (the server rules)', async () => {
    const buf = await zipOf({
      'cv.md': 'x',
      '__MACOSX/._cv.md': 'x',
      '.DS_Store': 'x',
      '~$lock.docx': 'x',
      'inner.zip': 'x',
      'old.doc': 'x',
    });
    expect(countZipCvs(buf, buf.length)).toBe(1);
  });

  it('finds the end record behind a comment', async () => {
    const buf = await zipOf({ 'a.pdf': 'x' }, 'c'.repeat(500));
    expect(countZipCvs(buf, buf.length)).toBe(1);
  });

  it('more than 1,000 CV names show 1,000 (the most the server examines)', async () => {
    const entries = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`f${i}.txt`, '']));
    const buf = await zipOf(entries);
    expect(countZipCvs(buf, buf.length)).toBe(1000);
  });

  it('cannot tell: no end record, or a directory that does not fit in the bytes read', async () => {
    expect(countZipCvs(new TextEncoder().encode('not a zip at all'), 16)).toBeNull();
    const buf = await zipOf({ 'a.pdf': 'x', 'b.pdf': 'y' });
    // Pretend only the last 30 bytes were read: the directory starts before them.
    const tail = buf.subarray(buf.length - 30);
    expect(countZipCvs(tail, buf.length)).toBeNull();
  });
});

describe('estimateZipCvs', () => {
  it('reads at most the last 1 MB + 64 KB, never the whole file', async () => {
    const real = await zipOf({ 'a.pdf': 'x' });
    const size = 90 * 1024 * 1024;
    const asked: [number, number][] = [];
    const fake = {
      size,
      slice(start: number, end: number) {
        asked.push([start, end]);
        return new Blob([real as BlobPart]);
      },
    } as unknown as Blob;
    await estimateZipCvs(fake);
    expect(asked).toHaveLength(1);
    expect(asked[0]![1] - asked[0]![0]).toBeLessThanOrEqual(ZIP_TAIL_BYTES);
    expect(asked[0]![1]).toBe(size);
  });

  it('a ZIP file gives its count; anything unreadable gives null, never an error', async () => {
    const buf = await zipOf({ 'a.pdf': 'x', 'b.txt': 'y' });
    expect(await estimateZipCvs(new Blob([buf as BlobPart]))).toBe(2);
    expect(await estimateZipCvs(new Blob(['PK nope']))).toBeNull();
  });
});
