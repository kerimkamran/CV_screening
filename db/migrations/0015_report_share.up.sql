-- 0015 shared evaluation reports (design spec 6.5).
-- A share is a snapshot: the report as it was when shared. It is login-only (named people, never
-- the link alone), expires, can be revoked, and every open is recorded. Names and CV quotes are
-- included only when the recruiter chose so at sharing time.

CREATE TABLE report_share (
  id               ulid PRIMARY KEY,
  vacancy_id       ulid NOT NULL REFERENCES vacancy(id),
  created_by       ulid NOT NULL REFERENCES app_user(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  include_names    BOOLEAN NOT NULL DEFAULT false,
  include_quotes   BOOLEAN NOT NULL DEFAULT true,
  snapshot         JSONB NOT NULL,
  revoked_at       TIMESTAMPTZ,
  revoked_by       ulid REFERENCES app_user(id),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX report_share_vacancy_idx ON report_share (vacancy_id, created_at DESC);

CREATE TABLE report_share_viewer (
  share_id ulid NOT NULL REFERENCES report_share(id),
  user_id  ulid NOT NULL REFERENCES app_user(id),
  PRIMARY KEY (share_id, user_id)
);
CREATE INDEX report_share_viewer_user_idx ON report_share_viewer (user_id);

-- Append-only: who opened (or tried to open) which share, and what they were shown.
CREATE TABLE report_share_open (
  id        ulid PRIMARY KEY,
  share_id  ulid NOT NULL REFERENCES report_share(id),
  user_id   ulid NOT NULL REFERENCES app_user(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome   TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'expired', 'revoked'))
);
CREATE INDEX report_share_open_idx ON report_share_open (share_id, opened_at);

CREATE TRIGGER report_share_viewer_no_update BEFORE UPDATE OR DELETE ON report_share_viewer
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER report_share_open_no_update BEFORE UPDATE OR DELETE ON report_share_open
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER report_share_open_no_truncate BEFORE TRUNCATE ON report_share_open
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- The share row can be revoked, and its snapshot scrubbed when a resume is erased; nothing else
-- changes (the audit trail records both).
SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON report_share TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT ON report_share_viewer TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT ON report_share_open TO cv_app');
