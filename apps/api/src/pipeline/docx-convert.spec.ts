import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { convertDocxToPdf, converterAvailable, RenditionError } from './docx-convert';
import { NotWordError, sanitizeDocx } from './docx-sanitize';

const fx = (n: string) => readFileSync(join(__dirname, '../testing/fixtures', n));

/** Point a fixture at a local file and a local port: the leak checks need targets we can watch. */
async function retarget(buf: Buffer, map: Record<string, string>) {
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name]!.dir) continue;
    let s = await zip.file(name)!.async('string');
    let changed = false;
    for (const [from, to] of Object.entries(map))
      if (s.includes(from)) {
        s = s.split(from).join(to);
        changed = true;
      }
    if (changed) zip.file(name, s);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

const textOf = (pdf: Buffer) => {
  const dir = mkdtempSync(join(tmpdir(), 'pdftxt-'));
  try {
    writeFileSync(join(dir, 'a.pdf'), pdf);
    return execFileSync('pdftotext', [join(dir, 'a.pdf'), '-'], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('sanitizeDocx', () => {
  it('keeps a normal Word file readable', async () => {
    const out = await sanitizeDocx(fx('cv-dilara.docx'));
    const zip = await JSZip.loadAsync(out);
    expect(zip.file('word/document.xml')).toBeTruthy();
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
  });

  it('refuses a renamed ODT, a text file and a plain ZIP', async () => {
    await expect(sanitizeDocx(fx('renamed-odt.docx'))).rejects.toBeInstanceOf(NotWordError);
    await expect(sanitizeDocx(Buffer.from('just text'))).rejects.toBeInstanceOf(NotWordError);
    const z = new JSZip();
    z.file('hello.txt', 'hi');
    await expect(
      sanitizeDocx(await z.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toBeInstanceOf(NotWordError);
  });

  it('removes fields that read from elsewhere, external relationships (not hyperlinks) and templates', async () => {
    const out = await sanitizeDocx(fx('hostile-field.docx'));
    const zip = await JSZip.loadAsync(out);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).not.toMatch(/INCLUDETEXT|DDEAUTO/);
    expect(doc).toContain('shown-result'); // what the field last showed stays
    expect(doc).toContain('dde-result');
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(rels).not.toContain('127.0.0.1');
    expect(rels).toContain('https://example.org/'); // a link that is only shown is kept
    const settings = await zip.file('word/settings.xml')!.async('string');
    expect(settings).not.toContain('attachedTemplate');
  });
});

describe('convertDocxToPdf (real LibreOffice)', () => {
  let available = false;
  beforeAll(async () => {
    available = await converterAvailable();
  });
  const need = (fn: () => Promise<void>) => async () => {
    if (!available) return console.warn('soffice is not installed: conversion test skipped');
    await fn();
  };

  it(
    'converts a Word CV and keeps Azerbaijani and Cyrillic text',
    need(async () => {
      const { pdf, pages } = await convertDocxToPdf(fx('cv-az-fonts.docx'));
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pages).toBe(1);
      const t = textOf(pdf);
      expect(t).toContain('Şəbəkə mühəndisi');
      expect(t).toContain('ğ ı İ ş ç ö ü ə');
      expect(t).toContain('Петров Иван Сергеевич');
    }),
    90_000,
  );

  it(
    'refuses an ODT renamed .docx without starting the converter',
    need(async () => {
      await expect(convertDocxToPdf(fx('renamed-odt.docx'))).rejects.toMatchObject({
        name: 'RenditionError',
        retryable: false,
      });
    }),
  );

  it(
    'leaks nothing from a field-injection file: no local file, no network request',
    need(async () => {
      const dir = mkdtempSync(join(tmpdir(), 'leak-'));
      const secret = join(dir, 'secret.txt');
      writeFileSync(secret, 'TOP-SECRET-MARKER-31337');
      let hits = 0;
      const srv = createServer((_q, r) => {
        hits++;
        r.end('x');
      });
      await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
      const port = (srv.address() as { port: number }).port;
      try {
        const hostile = await retarget(fx('hostile-field.docx'), {
          '/etc/hostname': secret,
          '127.0.0.1:9': `127.0.0.1:${port}`,
        });
        const { pdf } = await convertDocxToPdf(hostile);
        const t = textOf(pdf);
        expect(t).toContain('Visible CV text');
        expect(t).not.toContain('TOP-SECRET-MARKER-31337');
        expect(hits).toBe(0);
      } finally {
        srv.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }),
    90_000,
  );

  it(
    'kills the converter when it takes too long',
    need(async () => {
      const t0 = Date.now();
      await expect(
        convertDocxToPdf(fx('cv-az-fonts.docx'), { timeoutMs: 50 }),
      ).rejects.toMatchObject({
        name: 'RenditionError',
        message: expect.stringContaining('too long'),
        retryable: true,
      });
      expect(Date.now() - t0).toBeLessThan(10_000);
      // Nothing is left running (a killed process takes a moment to disappear).
      const left = () =>
        execFileSync('sh', ['-c', 'pgrep -f "[c]v-rendition-" || true'], {
          encoding: 'utf8',
        }).trim();
      for (let i = 0; i < 30 && left() !== ''; i++) await new Promise((r) => setTimeout(r, 100));
      expect(left()).toBe('');
    }),
    30_000,
  );

  it(
    'refuses output that is too large or has too many pages',
    need(async () => {
      await expect(
        convertDocxToPdf(fx('cv-az-fonts.docx'), { maxPages: 0 }),
      ).rejects.toBeInstanceOf(RenditionError);
      await expect(
        convertDocxToPdf(fx('cv-az-fonts.docx'), { maxPdfBytes: 10 }),
      ).rejects.toBeInstanceOf(RenditionError);
    }),
    90_000,
  );

  it('reports a missing converter as not retryable', async () => {
    await expect(
      convertDocxToPdf(fx('cv-az-fonts.docx'), { soffice: '/nonexistent/soffice' }),
    ).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining('not installed'),
    });
  });
});
