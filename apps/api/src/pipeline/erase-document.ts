import type { Queryable } from '../db/db.service';
import { eraseAssistantForDocument } from '../assistant/assistant-erase';
import type { ReportService } from './report.service';
import { newId } from '@cv/shared';

/** Why a CV was erased: it becomes the tombstone's cause when the CV came from Oracle (S3-INT-02). */
export type EraseCause = 'erase' | 'purge' | 'source_removed';

export interface EraseResult {
  /** Tombstone rows written for an imported CV (0 for a browser upload). */
  tombstones: number;
  /** True when the tombstone copy failed: the CV is still erased, the audit row says so. */
  tombstonePending: boolean;
}

/**
 * Copies the stored hashes of an imported CV into the append-only suppression list and clears the
 * raw Oracle IDs (S3-INT-02, design note 10). It computes nothing, so it needs no key. A savepoint
 * keeps a failure here from undoing the erase itself.
 */
async function tombstoneFor(
  tx: Queryable,
  documentId: string,
  cause: EraseCause,
): Promise<EraseResult> {
  const items = await tx.query<{
    app_key_hash: string;
    person_key_hash: string;
    key_version: number;
    vacancy_id: string;
    system: string;
  }>(
    `SELECT app_key_hash, person_key_hash, key_version, vacancy_id, system FROM import_item WHERE document_id = $1`,
    [documentId],
  );
  if (!items.rows.length) return { tombstones: 0, tombstonePending: false };
  await tx.query('SAVEPOINT erase_tombstone');
  try {
    let n = 0;
    for (const it of items.rows)
      for (const [kind, hash] of [
        ['application', it.app_key_hash],
        ['person_requisition', it.person_key_hash],
      ] as const) {
        const r = await tx.query(
          `INSERT INTO import_tombstone (id, system, key_kind, key_hash, key_version, vacancy_id, cause)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (system, key_hash) DO NOTHING`,
          [newId(), it.system, kind, hash, it.key_version, it.vacancy_id, cause],
        );
        n += r.rowCount ?? 0;
      }
    await tx.query(
      `UPDATE import_item SET external_application_id = NULL, external_attachment_id = NULL WHERE document_id = $1`,
      [documentId],
    );
    await tx.query('RELEASE SAVEPOINT erase_tombstone');
    return { tombstones: n, tombstonePending: false };
  } catch {
    await tx.query('ROLLBACK TO SAVEPOINT erase_tombstone');
    return { tombstones: 0, tombstonePending: true };
  }
}

/**
 * Wipes one document and everything derived from it (file, file name, extracted text, identity, summary,
 * per-requirement evidence, shared-report copies, assistant threads). Shared by the recruiter's
 * erase action (GDPR Art. 17) and the scheduled retention purge (DOC-09). The caller records the
 * audit entry in the same transaction. Returns false when the document was already erased; otherwise
 * what happened to the Oracle tombstones (put `tombstonePending` on the audit row when it is true).
 */
export async function eraseDocumentData(
  tx: Queryable,
  reports: ReportService,
  documentId: string,
  erasedBy: string,
  cause: EraseCause = 'erase',
): Promise<EraseResult | false> {
  // The file name is usually the candidate's name (S3-UP-04): only its SHA-256 stays, so the
  // "skipped" list can still tell that a file was taken in later. SET reads the old name.
  const r = await tx.query(
    `UPDATE cv_document SET content = NULL, text = NULL, page_starts = NULL, erased_at = now(), erased_by = $2,
            rendition_pdf = NULL, rendition_state = NULL, rendition_error = NULL, rendition_priority = false,
            erased_name_sha = encode(sha256(convert_to(filename, 'UTF8')), 'hex'), filename = 'erased'
      WHERE id = $1 AND erased_at IS NULL`,
    [documentId, erasedBy],
  );
  if (!r.rowCount) return false;
  const result = await tombstoneFor(tx, documentId, cause);
  await tx.query(
    `UPDATE upload_item SET filename = 'erased', client_path = NULL WHERE document_id = $1`,
    [documentId],
  );
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
  for (const c of copies.rows) {
    const sub = await eraseDocumentData(tx, reports, c.id, erasedBy, cause);
    if (sub) {
      result.tombstones += sub.tombstones;
      result.tombstonePending ||= sub.tombstonePending;
    }
  }
  return result;
}
