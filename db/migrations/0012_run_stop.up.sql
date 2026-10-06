-- 0012 stop a scan (design spec 6.3). A stopped screening keeps what was already scored; the files
-- still waiting are marked here, the worker skips them, and "Continue" clears the mark.
-- Nothing is deleted: a stopped file is shown as "Stopped before reading", never hidden.

ALTER TABLE screening ADD COLUMN cancelled_at TIMESTAMPTZ;
CREATE INDEX screening_waiting_idx ON screening (created_at) WHERE state = 'queued' AND cancelled_at IS NULL;
