import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractTextWithPages, pageAt } from './documents';

const FIX = join(__dirname, '..', 'testing', 'fixtures');

describe('page numbers for quotations', () => {
  it('keeps where each PDF page starts in the stored text', async () => {
    const { text, pageStarts } = await extractTextWithPages(
      readFileSync(join(FIX, 'cv-two-pages.pdf')),
      'pdf',
    );
    expect(pageStarts).toHaveLength(2);
    expect(pageStarts![0]).toBe(0);
    const bgp = text.indexOf('BGP routing');
    const k8s = text.indexOf('Kubernetes');
    expect(pageAt(pageStarts, bgp)).toBe(1);
    expect(pageAt(pageStarts, k8s)).toBe(2);
    expect(text).not.toMatch(/\f|/);
  });
  it('has no pages for text and Word files, or a one-page PDF', async () => {
    const t = await extractTextWithPages(Buffer.from('plain text '.repeat(30)), 'txt');
    expect(t.pageStarts).toBeNull();
    const one = await extractTextWithPages(readFileSync(join(FIX, 'cv-dilara.pdf')), 'pdf');
    expect(one.pageStarts).toBeNull();
    expect(pageAt(null, 5)).toBeNull();
    expect(pageAt([0, 100], 99)).toBe(1);
    expect(pageAt([0, 100], 100)).toBe(2);
  });
});
