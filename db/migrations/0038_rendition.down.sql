DROP INDEX IF EXISTS cv_document_rendition_idx;
ALTER TABLE cv_document
  DROP COLUMN IF EXISTS rendition_priority,
  DROP COLUMN IF EXISTS rendition_started_at,
  DROP COLUMN IF EXISTS rendition_attempts,
  DROP COLUMN IF EXISTS rendition_error,
  DROP COLUMN IF EXISTS rendition_state,
  DROP COLUMN IF EXISTS rendition_pdf;
