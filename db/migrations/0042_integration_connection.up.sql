-- 0042 Oracle connection and the vacancy link (Stage 3, S3-INT-06; plan 5.2, 15.1).
-- One row per external system. The password (or client secret) is AES-GCM ciphertext bound to the
-- row (SettingsCrypto); only a hint is ever shown. settings holds the Advanced switches; a missing
-- key reads as its default (linkPolicy open, requireEuAi on, goneInSource flag).
-- The vacancy reuses external_ref (0001) and its unique index; the new columns say which system
-- and who linked it.
SET lock_timeout = '10s';

CREATE TABLE integration_connection (
  id                    ulid PRIMARY KEY,
  system                TEXT NOT NULL UNIQUE CHECK (system IN ('oracle_hcm')),
  base_url              TEXT NOT NULL,       -- origin only, validated by the address rule
  token_url             TEXT,                -- Advanced: OAuth only
  auth_mode             TEXT NOT NULL DEFAULT 'basic'
                        CHECK (auth_mode IN ('basic','oauth_client_credentials','oauth_jwt_assertion')),
  principal_name        TEXT NOT NULL,
  settings              JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext     TEXT,
  secret_hint           TEXT,
  secret_set_at         TIMESTAMPTZ,
  secret_expires_on     DATE,
  client_secret_ciphertext TEXT,             -- Advanced: OAuth client secret
  notice_attested_by    ulid REFERENCES app_user(id),
  notice_attested_at    TIMESTAMPTZ,
  notice_version        TEXT,
  notice_effective_from DATE,                -- NULL = no cut-off (plan 15.3 note 13)
  enabled               BOOLEAN NOT NULL DEFAULT false,
  enabled_at            TIMESTAMPTZ,
  auth_failed_at        TIMESTAMPTZ,
  last_test_at          TIMESTAMPTZ,
  last_test_code        TEXT,
  budget_day            DATE,
  calls_used            INT NOT NULL DEFAULT 0 CHECK (calls_used >= 0),
  updated_by            ulid REFERENCES app_user(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vacancy
  ADD COLUMN external_system     TEXT CHECK (external_system IN ('oracle_hcm')),
  ADD COLUMN external_id         TEXT,
  ADD COLUMN external_link_state TEXT CHECK (external_link_state IN ('proposed','approved')),
  ADD COLUMN external_linked_by  ulid REFERENCES app_user(id),
  ADD COLUMN external_linked_at  TIMESTAMPTZ,
  ADD COLUMN external_approved_by ulid REFERENCES app_user(id),
  ADD COLUMN external_approved_at TIMESTAMPTZ;

-- Backfill: a vacancy that already carries a key (none in production today) is an Oracle link.
UPDATE vacancy SET external_system = 'oracle_hcm', external_link_state = 'approved'
 WHERE external_ref IS NOT NULL AND external_system IS NULL;

ALTER TABLE vacancy ADD CONSTRAINT vacancy_external_complete
  CHECK ((external_ref IS NULL) = (external_system IS NULL)) NOT VALID;
ALTER TABLE vacancy VALIDATE CONSTRAINT vacancy_external_complete;

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON integration_connection TO cv_app');
