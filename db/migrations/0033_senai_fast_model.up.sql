-- 0033 SenAI: an optional second, faster model that only reads questions (plan: two model slots).
-- NULL = the answer model reads questions too. Deleting the model row clears the slot.
ALTER TABLE assistant_setting
  ADD COLUMN understand_model_id ulid REFERENCES ai_model(id) ON DELETE SET NULL;
