-- 0020 fairness evaluation runs (plan EVAL-01/06, docs/bias-review.md): the paired-CV test sends
-- synthetic CVs that differ only in a name or a personal detail through the real scoring path and
-- records how much the score moved. Synthetic data only: no candidate data is ever used.

CREATE TABLE eval_run (
  id           ulid PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('paired_cv')),
  started_by   ulid NOT NULL REFERENCES app_user(id),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  state        TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'done', 'failed')),
  progress     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  params       JSONB NOT NULL DEFAULT '{}'::jsonb,
  result       JSONB,
  error        TEXT,
  ai_provider  TEXT,
  ai_model     TEXT
);
CREATE INDEX eval_run_started_idx ON eval_run (started_at DESC);

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON eval_run TO cv_app');
