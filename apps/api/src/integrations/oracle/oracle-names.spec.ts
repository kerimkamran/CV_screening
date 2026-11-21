import { cleanBaseName, fileNameFromBytes } from './oracle-names';

// Stage 3, S3-INT-12 (4).
describe('Oracle file names', () => {
  const pdf = Buffer.from('%PDF-1.7\n...');
  const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);

  it('names a file by its bytes', () => {
    expect(fileNameFromBytes(pdf, 'Resume')).toBe('Resume.pdf');
    expect(fileNameFromBytes(docx, 'cv.bin')).toBe('cv.docx');
    expect(fileNameFromBytes(ole, 'cv.docx')).toBe('cv.doc');
    expect(fileNameFromBytes(Buffer.from('plain words'), 'notes.md')).toBe('notes.md');
    expect(fileNameFromBytes(Buffer.from('plain words'), 'notes')).toBe('notes.txt');
    expect(fileNameFromBytes(Buffer.from([0, 1, 2, 255]), 'blob')).toBe('blob.bin');
  });

  it('cleans paths and control characters', () => {
    expect(cleanBaseName('..\\..\\evil/Leyla\u0000CV.pdf')).toBe('LeylaCV.pdf');
    expect(cleanBaseName('   ')).toBe('CV');
    expect(cleanBaseName('x'.repeat(400))).toHaveLength(150);
  });
});
