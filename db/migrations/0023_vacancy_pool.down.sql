-- The enum value 'new' cannot be dropped from decision_outcome; it stays unused after a rollback.
DROP INDEX IF EXISTS cv_document_vacancy_idx2;
DROP INDEX IF EXISTS screening_document_idx;
ALTER TABLE decision DROP CONSTRAINT IF EXISTS decision_reason_check;
ALTER TABLE decision ADD CONSTRAINT decision_reason_check CHECK (length(btrim(reason)) >= 10) NOT VALID;
DROP TABLE IF EXISTS vacancy_history;
ALTER TABLE requirement_set DISABLE TRIGGER requirement_set_frozen_guard;
ALTER TABLE requirement_set DROP COLUMN IF EXISTS requirements_version;
ALTER TABLE requirement_set ENABLE TRIGGER requirement_set_frozen_guard;
ALTER TABLE vacancy
  DROP COLUMN IF EXISTS archived_by,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS requirements_version,
  DROP COLUMN IF EXISTS link_text_hash,
  DROP COLUMN IF EXISTS link_status,
  DROP COLUMN IF EXISTS link_read_at,
  DROP COLUMN IF EXISTS link_url,
  DROP COLUMN IF EXISTS source_file_name,
  DROP COLUMN IF EXISTS source_type,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS hiring_manager,
  DROP COLUMN IF EXISTS closing_date,
  DROP COLUMN IF EXISTS openings,
  DROP COLUMN IF EXISTS experience_range,
  DROP COLUMN IF EXISTS status;
DROP TYPE IF EXISTS vacancy_status;
