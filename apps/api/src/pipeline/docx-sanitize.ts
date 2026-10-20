import JSZip from 'jszip';

/**
 * A Word file is untrusted input (Stage 2, S2-BE7). Before LibreOffice ever opens one, this keeps
 * only what a PDF of the pages needs:
 *
 *  1. It must be a real WordprocessingML package: `[Content_Types].xml` names the main document
 *     part and that part exists. A renamed ODT, RTF, ZIP or text file is refused.
 *  2. Every external relationship is removed except plain hyperlinks (a link that is only shown,
 *     never fetched). That removes linked pictures, linked OLE objects, attached templates, frames
 *     and sub-documents that point outside the file.
 *  3. Fields that read from somewhere else are blanked: INCLUDETEXT, INCLUDEPICTURE, LINK, DDE,
 *     DDEAUTO, IMPORT (and the like). The text the field last showed stays.
 *  4. `altChunk`, `subDoc`, `attachedTemplate` and external OLE objects are removed, as are macro
 *     and ActiveX parts and any DOCTYPE in the XML.
 *
 * The result is a smaller, quieter .docx. A file that cannot be made safe is refused, never passed
 * on as it is.
 */

export class NotWordError extends Error {
  constructor(message = 'This file is not a Word document.') {
    super(message);
    this.name = 'NotWordError';
  }
}

const MAIN_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
];
const MAX_ENTRIES = 2_000;
const MAX_UNPACKED = 120 * 1024 * 1024;
const DANGEROUS_FIELDS =
  /^\s*(INCLUDETEXT|INCLUDEPICTURE|LINK|DDEAUTO|DDE|IMPORT|AUTOTEXT|AUTOTEXTLIST|DATABASE|SUBSCRIBER)\b/i;
const HYPERLINK = /\/relationships\/hyperlink$/;

const decode = (u: Uint8Array) => Buffer.from(u).toString('utf8');

function stripFields(xml: string): string {
  // Field instructions in runs: <w:instrText>INCLUDETEXT "x"</w:instrText>
  let out = xml.replace(
    /(<w:instrText\b[^>]*>)([\s\S]*?)(<\/w:instrText>)/g,
    (m, a: string, body: string, c: string) =>
      DANGEROUS_FIELDS.test(unescapeXml(body)) ? `${a} ${c}` : m,
  );
  // Simple fields: <w:fldSimple w:instr="LINK ...">
  out = out.replace(
    /(<w:fldSimple\b[^>]*?\bw:instr=)("([^"]*)"|'([^']*)')/g,
    (m, a: string, q: string, d: string, s: string) =>
      DANGEROUS_FIELDS.test(unescapeXml(d ?? s ?? '')) ? `${a}" "` : m,
  );
  return out;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function stripElements(xml: string): string {
  return (
    xml
      // Documents that pull in other documents.
      .replace(/<w:altChunk\b[^>]*?(\/>|>[\s\S]*?<\/w:altChunk>)/g, '')
      .replace(/<w:subDoc\b[^>]*?(\/>|>[\s\S]*?<\/w:subDoc>)/g, '')
      // A template to attach (settings.xml).
      .replace(/<w:attachedTemplate\b[^>]*?(\/>|>[\s\S]*?<\/w:attachedTemplate>)/g, '')
      // Linked (not embedded) OLE objects.
      .replace(/<o:OLEObject\b[^>]*?\bType=["']Link["'][^>]*?(\/>|>[\s\S]*?<\/o:OLEObject>)/g, '')
      .replace(/<w:externalData\b[^>]*?(\/>|>[\s\S]*?<\/w:externalData>)/g, '')
      // A DOCTYPE (entity tricks) has no place in a Word part.
      .replace(/<!DOCTYPE[\s\S]*?(\]>|>)/gi, '')
  );
}

function cleanRels(xml: string): string {
  return xml.replace(/<Relationship\b[^>]*?(\/>|>[\s\S]*?<\/Relationship>)/g, (m) => {
    const external = /\bTargetMode=["']External["']/i.test(m);
    if (!external) return m;
    const type = /\bType=["']([^"']*)["']/.exec(m)?.[1] ?? '';
    return HYPERLINK.test(type) ? m : '';
  });
}

/** Returns a cleaned .docx, or throws NotWordError. */
export async function sanitizeDocx(input: Buffer): Promise<Buffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new NotWordError('This file is not a Word document (it is not a valid package).');
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new NotWordError('This Word file has too many parts.');
  // The package must say it holds a Word document, and the part it names must exist.
  const ct = zip.file('[Content_Types].xml');
  if (!ct) throw new NotWordError();
  const ctXml = decode(await ct.async('uint8array'));
  const hasMainType = MAIN_TYPES.some((t) => ctXml.includes(t));
  if (!hasMainType) throw new NotWordError();
  if (!zip.file('word/document.xml')) throw new NotWordError();

  const out = new JSZip();
  let unpacked = 0;
  for (const name of names) {
    const entry = zip.files[name]!;
    if (entry.dir) continue;
    // Paths that climb out of the package are never copied.
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) continue;
    // Macros and ActiveX controls have no place in a copy made for reading.
    if (/(^|\/)vbaProject\.bin$|(^|\/)vbaData\.xml$|^word\/activeX\//i.test(name)) continue;
    const data = await entry.async('uint8array');
    unpacked += data.length;
    if (unpacked > MAX_UNPACKED)
      throw new NotWordError('This Word file is too large when unpacked.');
    if (/\.rels$/i.test(name)) {
      let rels = cleanRels(decode(data));
      // Relationships to the parts removed above go too.
      rels = rels.replace(
        /<Relationship\b[^>]*?\bTarget=["'][^"']*(vbaProject|activeX)[^"']*["'][^>]*?(\/>|>[\s\S]*?<\/Relationship>)/gi,
        '',
      );
      out.file(name, rels);
    } else if (/^word\/.*\.xml$/i.test(name)) {
      out.file(name, stripElements(stripFields(decode(data))));
    } else if (name === '[Content_Types].xml') {
      out.file(name, decode(data).replace(/<!DOCTYPE[\s\S]*?(\]>|>)/gi, ''));
    } else {
      out.file(name, data);
    }
  }
  return out.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
