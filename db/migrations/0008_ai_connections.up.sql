-- 0008 AI connections and models (MVP). Replaces the fixed three-provider table: an ADMIN can add
-- any number of AI companies ("connections", each with ONE api key), choose any number of models
-- from each company's own model list, and decide which single model screening uses.
-- Keys stay AES-256-GCM encrypted by the application; `key_aad` is the bound context for decryption.

CREATE TABLE ai_connection (
  id             ulid PRIMARY KEY,
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind           TEXT NOT NULL CHECK (kind IN ('anthropic', 'openai', 'gemini', 'openai_compatible')),
  base_url       TEXT,                 -- only for openai_compatible (Mistral, DeepSeek, Groq, ...)
  key_ciphertext TEXT NOT NULL,        -- base64(iv | tag | ciphertext)
  key_hint       TEXT NOT NULL,        -- last 4 characters, to recognise the key
  key_aad        TEXT NOT NULL,        -- AES-GCM additional authenticated data for this row
  updated_by     ulid REFERENCES app_user(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT base_url_only_for_compatible CHECK ((kind = 'openai_compatible') = (base_url IS NOT NULL)),
  CONSTRAINT base_url_is_https CHECK (base_url IS NULL OR base_url ~ '^https://[^/@ ]+(/[^ ]*)?$')
);
CREATE UNIQUE INDEX ai_connection_name_uq ON ai_connection (lower(name));

CREATE TABLE ai_model (
  id            ulid PRIMARY KEY,
  connection_id ulid NOT NULL REFERENCES ai_connection(id) ON DELETE CASCADE,
  model_id      TEXT NOT NULL CHECK (length(btrim(model_id)) > 0),
  label         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, model_id)
);

ALTER TABLE ai_setting ADD COLUMN active_model ulid REFERENCES ai_model(id) ON DELETE SET NULL;

-- Carry over anything stored under the old design (keys keep their original AAD).
DO $$
DECLARE r RECORD; cid TEXT; mid TEXT;
BEGIN
  FOR r IN SELECT c.*, (s.active_provider = c.provider) AS is_active
             FROM ai_provider_config c CROSS JOIN ai_setting s WHERE c.key_ciphertext IS NOT NULL LOOP
    cid := upper(substr(md5(random()::text || clock_timestamp()::text || r.provider::text), 1, 26));
    mid := upper(substr(md5(random()::text || clock_timestamp()::text || r.model), 1, 26));
    INSERT INTO ai_connection (id, name, kind, key_ciphertext, key_hint, key_aad, updated_by)
      VALUES (cid,
              CASE r.provider WHEN 'anthropic' THEN 'Anthropic' WHEN 'openai' THEN 'OpenAI' ELSE 'Google' END,
              r.provider::text, r.key_ciphertext, r.key_hint, r.provider::text, r.updated_by);
    INSERT INTO ai_model (id, connection_id, model_id, label) VALUES (mid, cid, r.model, r.model);
    IF r.is_active THEN UPDATE ai_setting SET active_model = mid; END IF;
  END LOOP;
END $$;

ALTER TABLE ai_setting DROP COLUMN active_provider;
DROP TABLE ai_provider_config;
DROP TYPE ai_provider_kind;

SELECT app_grant('GRANT SELECT, INSERT, UPDATE, DELETE ON ai_connection, ai_model TO cv_app');
