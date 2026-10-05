ALTER TABLE requirement_set         DROP CONSTRAINT IF EXISTS req_set_created_by_fk;
ALTER TABLE job_description_version DROP CONSTRAINT IF EXISTS jd_version_created_by_fk;
ALTER TABLE vacancy                 DROP CONSTRAINT IF EXISTS vacancy_created_by_fk;
DROP TABLE IF EXISTS vacancy_access;
DROP TABLE IF EXISTS role_assignment;
DROP TABLE IF EXISTS app_user;
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS app_role;
