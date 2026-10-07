ALTER TABLE local_credential
  DROP COLUMN IF EXISTS recovery_hashes,
  DROP COLUMN IF EXISTS totp_last_step,
  DROP COLUMN IF EXISTS totp_enabled_at,
  DROP COLUMN IF EXISTS totp_pending,
  DROP COLUMN IF EXISTS totp_secret;
