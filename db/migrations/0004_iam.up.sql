-- 0004 identity & access (IAM-03, IAM-04). Plan §4.3 IAM exit criteria:
--  * roles are least-privilege by default: a new user can see nothing until granted
--  * access changes are audited (rows here are never deleted; revocation is recorded)
--  * every write carries a named principal (created_by columns now reference app_user)

CREATE TYPE app_role   AS ENUM ('TA_PARTNER', 'TA_LEAD', 'GOVERNANCE', 'ADMIN', 'SERVICE');
CREATE TYPE user_status AS ENUM ('active', 'disabled');

-- Provisioned on first sign-in with NO roles. (issuer, subject) is the stable IdP identity.
-- Org membership is deliberately not modelled yet (single tenant); tenancy sits on vacancy.org_id.
CREATE TABLE app_user (
  id           ulid PRIMARY KEY,
  issuer       TEXT NOT NULL,
  subject      TEXT NOT NULL,
  actor_kind   actor_kind NOT NULL,
  status       user_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE role_assignment (
  id         ulid PRIMARY KEY,
  user_id    ulid NOT NULL REFERENCES app_user(id),
  role       app_role NOT NULL,
  granted_by ulid NOT NULL REFERENCES app_user(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by ulid REFERENCES app_user(id),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT revocation_complete CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX role_assignment_active_uq ON role_assignment (user_id, role) WHERE revoked_at IS NULL;

-- IAM-04: per-vacancy scope for recruiters.
CREATE TABLE vacancy_access (
  id         ulid PRIMARY KEY,
  vacancy_id ulid NOT NULL REFERENCES vacancy(id),
  user_id    ulid NOT NULL REFERENCES app_user(id),
  granted_by ulid NOT NULL REFERENCES app_user(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by ulid REFERENCES app_user(id),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT vacancy_revocation_complete CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX vacancy_access_active_uq ON vacancy_access (vacancy_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX vacancy_access_user_idx ON vacancy_access (user_id) WHERE revoked_at IS NULL;

-- Attribution is now enforceable: a "named principal" must be a real user.
ALTER TABLE vacancy                  ADD CONSTRAINT vacancy_created_by_fk     FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE job_description_version  ADD CONSTRAINT jd_version_created_by_fk  FOREIGN KEY (created_by) REFERENCES app_user(id);
ALTER TABLE requirement_set          ADD CONSTRAINT req_set_created_by_fk     FOREIGN KEY (created_by) REFERENCES app_user(id);

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON app_user, role_assignment, vacancy_access TO cv_app');
-- No DELETE anywhere: access history is evidence (revocation is an UPDATE that stamps who/when).
