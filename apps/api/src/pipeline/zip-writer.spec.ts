import JSZip from 'jszip';
import { safeName, uniqueNames, zipLength, ZipStream } from './zip-writer';

describe('the ZIP writer for "Download CVs" (S2-BE8)', () => {
  it('cleans names and keeps Azerbaijani letters', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('C:\\Users\\a\\CV: Aysel?.pdf')).toBe('CV_ Aysel_.pdf');
    expect(safeName('Məmmədova\u0007 CV.docx')).toBe('Məmmədova CV.docx');
    expect(safeName('   ', 'docx')).toBe('cv.docx');
    expect(safeName('...')).toBe('cv.pdf');
  });

  it('makes clashing names unique without regard to case', () => {
    expect(uniqueNames(['cv.pdf', 'CV.pdf', 'cv.pdf', 'notes'])).toEqual([
      'cv.pdf',
      'CV (2).pdf',
      'cv (3).pdf',
      'notes',
    ]);
  });

  it('writes an archive any unzip tool reads, with the length it promised', async () => {
    const files = [
      { name: 'Aysel Məmmədova.pdf', data: Buffer.from('%PDF-1.4 one') },
      { name: 'rauf.txt', data: Buffer.from('Rauf Aliyev\nBGP') },
      { name: 'empty.txt', data: Buffer.alloc(0) },
    ];
    const at = new Date('2026-10-08T09:30:12Z');
    const z = new ZipStream();
    const parts = files.flatMap((f) => z.add(f.name, f.data, at));
    parts.push(...z.finish());
    const zip = Buffer.concat(parts);
    expect(zip.length).toBe(
      zipLength(files.map((f) => ({ name: f.name, size: f.data.length, modified: at }))),
    );
    const read = await JSZip.loadAsync(zip);
    expect(Object.keys(read.files)).toEqual(files.map((f) => f.name));
    expect(await read.file('rauf.txt')!.async('string')).toBe('Rauf Aliyev\nBGP');
    expect(await read.file('Aysel Məmmədova.pdf')!.async('string')).toBe('%PDF-1.4 one');
    const d = read.files['rauf.txt']!.date;
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]).toEqual([2026, 9, 8]);
  });
});
