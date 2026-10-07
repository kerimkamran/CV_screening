-- 0022 optional two-step sign-in (TOTP, RFC 6238) for local accounts. The secret is stored
-- encrypted (same envelope as provider keys); recovery codes only as hashes.
ALTER TABLE local_credential
  ADD COLUMN totp_secret      TEXT,
  ADD COLUMN totp_pending     TEXT,
  ADD COLUMN totp_enabled_at  TIMESTAMPTZ,
  ADD COLUMN totp_last_step   BIGINT,
  ADD COLUMN recovery_hashes  TEXT[] NOT NULL DEFAULT '{}';
