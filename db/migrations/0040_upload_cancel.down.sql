-- Scrubbed file names are not restored (the up file keeps only their hash).
ALTER TABLE upload_batch DROP CONSTRAINT IF EXISTS upload_batch_cancel_complete;
ALTER TABLE upload_batch DROP COLUMN IF EXISTS cancelled_by, DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE cv_document DROP COLUMN IF EXISTS erased_name_sha;
