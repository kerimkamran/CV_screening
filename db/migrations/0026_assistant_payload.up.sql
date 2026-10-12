-- 0026 SenAI payload log (Development Plan WP 4.2): for every call to a model, which fields went out,
-- their types and longest length, plus a hash and size of the request. Shapes only, never the text,
-- so the log cannot become a second copy of the resumes. Rows go with the resume when it is erased.
CREATE TABLE assistant_payload (
  id          ulid PRIMARY KEY,
  screening_id ulid REFERENCES screening(id),
  vacancy_id  ulid REFERENCES vacancy(id),
  intent      TEXT NOT NULL,
  model       TEXT,
  prompt_version TEXT NOT NULL,
  fields      JSONB NOT NULL,
  violations  TEXT[] NOT NULL DEFAULT '{}',
  bytes       INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_payload_created_idx ON assistant_payload (created_at DESC);
CREATE INDEX assistant_payload_screening_idx ON assistant_payload (screening_id);

SELECT app_grant('GRANT SELECT, INSERT, DELETE ON assistant_payload TO cv_app');
