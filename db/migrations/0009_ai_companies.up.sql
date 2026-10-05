-- 0009 Fixed company list. The administrator now chooses one of the supported AI companies
-- (Google, OpenAI, Anthropic, Z.ai, Sakana Fugu, NVIDIA) instead of typing a free-form base URL.
-- Endpoints are defined by the server, so no administrator-supplied address is ever called.
-- One connection (ONE api key) per company; non-secret options (e.g. data region) live in `settings`.

ALTER TABLE ai_connection ADD COLUMN company TEXT;
UPDATE ai_connection SET company = CASE
  WHEN kind = 'gemini' THEN 'google'
  WHEN kind IN ('openai', 'anthropic') THEN kind
  WHEN base_url LIKE 'https://api.z.ai/%' THEN 'zai'
  WHEN base_url LIKE 'https://api.sakana.ai/%' THEN 'sakana'
  WHEN base_url LIKE 'https://integrate.api.nvidia.com/%' THEN 'nvidia'
END;
-- Any other free-form "OpenAI-compatible" company cannot be mapped to the fixed list: remove it
-- (its models go with it via ON DELETE CASCADE; an active model of theirs becomes unset).
DELETE FROM ai_connection WHERE company IS NULL;
ALTER TABLE ai_connection ALTER COLUMN company SET NOT NULL;
ALTER TABLE ai_connection ADD CONSTRAINT ai_connection_company_chk
  CHECK (company IN ('google', 'openai', 'anthropic', 'zai', 'sakana', 'nvidia'));
CREATE UNIQUE INDEX ai_connection_company_uq ON ai_connection (company);
ALTER TABLE ai_connection ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(settings) = 'object');

ALTER TABLE ai_connection DROP CONSTRAINT base_url_only_for_compatible;
ALTER TABLE ai_connection DROP CONSTRAINT base_url_is_https;
ALTER TABLE ai_connection DROP COLUMN base_url;
ALTER TABLE ai_connection DROP COLUMN kind;
