-- 0024 The assistant is named SenAI (slogan "Sən istə, Senai tapsın"). The name stays configurable
-- in Admin; this only changes the default and renames an installation that still has the old
-- working name untouched.
ALTER TABLE assistant_setting ALTER COLUMN name SET DEFAULT 'SenAI';
ALTER TABLE assistant_setting ALTER COLUMN unavailable_message
  SET DEFAULT 'SenAI is unavailable right now. The results and the evidence are not affected.';
UPDATE assistant_setting SET name = 'SenAI' WHERE name = 'Elon';
UPDATE assistant_setting
   SET unavailable_message = 'SenAI is unavailable right now. The results and the evidence are not affected.'
 WHERE unavailable_message = 'Elon is unavailable right now. The results and the evidence are not affected.';
