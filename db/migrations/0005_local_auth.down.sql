DROP TABLE IF EXISTS local_credential;
DROP INDEX IF EXISTS app_user_email_uq;
ALTER TABLE app_user DROP COLUMN IF EXISTS display_name, DROP COLUMN IF EXISTS email;
