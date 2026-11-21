-- Dropping the tombstone list would let erased candidates be imported again. Refuse while it holds
-- a row, unless the operator sets parallax.allow_tombstone_drop = 'on' for this session on purpose.
DO $$
BEGIN
  IF to_regclass('import_tombstone') IS NOT NULL
     AND EXISTS (SELECT 1 FROM import_tombstone)
     AND coalesce(current_setting('parallax.allow_tombstone_drop', true), '') <> 'on' THEN
    RAISE EXCEPTION 'import_tombstone holds rows: set parallax.allow_tombstone_drop = on to drop it';
  END IF;
END $$;

DROP TABLE IF EXISTS import_tombstone;
DROP TABLE IF EXISTS import_item;
DROP TABLE IF EXISTS import_run;
ALTER TABLE upload_batch DROP COLUMN IF EXISTS source;
