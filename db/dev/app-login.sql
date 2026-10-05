-- Local/dev only. Creates the login role the API connects as: a member of cv_app (migration 0003),
-- so it inherits exactly the grants there and nothing else — no DDL, no UPDATE/DELETE on audit_event.
-- Staging/prod create the equivalent via IaC with a vault-held credential.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cv_api') THEN
    CREATE ROLE cv_api LOGIN PASSWORD 'cv_api' IN ROLE cv_app;
  END IF;
END $$;
