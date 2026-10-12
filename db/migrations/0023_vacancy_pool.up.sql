-- 0023 Vacancy pool and decision marks (Development Plan, UAT round 1: WP 1.2, 3.1, 3.2).
-- A vacancy gets a status, an archive flag, the "More details" fields, a stored link and a
-- version for concurrent edits. Each saved change to the requirements raises
-- requirements_version, writes a history row, and makes earlier matches "out of date".
-- Decision marks reuse the append-only `decision` table: a mark belongs to a resume in a
-- vacancy (its latest row across the resume's screenings), so a re-analysis keeps it.

CREATE TYPE vacancy_status AS ENUM ('draft', 'open', 'on_hold', 'closed');

ALTER TABLE vacancy
  ADD COLUMN status               vacancy_status NOT NULL DEFAULT 'draft',
  ADD COLUMN experience_range     TEXT NOT NULL DEFAULT 'any'
    CHECK (experience_range IN ('any', '1-3', '3-5', '5+')),
  ADD COLUMN openings             INTEGER CHECK (openings IS NULL OR openings BETWEEN 1 AND 1000),
  ADD COLUMN closing_date         DATE,
  ADD COLUMN hiring_manager       TEXT,
  ADD COLUMN notes                TEXT,
  ADD COLUMN source_type          TEXT NOT NULL DEFAULT 'typed'
    CHECK (source_type IN ('typed', 'pasted', 'file', 'url')),
  ADD COLUMN source_file_name     TEXT,
  ADD COLUMN link_url             TEXT,
  ADD COLUMN link_read_at         TIMESTAMPTZ,
  ADD COLUMN link_status          TEXT CHECK (link_status IN ('read', 'unreadable')),
  ADD COLUMN link_text_hash       CHAR(64),
  ADD COLUMN requirements_version INTEGER NOT NULL DEFAULT 1 CHECK (requirements_version >= 1),
  ADD COLUMN version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_by           ulid REFERENCES app_user(id),
  ADD COLUMN archived_at          TIMESTAMPTZ,
  ADD COLUMN archived_by          ulid REFERENCES app_user(id);

-- The requirements version a frozen set was made at; a match is out of date when it is lower
-- than the vacancy's. Frozen sets are immutable (trigger), so the column is filled for them by
-- briefly disabling the guard for this one backfill; new sets get it while still drafts.
ALTER TABLE requirement_set ADD COLUMN requirements_version INTEGER;
ALTER TABLE requirement_set DISABLE TRIGGER requirement_set_frozen_guard;
UPDATE requirement_set SET requirements_version = version;
ALTER TABLE requirement_set ENABLE TRIGGER requirement_set_frozen_guard;

-- Existing data: vacancies that already hold resumes are Open; sets keep their own number.
UPDATE vacancy SET updated_at = created_at;
UPDATE vacancy v SET status = 'open'
 WHERE EXISTS (SELECT 1 FROM cv_document d WHERE d.vacancy_id = v.id);
UPDATE vacancy v SET requirements_version = COALESCE(
  (SELECT max(version) FROM requirement_set s WHERE s.vacancy_id = v.id AND s.frozen_at IS NOT NULL), 1);

-- History of the requirements and the text (spec 6.7 "History"): append-only.
CREATE TABLE vacancy_history (
  id                   ulid PRIMARY KEY,
  vacancy_id           ulid NOT NULL REFERENCES vacancy(id),
  requirements_version INTEGER NOT NULL,
  changed_by           ulid NOT NULL REFERENCES app_user(id),
  changed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  cause                TEXT NOT NULL CHECK (cause IN ('create', 'edit', 'reread', 'restore')),
  changes              JSONB NOT NULL DEFAULT '[]',   -- [{field, requirement?, from, to}]
  description          TEXT,                          -- the full text at that version
  link_url             TEXT
);
CREATE INDEX vacancy_history_idx ON vacancy_history (vacancy_id, changed_at DESC, id DESC);
CREATE TRIGGER vacancy_history_no_update BEFORE UPDATE OR DELETE ON vacancy_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER vacancy_history_no_truncate BEFORE TRUNCATE ON vacancy_history
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
SELECT app_grant('GRANT SELECT, INSERT ON vacancy_history TO cv_app');

-- Decision marks: New, Shortlist, Maybe, Not now. `hold` stays "Maybe" and `reject` stays
-- "Not now" (the earlier names are kept so old rows read the same); `new` clears a mark.
ALTER TYPE decision_outcome ADD VALUE IF NOT EXISTS 'new';
ALTER TABLE decision ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE decision DROP CONSTRAINT IF EXISTS decision_reason_check;
ALTER TABLE decision ADD CONSTRAINT decision_reason_check
  CHECK (reason IS NULL OR length(btrim(reason)) >= 1);

CREATE INDEX screening_document_idx ON screening (document_id, requirement_set_id);
CREATE INDEX cv_document_vacancy_idx2 ON cv_document (vacancy_id) WHERE erased_at IS NULL;
