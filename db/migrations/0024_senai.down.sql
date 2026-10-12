ALTER TABLE assistant_setting ALTER COLUMN name SET DEFAULT 'Elon';
ALTER TABLE assistant_setting ALTER COLUMN unavailable_message
  SET DEFAULT 'Elon is unavailable right now. The results and the evidence are not affected.';
UPDATE assistant_setting SET name = 'Elon' WHERE name = 'SenAI';
UPDATE assistant_setting
   SET unavailable_message = 'Elon is unavailable right now. The results and the evidence are not affected.'
 WHERE unavailable_message = 'SenAI is unavailable right now. The results and the evidence are not affected.';
