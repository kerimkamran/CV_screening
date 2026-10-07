-- 0021 retention (plan DOC-08..11, design spec compliance): a configurable retention period, legal
-- hold per vacancy, and one deletion certificate per purge run. The purge erases the same things as
-- a recruiter's erase action; the decision record and the audit trail are kept.

CREATE TABLE retention_setting (
  id          SMALLINT PRIMARY KEY CHECK (id = 1),
  enabled     BOOLEAN NOT NULL DEFAULT false,
  days        INTEGER NOT NULL DEFAULT 180 CHECK (days BETWEEN 30 AND 3650),
  updated_by  ulid REFERENCES app_user(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO retention_setting (id) VALUES (1);

ALTER TABLE vacancy
  ADD COLUMN legal_hold         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN legal_hold_matter  TEXT,
  ADD COLUMN legal_hold_by      ulid REFERENCES app_user(id),
  ADD COLUMN legal_hold_at      TIMESTAMPTZ;

-- One row per purge run: counts only, never candidate data. Append-only for the app role.
CREATE TABLE retention_certificate (
  id            ulid PRIMARY KEY,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger       TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  days          INTEGER NOT NULL,
  cutoff        TIMESTAMPTZ NOT NULL,
  documents     INTEGER NOT NULL DEFAULT 0,
  held_back     INTEGER NOT NULL DEFAULT 0,   -- expired but kept because of a legal hold
  vacancies     INTEGER NOT NULL DEFAULT 0,
  actor_id      ulid NOT NULL REFERENCES app_user(id)
);
CREATE INDEX retention_certificate_run_idx ON retention_certificate (run_at DESC);

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON retention_setting TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT ON retention_certificate TO cv_app');
