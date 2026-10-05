-- 0003 least-privilege application role (IAM-03 principle; §13.5 "no UPDATE or DELETE grant").
-- The API connects as cv_app, never as the migration owner. Roles are cluster-level, so the
-- role is created if absent and deliberately NOT dropped on rollback (other databases may use it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cv_app') THEN
    BEGIN
      CREATE ROLE cv_app NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      -- Managed Postgres (e.g. Render) may not allow CREATE ROLE. The app then connects as the
      -- schema owner: the append-only triggers still hold, but the least-privilege grants do not.
      RAISE NOTICE 'cannot create role cv_app: running without least-privilege grants';
    END;
  END IF;
END $$;

-- Grants are applied only if the role exists, so migrations work on hosts that forbid CREATE ROLE.
CREATE FUNCTION app_grant(stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cv_app') THEN
    EXECUTE stmt;
  END IF;
END $$;

SELECT app_grant('GRANT USAGE ON SCHEMA public TO cv_app');

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON organization, vacancy, job_description_version TO cv_app');
-- Criteria are editable until frozen (the trigger enforces the freeze); never deletable by the app
-- once referenced, so no DELETE on requirement_set. Draft requirements may be removed.
SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON requirement_set TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT, UPDATE, DELETE ON requirement TO cv_app');

-- Audit: append and read only. No UPDATE, DELETE or TRUNCATE grant exists, in addition to the triggers.
SELECT app_grant('GRANT SELECT, INSERT ON audit_event TO cv_app');
SELECT app_grant('GRANT USAGE ON SEQUENCE audit_event_seq_seq TO cv_app');
SELECT app_grant('GRANT EXECUTE ON FUNCTION audit_event_verify_chain() TO cv_app');
