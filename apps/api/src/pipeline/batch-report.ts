import { CV_STATUS_LABEL, type CvStatus } from '@cv/shared';
import { safe } from './export.service';

/**
 * The outcome report of one upload (Stage 3, S3-UP-09): batch rows in, CSV text out. A pure
 * function, so the content rules are tested without a database.
 *
 * - Exactly five columns: `position,label,status,reason,document_id`.
 * - One row per row of the batch's Details, in the same order: ZIP containers are left out and
 *   their entries follow in their place. Position is 1-based over the printed rows.
 * - Label is what Details shows: the path the browser sent, or the file name; a ZIP entry with its
 *   ZIP's name in front. An erased CV is `erased`.
 * - It prints `upload_item` columns only: never a score, band, knockout or decision, the candidate's
 *   name or e-mail read by the AI, CV text, hashes, IP addresses or user e-mails.
 * - Every text cell is neutralised against spreadsheet formulas and quoted; line breaks become
 *   spaces. File names are chosen by candidates, so this is the formula-injection path.
 * - UTF-8 with a byte-order mark, so a spreadsheet opens Azerbaijani letters correctly.
 */

export interface ReportItem {
  id: string;
  parentId: string | null;
  position: number;
  filename: string;
  clientPath: string | null;
  status: CvStatus;
  message: string | null;
  documentId: string | null;
  container: boolean;
}

export const REPORT_HEADER = 'position,label,status,reason,document_id';

/** Spreadsheet cells that start with = + - @ (or a tab or a return) are run by Excel; neutralise. */
export const csvSafe = (v: string) => safe(v) as string;

const cell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const text = csvSafe(v.replace(/[\r\n]+/g, ' '));
  return `"${text.replace(/"/g, '""')}"`;
};

/** The rows in Details order: top items by position, a ZIP's entries right after the ZIP. */
export function reportRows(items: ReportItem[]): ReportItem[] {
  const top = items.filter((i) => !i.parentId).sort((a, b) => a.position - b.position);
  const kids = new Map<string, ReportItem[]>();
  for (const i of items) if (i.parentId) kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i]);
  const out: ReportItem[] = [];
  for (const t of top) {
    if (!t.container) out.push(t);
    const ks = (kids.get(t.id) ?? []).sort((a, b) => a.position - b.position);
    for (const k of ks) {
      const zipName = t.clientPath || t.filename;
      const label =
        k.status === 'erased' || k.filename === 'erased' || k.filename.includes(' › ')
          ? k.filename
          : `${zipName} › ${k.filename}`;
      out.push({ ...k, clientPath: null, filename: label });
    }
  }
  return out;
}

export function batchReportCsv(items: ReportItem[]): string {
  const lines = [REPORT_HEADER];
  reportRows(items).forEach((r, i) => {
    const erased = r.status === 'erased' || r.filename === 'erased';
    const label = erased ? 'erased' : r.clientPath || r.filename;
    lines.push(
      [
        cell(i + 1),
        cell(label),
        cell(CV_STATUS_LABEL[r.status]),
        cell(erased ? null : r.message),
        cell(r.documentId),
      ].join(','),
    );
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
