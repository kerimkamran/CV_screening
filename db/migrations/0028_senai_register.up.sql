-- 0028 SenAI remembers what the last answer was about (SenAI plan 3.2 rule 3): the previous query,
-- the candidates it listed (by match id, in order) and the language. A follow-up such as
-- "ingilis dili" or "the second one" is read against it. It holds identifiers only, never a resume.
ALTER TABLE assistant_conversation ADD COLUMN register JSONB;

-- A pool answer that needed the model (to understand the question) counts toward the daily and
-- monthly answer limits, like any other model answer.
ALTER TABLE assistant_pool_message ADD COLUMN counted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE assistant_pool_message ADD COLUMN model TEXT;
