-- 0027 invitation and password-setup links no longer expire (decision of 12 Oct 2026).
-- A link still works once and is withdrawn when a newer one is issued for the same person.
-- NULL expires_at means "no time limit". Links that were issued but not yet used, and had run
-- out of time, work again.
ALTER TABLE password_setup ALTER COLUMN expires_at DROP NOT NULL;
UPDATE password_setup SET expires_at = NULL WHERE used_at IS NULL;
