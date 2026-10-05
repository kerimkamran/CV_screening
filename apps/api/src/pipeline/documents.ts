import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const MAX_TEXT_CHARS = 60_000;
export const MIN_READABLE_CHARS = 200;

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export type Kind = 'pdf' | 'docx' | 'txt';

/** Decide the format from content, not the filename: magic bytes first. */
export function sniff(buf: Buffer, filename: string): Kind | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b)
    return filename.toLowerCase().endsWith('.docx') ? 'docx' : null;
  if (/\.(txt|md)$/i.test(filename) && !buf.subarray(0, 4096).includes(0)) return 'txt';
  return null;
}

export const MIME: Record<Kind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/** Canonical text form. Evidence offsets are defined against exactly this string. */
export function normalizeText(raw: string): string {
  return raw
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractText(buf: Buffer, kind: Kind): Promise<string> {
  switch (kind) {
    case 'pdf':
      return normalizeText(await pdfToText(buf));
    case 'docx': {
      const mammoth = await import('mammoth');
      return normalizeText((await mammoth.extractRawText({ buffer: buf })).value);
    }
    default:
      return normalizeText(buf.toString('utf8'));
  }
}

/**
 * Poppler's pdftotext, fed over stdin so nothing touches disk. Chosen over pure-JS parsers for
 * robustness on real-world CVs. A hard timeout and output cap bound a hostile or pathological file.
 */
export function pdfToText(buf: Buffer, timeoutMs = 20_000, maxBytes = 5_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftotext', ['-enc', 'UTF-8', '-nopgbrk', '-', '-'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) child.kill('SIGKILL');
      else chunks.push(c);
    });
    child.on('error', (e) => (clearTimeout(timer), reject(e)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && size <= maxBytes) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`pdftotext exited ${code}`));
    });
    child.stdin.on('error', () => undefined); // the child may exit before reading everything
    child.stdin.end(buf);
  });
}
