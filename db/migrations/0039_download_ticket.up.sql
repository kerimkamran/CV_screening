-- 0039 Download tickets (Stage 2, S2-BE8). "Download CVs" asks for a ticket with the session, then
-- the browser's own download manager fetches the ZIP with the ticket in the URL: single use, two
-- minutes, only its sha256 is stored. A table, not memory, because during a deploy the old and new
-- instances overlap and the GET may reach the other one.
SET lock_timeout = '10s';
CREATE TABLE download_ticket (
  id           ulid PRIMARY KEY,
  token_hash   CHAR(64) NOT NULL UNIQUE,
  created_by   ulid NOT NULL REFERENCES app_user(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  archive_name TEXT NOT NULL,
  document_ids CHAR(26)[] NOT NULL CHECK (cardinality(document_ids) BETWEEN 1 AND 500)
);
CREATE INDEX download_ticket_expires_idx ON download_ticket (expires_at);
SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON download_ticket TO cv_app');
