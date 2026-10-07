import type { Queryable } from '../db/db.service';

/** A resume was erased: its assistant conversations go with it (spec 6.6.6). */
export async function eraseAssistantForDocument(tx: Queryable, documentId: string): Promise<void> {
  await tx.query(
    `DELETE FROM assistant_message WHERE thread_id IN (
       SELECT t.id FROM assistant_thread t JOIN screening s ON s.id = t.screening_id
        WHERE s.document_id = $1)`,
    [documentId],
  );
  await tx.query(
    `DELETE FROM assistant_thread WHERE screening_id IN (SELECT id FROM screening WHERE document_id = $1)`,
    [documentId],
  );
}
