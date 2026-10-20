DROP INDEX IF EXISTS screening_lease_idx;
ALTER TABLE screening DROP COLUMN IF EXISTS lease_until;
ALTER TABLE screening DROP COLUMN IF EXISTS claim_id;
