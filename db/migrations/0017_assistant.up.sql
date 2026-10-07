-- 0017 the assistant, working name "Elon", and its admin controls (design spec 6.6).
-- It explains the stored match; it never scores, ranks, marks or decides. What it is given is a
-- minimised, redacted evidence package built by the server (see assistant-rules.ts); this schema
-- holds only its settings and the conversations.

CREATE TABLE assistant_setting (
  singleton                BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  -- Off until an administrator has chosen a model and recorded the data terms.
  enabled                  BOOLEAN NOT NULL DEFAULT false,
  -- Configurable, not a brand: the final name is still open.
  name                     TEXT NOT NULL DEFAULT 'Elon' CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
  -- NULL = the same model as scoring.
  model_row_id             ulid REFERENCES ai_model(id) ON DELETE SET NULL,
  feat_challenge           BOOLEAN NOT NULL DEFAULT true,
  feat_compare             BOOLEAN NOT NULL DEFAULT true,
  feat_interview           BOOLEAN NOT NULL DEFAULT true,
  feat_challenge_recruiter BOOLEAN NOT NULL DEFAULT true,
  unavailable_message      TEXT NOT NULL DEFAULT 'Elon is unavailable right now. The results and the evidence are not affected.'
                           CHECK (char_length(unavailable_message) BETWEEN 1 AND 300),
  -- What the provider may do with the data, and who said so.
  region_allowed           TEXT NOT NULL DEFAULT '' CHECK (char_length(region_allowed) <= 200),
  data_terms               TEXT NOT NULL DEFAULT 'unknown'
                           CHECK (data_terms IN ('unknown', 'no_retention', 'retained_no_training', 'retained_may_train')),
  attested_by              ulid REFERENCES app_user(id),
  attested_at              TIMESTAMPTZ,
  -- Answers per day and per month; NULL = no limit.
  daily_cap                INT CHECK (daily_cap IS NULL OR daily_cap >= 0),
  monthly_cap              INT CHECK (monthly_cap IS NULL OR monthly_cap >= 0),
  warn_pct                 INT NOT NULL DEFAULT 80 CHECK (warn_pct BETWEEN 1 AND 100),
  -- The model that last passed "Test connection"; a model is only activated after a test.
  tested_model_key         TEXT,
  tested_at                TIMESTAMPTZ,
  updated_by               ulid REFERENCES app_user(id),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO assistant_setting (singleton) VALUES (true);

-- One thread per candidate per recruiter; private to the recruiter. Deleting is soft, so a
-- compliance review still sees what was asked until retention removes it.
CREATE TABLE assistant_thread (
  id           ulid PRIMARY KEY,
  vacancy_id   ulid NOT NULL REFERENCES vacancy(id),
  screening_id ulid NOT NULL REFERENCES screening(id),
  user_id      ulid NOT NULL REFERENCES app_user(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX assistant_thread_live_uq ON assistant_thread (screening_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX assistant_thread_vacancy_idx ON assistant_thread (vacancy_id);

-- The per-turn record. Assistant rows carry what a compliance review needs: when, who (through the
-- thread), which pseudonym, which package, which model and prompt, the answer with its citations
-- and the flags. Raw CVs are never copied here.
CREATE TABLE assistant_message (
  id              ulid PRIMARY KEY,
  thread_id       ulid NOT NULL REFERENCES assistant_thread(id),
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         JSONB NOT NULL,
  label           TEXT,
  model           TEXT,
  prompt_version  TEXT,
  package_version INT,
  flags           TEXT[] NOT NULL DEFAULT '{}',
  counted         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_message_thread_idx ON assistant_message (thread_id, created_at, id);
CREATE INDEX assistant_message_usage_idx ON assistant_message (created_at) WHERE counted;

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON assistant_setting TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_thread TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT, DELETE ON assistant_message TO cv_app');
