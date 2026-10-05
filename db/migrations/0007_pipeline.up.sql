-- 0007 screening pipeline (MVP): CV documents, per-criteria screening results, requirement
-- assessments with verified evidence, and append-only human decisions.
-- Invariants held in the database, not only in code:
--   * `decision` is append-only (UPDATE/DELETE/TRUNCATE rejected), and every row names a human.
--   * a score may not exist without its breakdown (SCORE-03).
--   * a document is unique per vacancy by content hash (dedupe).

CREATE TYPE req_status      AS ENUM ('met', 'partially_met', 'not_met', 'not_found', 'ambiguous', 'not_applicable');
CREATE TYPE parse_status    AS ENUM ('parsed', 'empty', 'failed');
CREATE TYPE screening_state AS ENUM ('queued', 'processing', 'completed', 'failed', 'manual');
CREATE TYPE decision_outcome AS ENUM ('shortlist', 'hold', 'reject');

-- Deployer duty (EU AI Act Art. 26(7) / GDPR Art. 13-14): the recruiter attests, per vacancy,
-- that candidates have been told AI assists screening. Uploads are refused until confirmed.
ALTER TABLE vacancy
  ADD COLUMN candidate_notice_confirmed_at TIMESTAMPTZ,
  ADD COLUMN candidate_notice_confirmed_by ulid REFERENCES app_user(id);

-- Disqualifier rules are structured, so knockout can be evaluated with no model call (KNOCK-01).
--   {"type":"must_contain_any","terms":["driving licence","B category"]}
--   {"type":"must_not_contain_any","terms":["..."]}
ALTER TABLE requirement
  ADD COLUMN rule     JSONB,
  ADD COLUMN position INT NOT NULL DEFAULT 0,
  ADD CONSTRAINT disqualifier_rule CHECK ((classification = 'disqualifier') = (rule IS NOT NULL));

CREATE TABLE cv_document (
  id           ulid PRIMARY KEY,
  vacancy_id   ulid NOT NULL REFERENCES vacancy(id),
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size_bytes   INT  NOT NULL,
  sha256       CHAR(64) NOT NULL,
  content      BYTEA,                      -- original file; NULL after erasure
  text         TEXT,                       -- extracted text; evidence offsets refer to this exact string
  text_truncated BOOLEAN NOT NULL DEFAULT false,
  parse_status parse_status NOT NULL,
  parse_error  TEXT,
  uploaded_by  ulid NOT NULL REFERENCES app_user(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  erased_at    TIMESTAMPTZ,
  erased_by    ulid REFERENCES app_user(id),
  UNIQUE (vacancy_id, sha256)
);
CREATE INDEX cv_document_vacancy_idx ON cv_document (vacancy_id, uploaded_at DESC);

CREATE TABLE screening (
  id                   ulid PRIMARY KEY,
  document_id          ulid NOT NULL REFERENCES cv_document(id),
  requirement_set_id   ulid NOT NULL REFERENCES requirement_set(id),
  state                screening_state NOT NULL DEFAULT 'queued',
  attempts             INT NOT NULL DEFAULT 0,
  run_after            TIMESTAMPTZ NOT NULL DEFAULT now(),   -- retry back-off
  candidate_name       TEXT,               -- AI-extracted, unverified
  candidate_email      TEXT,
  summary              TEXT,               -- AI-generated explanation; labelled as such in the UI
  knockout             JSONB,              -- deterministic; [{requirementId, triggered, matchedTerms}]
  knockout_triggered   BOOLEAN NOT NULL DEFAULT false,
  injection_suspected  BOOLEAN NOT NULL DEFAULT false,
  score                NUMERIC(5,2) CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  breakdown            JSONB,
  band                 TEXT CHECK (band IN ('strong_match', 'possible_match', 'weak_match', 'needs_review')),
  ai_provider          TEXT,
  ai_model             TEXT,
  error                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  UNIQUE (document_id, requirement_set_id),
  -- SCORE-03: a score never exists without the breakdown that explains it.
  CONSTRAINT score_has_breakdown CHECK (score IS NULL OR breakdown IS NOT NULL)
);
CREATE INDEX screening_queue_idx ON screening (run_after) WHERE state = 'queued';
CREATE INDEX screening_set_idx   ON screening (requirement_set_id);

CREATE TABLE requirement_assessment (
  id             ulid PRIMARY KEY,
  screening_id   ulid NOT NULL REFERENCES screening(id),
  requirement_id ulid NOT NULL REFERENCES requirement(id),
  status         req_status NOT NULL,
  confidence     confidence_level NOT NULL,
  evidence       JSONB NOT NULL DEFAULT '[]',   -- [{start,end,quote}] — every quote verified present in document text
  evidence_dropped INT NOT NULL DEFAULT 0,      -- quotes the model supplied that were NOT found verbatim
  rationale      TEXT,
  UNIQUE (screening_id, requirement_id)
);

-- Human decisions: append-only; the AI never writes here. Current decision = latest row.
CREATE TABLE decision (
  id           ulid PRIMARY KEY,
  screening_id ulid NOT NULL REFERENCES screening(id),
  outcome      decision_outcome NOT NULL,
  reason       TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  decided_by   ulid NOT NULL REFERENCES app_user(id),
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX decision_screening_idx ON decision (screening_id, decided_at DESC);

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;
CREATE TRIGGER decision_no_update BEFORE UPDATE OR DELETE ON decision
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER decision_no_truncate BEFORE TRUNCATE ON decision
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON cv_document, screening TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT, DELETE ON requirement_assessment TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT ON decision TO cv_app');
