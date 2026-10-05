-- Back to the fixed three-provider table. Stored keys are NOT carried back (their bound context
-- differs); an administrator re-enters them.
CREATE TYPE ai_provider_kind AS ENUM ('anthropic', 'openai', 'gemini');

CREATE TABLE ai_provider_config (
  provider       ai_provider_kind PRIMARY KEY,
  model          TEXT NOT NULL CHECK (length(btrim(model)) > 0),
  key_ciphertext TEXT,
  key_hint       TEXT,
  updated_by     ulid REFERENCES app_user(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT key_and_hint CHECK ((key_ciphertext IS NULL) = (key_hint IS NULL))
);
INSERT INTO ai_provider_config (provider, model) VALUES
  ('anthropic', 'claude-sonnet-4-5'),
  ('openai',    'gpt-4.1'),
  ('gemini',    'gemini-2.5-flash');

ALTER TABLE ai_setting ADD COLUMN active_provider ai_provider_kind REFERENCES ai_provider_config(provider);
ALTER TABLE ai_setting DROP COLUMN active_model;
SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON ai_provider_config TO cv_app');
DROP TABLE ai_model;
DROP TABLE ai_connection;
