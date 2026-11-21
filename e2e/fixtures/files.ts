import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { row } from './api';

/**
 * Generated test data of the UAT plan (section 2.5 and 9). Binary files are made once by
 * make-files.py into fixtures/files/. All people are invented.
 */
const file = (name: string) => readFileSync(new URL(`./files/${name}`, import.meta.url));
/** The two large ZIPs are written by make-zips.mjs (S3-UP-10): build them on first use. */
const built = (name: string) => {
  const url = new URL(`./files/${name}`, import.meta.url);
  if (!existsSync(url))
    execFileSync(process.execPath, [new URL('./make-zips.mjs', import.meta.url).pathname]);
  return readFileSync(url);
};
export const FILES = {
  /** A Word CV (Rəşad Əliyev): BGP, OSPF, Kubernetes, Python. */
  docx: () => file('rashad.docx'),
  /** Eight quoted skill lines within 2 % of the page height (evidence-dot spill, SD/EM tests). */
  densePdf: () => file('dense-skills.pdf'),
  /** Password-protected PDF (user password "user-pass"). */
  protectedPdf: () => file('protected.pdf'),
  /** A PDF cut off after a third of its bytes. */
  brokenPdf: () => file('broken.pdf'),
  /** Plain text with a .pdf name. */
  notPdf: () => file('not-a-pdf.pdf'),
  /** Three CVs (one in a folder) and a photo. */
  zip: () => file('cvs.zip'),
  /** One CV and one stored entry of 11 MB (over the 10 MB per-file limit). Built in Node if missing. */
  oversizeZip: () => built('oversize.zip'),
  /** 1,100 tiny CVs: over the 1,000 entries the server examines in one ZIP. Built in Node if missing. */
  tooManyZip: () => built('too-many.zip'),
};

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A plain-text CV the fake AI and the parser both read. */
export const cvText = (name: string, lines: string[]) =>
  `Name: ${name}\n${lines.join('\n')}\n${'Padding text for length. '.repeat(10)}`;

/** n invented CV files for a batch (the plan's 120-file batch is batch(120)). */
export function batch(n: number, prefix = 'Batch Person') {
  return Array.from({ length: n }, (_, i) => ({
    name: `${prefix.toLowerCase().replace(/\W+/g, '-')}-${String(i + 1).padStart(3, '0')}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(
      cvText(
        `${prefix} ${i + 1}`,
        i % 3 === 0
          ? ['BGP routing.', 'Kubernetes.']
          : i % 3 === 1
            ? ['BGP routing.']
            : ['Cooking.'],
      ),
    ),
  }));
}

/** A ULID-shaped id from a number (Crockford digits only), for big mocked lists. */
export const ulidOf = (prefix: string, n: number) =>
  `01K${prefix.padEnd(3, '0').slice(0, 3)}${String(n).padStart(20, '0')}`.slice(0, 26);

/**
 * A mocked candidate pool of n rows (the plan's 300-CV pool is pool(300)), in the shape of
 * GET /candidates rows. Scores fall from 95; every third has a decision.
 */
export function pool(n: number) {
  const marks = ['new', 'shortlist', 'maybe', 'not_now'] as const;
  return Array.from({ length: n }, (_, i) => {
    const r = row(
      ulidOf('DOC', i + 1),
      ulidOf('MAT', i + 1),
      `Pool Person ${i + 1}`,
      Math.max(5, 95 - (i % 90)),
      i + 1,
    );
    return { ...r, decision: i % 3 === 0 ? marks[(i / 3) % 4]! : 'new' };
  });
}
