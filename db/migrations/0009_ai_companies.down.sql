-- Back to free-form connections. Companies the old design had no native protocol for become
-- OpenAI-compatible connections with their documented base URL.
ALTER TABLE ai_connection ADD COLUMN kind TEXT;
ALTER TABLE ai_connection ADD COLUMN base_url TEXT;
UPDATE ai_connection SET
  kind = CASE company
           WHEN 'google' THEN 'gemini'
           WHEN 'openai' THEN 'openai'
           WHEN 'anthropic' THEN 'anthropic'
           ELSE 'openai_compatible'
         END,
  base_url = CASE company
               WHEN 'zai' THEN 'https://api.z.ai/api/paas/v4'
               WHEN 'sakana' THEN 'https://api.sakana.ai/v1'
               WHEN 'nvidia' THEN 'https://integrate.api.nvidia.com/v1'
               ELSE NULL
             END;
ALTER TABLE ai_connection ALTER COLUMN kind SET NOT NULL;
ALTER TABLE ai_connection ADD CONSTRAINT ai_connection_kind_check
  CHECK (kind IN ('anthropic', 'openai', 'gemini', 'openai_compatible'));
ALTER TABLE ai_connection ADD CONSTRAINT base_url_only_for_compatible
  CHECK ((kind = 'openai_compatible') = (base_url IS NOT NULL));
ALTER TABLE ai_connection ADD CONSTRAINT base_url_is_https
  CHECK (base_url IS NULL OR base_url ~ '^https://[^/@ ]+(/[^ ]*)?$');

DROP INDEX ai_connection_company_uq;
ALTER TABLE ai_connection DROP COLUMN settings;
ALTER TABLE ai_connection DROP CONSTRAINT ai_connection_company_chk;
ALTER TABLE ai_connection DROP COLUMN company;
