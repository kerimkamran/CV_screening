UPDATE password_setup SET expires_at = created_at + interval '72 hours' WHERE expires_at IS NULL;
ALTER TABLE password_setup ALTER COLUMN expires_at SET NOT NULL;
