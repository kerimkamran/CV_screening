-- 0006 admin-managed AI providers (MVP). An ADMIN stores up to three provider keys and picks
-- which one is active. Keys are AES-256-GCM encrypted by the application (master key in env,
-- never in the database); no endpoint ever returns them.

CREATE TYPE ai_provider_kind AS ENUM ('anthropic', 'openai', 'gemini');

CREATE TABLE ai_provider_config (
  provider       ai_provider_kind PRIMARY KEY,
  model          TEXT NOT NULL CHECK (length(btrim(model)) > 0),
  key_ciphertext TEXT,                 -- base64(iv | tag | ciphertext); NULL = no key stored
  key_hint       TEXT,                 -- last 4 characters, for the admin to recognise the key
  updated_by     ulid REFERENCES app_user(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT key_and_hint CHECK ((key_ciphertext IS NULL) = (key_hint IS NULL))
);

INSERT INTO ai_provider_config (provider, model) VALUES
  ('anthropic', 'claude-sonnet-4-5'),
  ('openai',    'gpt-4.1'),
  ('gemini',    'gemini-2.5-flash');

-- Singleton: exactly one row says which provider is active (NULL until an admin chooses).
CREATE TABLE ai_setting (
  singleton       BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  active_provider ai_provider_kind REFERENCES ai_provider_config(provider),
  updated_by      ulid REFERENCES app_user(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ai_setting (singleton) VALUES (true);

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON ai_provider_config, ai_setting TO cv_app');
