-- 0029 SenAI ability switches and personal preferences (SenAI plan 5.1 F6, 5.2 M3, 5.4 S3, 11.5).
-- understand: a model may read a question the rules cannot (on by default, one switch to stop it).
-- rediscovery: suggestions from other vacancies' resumes (off until Legal confirms the notice).
-- link_review: reading a link the candidate gave (off; needs a recorded consent).
ALTER TABLE assistant_setting ADD COLUMN feat_understand BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE assistant_setting ADD COLUMN feat_rediscovery BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE assistant_setting ADD COLUMN feat_link_review BOOLEAN NOT NULL DEFAULT false;

-- Typed fields only, one row per person ("always show the top 10"); never free text, never facts.
CREATE TABLE assistant_preference (
  user_id    ulid PRIMARY KEY REFERENCES app_user(id),
  top_n      INT CHECK (top_n BETWEEN 1 AND 50),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT app_grant('GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_preference TO cv_app');

-- The consistency mirror (plan M2) speaks at most once per pair of resumes, per person.
CREATE TABLE assistant_mirror_seen (
  user_id ulid NOT NULL REFERENCES app_user(id),
  doc_a   ulid NOT NULL REFERENCES cv_document(id),
  doc_b   ulid NOT NULL REFERENCES cv_document(id),
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, doc_a, doc_b)
);
SELECT app_grant('GRANT SELECT, INSERT ON assistant_mirror_seen TO cv_app');
