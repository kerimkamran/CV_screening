DROP TABLE IF EXISTS decision;
DROP FUNCTION IF EXISTS forbid_mutation();
DROP TABLE IF EXISTS requirement_assessment;
DROP TABLE IF EXISTS screening;
DROP TABLE IF EXISTS cv_document;
ALTER TABLE requirement DROP CONSTRAINT IF EXISTS disqualifier_rule,
  DROP COLUMN IF EXISTS position, DROP COLUMN IF EXISTS rule;
ALTER TABLE vacancy DROP COLUMN IF EXISTS candidate_notice_confirmed_by,
  DROP COLUMN IF EXISTS candidate_notice_confirmed_at;
DROP TYPE IF EXISTS decision_outcome;
DROP TYPE IF EXISTS screening_state;
DROP TYPE IF EXISTS parse_status;
DROP TYPE IF EXISTS req_status;
