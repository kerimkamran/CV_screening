DROP INDEX IF EXISTS cv_document_copied_from_idx;
ALTER TABLE cv_document DROP COLUMN IF EXISTS copied_from;
