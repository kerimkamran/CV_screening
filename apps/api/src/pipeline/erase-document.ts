import type { Queryable } from '../db/db.service';
import { eraseAssistantForDocument } from '../assistant/assistant-erase';
import type { ReportService } from './report.service';

/**
 * Wipes one document and everything derived from it (file, extracted text, identity, summary,
 * per-requirement evidence, shared-report copies, assistant threads). Shared by the recruiter's
 * erase action (GDPR Art. 17) and the scheduled retention purge (DOC-09). The caller records the
 * audit entry in the same transaction. Returns false when the document was already erased.
 */
export async function eraseDocumentData(
  tx: Queryable,
  reports: ReportService,
  documentId: string,
  erasedBy: string,
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE cv_document SET content = NULL, text = NULL, page_starts = NULL, erased_at = now(), erased_by = $2,
            rendition_pdf = NULL, rendition_state = NULL, rendition_error = NULL, rendition_priority = false
      WHERE id = $1 AND erased_at IS NULL`,
    [documentId, erasedBy],
  );
  if (!r.rowCount) return false;
  await tx.query(
    `DELETE FROM requirement_assessment WHERE screening_id IN (SELECT id FROM screening WHERE document_id = $1)`,
    [documentId],
  );
  await tx.query(
    `UPDATE screening SET candidate_name = NULL, candidate_email = NULL, summary = NULL,
            state = CASE WHEN state IN ('queued','processing') THEN 'manual'::screening_state ELSE state END
      WHERE document_id = $1`,
    [documentId],
  );
  const vac = await tx.query<{ vacancy_id: string }>(
    `SELECT vacancy_id FROM cv_document WHERE id = $1`,
    [documentId],
  );
  await reports.scrubDocument(tx, vac.rows[0]!.vacancy_id, documentId);
  await eraseAssistantForDocument(tx, documentId);
  // What was read from a link the candidate gave goes with the resume, and the consent ends.
  await tx.query(`DELETE FROM candidate_link_review WHERE document_id = $1`, [documentId]);
  await tx.query(
    `UPDATE candidate_consent SET withdrawn_at = now(), withdrawn_by = $2
      WHERE document_id = $1 AND withdrawn_at IS NULL`,
    [documentId, erasedBy],
  );
  // A resume that was analyzed again for another vacancy is the same person's data: it goes too.
  const copies = await tx.query<{ id: string }>(
    `SELECT id FROM cv_document WHERE copied_from = $1 AND erased_at IS NULL`,
    [documentId],
  );
  for (const c of copies.rows) await eraseDocumentData(tx, reports, c.id, erasedBy);
  return true;
}
