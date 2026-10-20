-- 0038 Word rendition (Stage 2, S2-BE7). A Word CV is shown to the recruiter as the pages the
-- author made: the server converts the .docx to a PDF in the background and keeps it beside the
-- original. NULL state means "not a Word file" (or a Word file an older instance stored during a
-- deploy, which the converter picks up too).
SET lock_timeout = '10s';
ALTER TABLE cv_document
  ADD COLUMN rendition_pdf BYTEA,
  ADD COLUMN rendition_state TEXT CHECK (rendition_state IN ('pending', 'processing', 'ready', 'failed')),
  ADD COLUMN rendition_error TEXT,
  ADD COLUMN rendition_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN rendition_started_at TIMESTAMPTZ,
  ADD COLUMN rendition_priority BOOLEAN NOT NULL DEFAULT false;
-- Live Word documents wait for their turn.
UPDATE cv_document SET rendition_state = 'pending'
 WHERE erased_at IS NULL AND content IS NOT NULL
   AND (lower(filename) LIKE '%.docx' OR mime LIKE '%wordprocessingml%');
CREATE INDEX cv_document_rendition_idx
  ON cv_document (rendition_priority DESC, uploaded_at, id) WHERE rendition_state = 'pending';
