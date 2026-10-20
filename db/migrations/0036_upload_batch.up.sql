-- 0036 Upload batches and reliable intake (Stage 2, S2-BE2 / S2-BE3).
-- One batch per upload action, one item per file the browser announces. The item holds the
-- per-file outcome on the server, so progress survives a reload and a second device.
-- upload_item is a working table (UPDATE allowed); intake_skip stays append-only and only gains a link.
SET lock_timeout = '10s';

CREATE TABLE upload_batch (
  id          ulid PRIMARY KEY,
  vacancy_id  ulid NOT NULL REFERENCES vacancy(id),
  created_by  ulid NOT NULL REFERENCES app_user(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_count  INT NOT NULL CHECK (file_count > 0)
);
CREATE INDEX upload_batch_vacancy_idx ON upload_batch (vacancy_id, created_at DESC);

CREATE TABLE upload_item (
  id             ulid PRIMARY KEY,
  batch_id       ulid NOT NULL REFERENCES upload_batch(id),
  parent_item_id ulid REFERENCES upload_item(id),          -- an entry unpacked from a ZIP item
  position       INT NOT NULL,
  filename       TEXT NOT NULL,
  client_path    TEXT,
  size_bytes     BIGINT NOT NULL,
  outcome        TEXT CHECK (outcome IN ('queued','duplicate','unreadable','rejected','skipped')), -- NULL = not received
  code           TEXT,
  message        TEXT,
  document_id    ulid REFERENCES cv_document(id),
  received_at    TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (batch_id, parent_item_id, position)
);
CREATE INDEX upload_item_document_idx ON upload_item (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX upload_item_batch_idx ON upload_item (batch_id, position);

ALTER TABLE intake_skip ADD COLUMN upload_item_id ulid REFERENCES upload_item(id);

-- A document that was erased keeps its hash, so the same file may be uploaded again later:
-- only live documents must be unique inside a vacancy.
ALTER TABLE cv_document DROP CONSTRAINT cv_document_vacancy_id_sha256_key;
CREATE UNIQUE INDEX cv_document_live_sha_idx ON cv_document (vacancy_id, sha256) WHERE erased_at IS NULL;

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON upload_batch, upload_item TO cv_app');
