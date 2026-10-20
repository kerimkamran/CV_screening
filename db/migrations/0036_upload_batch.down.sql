DROP INDEX IF EXISTS cv_document_live_sha_idx;
-- Erased documents may now share a hash with another row: give the colliding ones a filler hash
-- (derived from their own id) before the old constraint comes back.
UPDATE cv_document d
   SET sha256 = encode(sha256(convert_to(d.id::text, 'UTF8')), 'hex')
 WHERE d.erased_at IS NOT NULL
   AND EXISTS (SELECT 1 FROM cv_document o
                WHERE o.vacancy_id = d.vacancy_id AND o.sha256 = d.sha256 AND o.id <> d.id);
ALTER TABLE cv_document ADD CONSTRAINT cv_document_vacancy_id_sha256_key UNIQUE (vacancy_id, sha256);
ALTER TABLE intake_skip DROP COLUMN IF EXISTS upload_item_id;
DROP TABLE IF EXISTS upload_item;
DROP TABLE IF EXISTS upload_batch;
