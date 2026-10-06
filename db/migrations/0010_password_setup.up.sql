-- 0010 one-time password-setup links (MVP). An administrator copies a link and sends it by any
-- channel; whoever opens it chooses their own password. Only a SHA-256 hash of the token is stored,
-- so a database read never yields a usable link. A link works once and expires.

CREATE TABLE password_setup (
  id         ulid PRIMARY KEY,
  user_id    ulid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,         -- hex(sha256(token))
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_by ulid REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_setup_user_idx ON password_setup (user_id) WHERE used_at IS NULL;

SELECT app_grant('GRANT SELECT, INSERT, UPDATE, DELETE ON password_setup TO cv_app');
