-- 0037 Worker lease (Stage 2, S2-BE4). A claimed screening carries the claim that took it and a
-- lease; the worker extends its own leases, and an expired lease goes back to the queue. Writes that
-- finish a screening must present the same claim, so a CV erased during its analysis stays erased.
SET lock_timeout = '10s';
ALTER TABLE screening ADD COLUMN claim_id ulid;
ALTER TABLE screening ADD COLUMN lease_until TIMESTAMPTZ;
CREATE INDEX screening_lease_idx ON screening (lease_until) WHERE state = 'processing';
