-- external_ref itself (0001) is kept, so a linked vacancy keeps its requisition number.
ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_external_complete;
ALTER TABLE vacancy
  DROP COLUMN IF EXISTS external_approved_at,
  DROP COLUMN IF EXISTS external_approved_by,
  DROP COLUMN IF EXISTS external_linked_at,
  DROP COLUMN IF EXISTS external_linked_by,
  DROP COLUMN IF EXISTS external_link_state,
  DROP COLUMN IF EXISTS external_id,
  DROP COLUMN IF EXISTS external_system;
DROP TABLE IF EXISTS integration_connection;
