-- 0041 Oracle CV import, Phase 2 (Stage 3, S3-INT-01; plan 5.2, 15.1).
-- One import_run per Import or Refresh click; one import_item per application with a CV to fetch;
-- import_tombstone is the append-only suppression list (erased or purged candidates never return).
-- Raw Oracle IDs live on import_item and import_run.list_cursor only while a run is active.
-- Value lists are CHECKs on TEXT (no CREATE TYPE), so the taxonomy parity check is unchanged.
-- wait_reason and error_code are free text, as upload_item.code is.
SET lock_timeout = '10s';

ALTER TABLE upload_batch ADD COLUMN source TEXT NOT NULL DEFAULT 'browser'
  CONSTRAINT upload_batch_source_ck CHECK (source IN ('browser', 'oracle_hcm'));

CREATE TABLE import_run (
  id                  ulid PRIMARY KEY,
  vacancy_id          ulid NOT NULL REFERENCES vacancy(id),
  batch_id            ulid UNIQUE REFERENCES upload_batch(id),
  kind                TEXT NOT NULL DEFAULT 'oracle_hcm' CHECK (kind IN ('oracle_hcm')),
  mode                TEXT NOT NULL CHECK (mode IN ('import', 'refresh')),
  state               TEXT NOT NULL DEFAULT 'queued'
                      CHECK (state IN ('queued','running','awaiting_confirm','completed','failed','cancelled')),
  phase               TEXT NOT NULL DEFAULT 'listing' CHECK (phase IN ('listing', 'fetching')),
  external_ref        TEXT,          -- the requisition number the recruiter typed
  external_id         TEXT,          -- Oracle's requisition ID, read by the server
  list_cursor         TEXT,          -- an application ID: cleared when the run ends
  listed              INT NOT NULL DEFAULT 0 CHECK (listed >= 0),
  estimate            INT CHECK (estimate >= 0),
  confirm_reason      TEXT CHECK (confirm_reason IN ('above_estimate','above_room','above_estimate_and_room')),
  projected_bytes     BIGINT NOT NULL DEFAULT 0,
  fetched_bytes       BIGINT NOT NULL DEFAULT 0,
  attempts            INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_after           TIMESTAMPTZ,
  wait_reason         TEXT,
  waited_since        TIMESTAMPTZ,
  claim_id            TEXT,
  lease_until         TIMESTAMPTZ,
  progress_at         TIMESTAMPTZ,
  error_code          TEXT,
  stats               JSONB NOT NULL DEFAULT '{}'::jsonb, -- whole numbers only
  started_by          ulid NOT NULL REFERENCES app_user(id),
  started_ip          TEXT,
  confirmed_by        ulid REFERENCES app_user(id),
  confirmed_at        TIMESTAMPTZ,
  awaiting_since      TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  cancel_requested_by ulid REFERENCES app_user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  CONSTRAINT import_run_finished_ck CHECK (
    (state IN ('completed','failed','cancelled')) = (finished_at IS NOT NULL))
);
-- Double click and Refresh-while-running safe: one active run per vacancy.
CREATE UNIQUE INDEX import_run_one_active_uq ON import_run (vacancy_id)
  WHERE state IN ('queued','running','awaiting_confirm');
CREATE INDEX import_run_claim_idx ON import_run (state, run_after) WHERE state IN ('queued','running');
CREATE INDEX import_run_vacancy_idx ON import_run (vacancy_id, created_at DESC);

CREATE TABLE import_item (
  id                      ulid PRIMARY KEY,
  run_id                  ulid NOT NULL REFERENCES import_run(id),
  vacancy_id              ulid NOT NULL REFERENCES vacancy(id),
  system                  TEXT NOT NULL DEFAULT 'oracle_hcm' CHECK (system IN ('oracle_hcm')),
  seq                     INT NOT NULL CHECK (seq > 0),
  external_application_id TEXT,      -- NULLed when the run ends or on erase
  external_attachment_id  TEXT,      -- NULLed when the run ends or on erase
  app_key_hash            CHAR(64) NOT NULL,
  att_key_hash            CHAR(64) NOT NULL,
  person_key_hash         CHAR(64) NOT NULL, -- hash of person and requisition together
  key_version             INT NOT NULL CHECK (key_version > 0),
  external_applied_at     TIMESTAMPTZ,
  size_bytes              BIGINT,
  attempts                INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  upload_item_id          ulid UNIQUE REFERENCES upload_item(id),
  document_id             ulid REFERENCES cv_document(id),
  supersedes_document_id  ulid REFERENCES cv_document(id),
  seen_in_run_id          ulid REFERENCES import_run(id),
  source_gone_at          TIMESTAMPTZ,
  UNIQUE (run_id, app_key_hash)
);
CREATE INDEX import_item_vacancy_app_idx ON import_item (vacancy_id, app_key_hash);
CREATE INDEX import_item_att_idx ON import_item (vacancy_id, att_key_hash);
CREATE INDEX import_item_document_idx ON import_item (document_id) WHERE document_id IS NOT NULL;

CREATE TABLE import_tombstone (
  id          ulid PRIMARY KEY,
  system      TEXT NOT NULL CHECK (system IN ('oracle_hcm')),
  key_kind    TEXT NOT NULL CHECK (key_kind IN ('application', 'person_requisition')),
  key_hash    CHAR(64) NOT NULL,
  key_version INT NOT NULL CHECK (key_version > 0),
  vacancy_id  ulid REFERENCES vacancy(id),
  cause       TEXT NOT NULL CHECK (cause IN ('erase', 'purge', 'source_removed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (system, key_hash)
);

CREATE TRIGGER import_tombstone_no_update BEFORE UPDATE OR DELETE ON import_tombstone
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER import_tombstone_no_truncate BEFORE TRUNCATE ON import_tombstone
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON import_run, import_item TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT ON import_tombstone TO cv_app');
