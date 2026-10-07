ALTER TABLE vacancy
  DROP COLUMN IF EXISTS legal_hold_at,
  DROP COLUMN IF EXISTS legal_hold_by,
  DROP COLUMN IF EXISTS legal_hold_matter,
  DROP COLUMN IF EXISTS legal_hold;
DROP TABLE IF EXISTS retention_certificate;
DROP TABLE IF EXISTS retention_setting;
