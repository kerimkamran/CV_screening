-- 0040 Upload cancel and file-name scrub on erase (Stage 3, S3-UP-04 and S3-UP-05).
-- - cv_document.erased_name_sha: the SHA-256 (hex) of the file name an erased CV had. Erase and the
--   retention purge set filename = 'erased' and keep only this hash, so the "skipped" list can still
--   tell that a file was taken in later. A known name can be checked against it: pseudonymous, not
--   anonymous (DPIA, Stage 3 rows).
-- - upload_batch.cancelled_at / cancelled_by: "Stop sending files". Both set or both empty.
-- The backfill below scrubs CVs erased before this release. It cannot be undone: the down file
-- drops the columns but does not bring the names back. Every column is additive, so the previous
-- image still runs against this schema.
SET lock_timeout = '10s';

ALTER TABLE cv_document ADD COLUMN erased_name_sha CHAR(64);

ALTER TABLE upload_batch
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancelled_by ulid REFERENCES app_user(id),
  ADD CONSTRAINT upload_batch_cancel_complete
    CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL));

-- Backfill 1: upload items that point at an erased CV lose the name the browser sent.
UPDATE upload_item i SET filename = 'erased', client_path = NULL
  FROM cv_document d
 WHERE d.id = i.document_id AND d.erased_at IS NOT NULL
   AND (i.filename <> 'erased' OR i.client_path IS NOT NULL);

-- Backfill 2: erased CVs keep only the hash of their name (SET reads the old value).
UPDATE cv_document
   SET erased_name_sha = encode(sha256(convert_to(filename, 'UTF8')), 'hex'),
       filename = 'erased'
 WHERE erased_at IS NOT NULL AND erased_name_sha IS NULL;
