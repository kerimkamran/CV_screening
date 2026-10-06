-- 0016 files that were not taken in (design spec 6.1.4): "3 skipped, see which".
-- A resume that is skipped is never dropped silently. The list is kept with the vacancy, so it is
-- still there after a refresh or on another device.

CREATE TABLE intake_skip (
  id          ulid PRIMARY KEY,
  vacancy_id  ulid NOT NULL REFERENCES vacancy(id),
  filename    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  skipped_by  ulid NOT NULL REFERENCES app_user(id),
  skipped_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX intake_skip_vacancy_idx ON intake_skip (vacancy_id, skipped_at);

CREATE TRIGGER intake_skip_no_update BEFORE UPDATE OR DELETE ON intake_skip
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER intake_skip_no_truncate BEFORE TRUNCATE ON intake_skip
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

SELECT app_grant('GRANT SELECT, INSERT ON intake_skip TO cv_app');
