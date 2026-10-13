-- 0030 Skills dictionary entries added by administrators (SenAI plan 5.1 F7, 13.2 C9).
-- A recruiter may suggest a word ("proposed"); an administrator approves or rejects it. Only approved
-- entries are read by SenAI. A built-in skill is never changed: an entry either adds a new skill or
-- adds more ways to write a built-in one (extends_skill).
CREATE TABLE assistant_skill (
  id            ulid PRIMARY KEY,
  skill_id      TEXT NOT NULL CHECK (skill_id ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  label         TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  kind          TEXT NOT NULL CHECK (kind IN ('tool', 'language', 'domain', 'certificate')),
  aliases       TEXT[] NOT NULL CHECK (cardinality(aliases) BETWEEN 1 AND 20),
  extends_skill TEXT,
  status        TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  proposed_by   ulid NOT NULL REFERENCES app_user(id),
  decided_by    ulid REFERENCES app_user(id),
  decided_at    TIMESTAMPTZ,
  note          TEXT CHECK (note IS NULL OR length(note) <= 300),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One live entry per new skill; any number of entries may extend the same built-in skill.
CREATE UNIQUE INDEX assistant_skill_new_uq ON assistant_skill (skill_id)
  WHERE extends_skill IS NULL AND status <> 'rejected';
CREATE INDEX assistant_skill_status_idx ON assistant_skill (status, created_at);
SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON assistant_skill TO cv_app');
