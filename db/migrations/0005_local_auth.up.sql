-- 0005 built-in accounts (MVP). Admin-created recruiter accounts with generated passwords.
-- The OIDC path (0004) is unchanged: `issuer = 'cv-local'` rows are simply another identity source,
-- and roles still come only from role_assignment.

ALTER TABLE app_user ADD COLUMN email TEXT, ADD COLUMN display_name TEXT;
CREATE UNIQUE INDEX app_user_email_uq ON app_user (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE local_credential (
  user_id             ulid PRIMARY KEY REFERENCES app_user(id),
  password_hash       TEXT NOT NULL,          -- scrypt$N$r$p$salt$hash; never reversible
  must_change         BOOLEAN NOT NULL DEFAULT true,
  failed_attempts     INT NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Embedded in every session token; bumped on password change/reset so older sessions stop working.
  session_version     INT NOT NULL DEFAULT 0
);

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON local_credential TO cv_app');
