SELECT app_grant('REVOKE ALL ON audit_event, requirement, requirement_set, job_description_version, vacancy, organization FROM cv_app');
SELECT app_grant('REVOKE USAGE ON SEQUENCE audit_event_seq_seq FROM cv_app');
SELECT app_grant('REVOKE EXECUTE ON FUNCTION audit_event_verify_chain() FROM cv_app');
SELECT app_grant('REVOKE USAGE ON SCHEMA public FROM cv_app');
DROP FUNCTION IF EXISTS app_grant(TEXT);
