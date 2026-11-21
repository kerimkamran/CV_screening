/**
 * Stage 3, S3-INT-12 (4): the file extension comes from the first bytes, not from Oracle's name.
 * `Resume` with PDF bytes becomes `Resume.pdf`; Word bytes named `cv.bin` become `cv.docx`; old Word
 * (OLE) bytes named `cv.docx` become `cv.doc`, which intake refuses as the old Word format.
 * Text files keep a `.txt` or `.md` name. The base name is cleaned of paths and control characters.
 */
export function cleanBaseName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return base.slice(0, 150) || 'CV';
}

export function fileNameFromBytes(bytes: Buffer, oracleName: string): string {
  const base = cleanBaseName(oracleName);
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'CV';
  const head = bytes.subarray(0, 8);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return `${stem}.pdf`;
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)
    return `${stem}.docx`;
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
    return `${stem}.doc`;
  if (/\.(txt|md)$/i.test(base)) return base;
  // Plain text with no recognised name: keep it as text, intake decides whether it is readable.
  const sample = bytes.subarray(0, 512);
  const printable = sample.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127));
  return printable && sample.length > 0 ? `${stem}.txt` : `${stem}.bin`;
}
