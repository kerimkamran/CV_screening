-- 0013 requirement changes made on the results screen (design spec 6.2.5).
-- The frozen criteria are never edited: a recruiter can re-weigh a requirement (must-have,
-- nice-to-have, ignore) and the ranking is recalculated from the stored assessments, without
-- re-reading any resume. Every change is kept with who and when; "back to original" is one more
-- row (a reset), so nothing is ever erased and the original ranking is always recoverable.

CREATE TABLE criteria_adjustment (
  id             ulid PRIMARY KEY,
  vacancy_id     ulid NOT NULL REFERENCES vacancy(id),
  requirement_id ulid REFERENCES requirement(id),
  from_kind      TEXT CHECK (from_kind IN ('mandatory', 'preferred', 'ignore')),
  to_kind        TEXT CHECK (to_kind IN ('mandatory', 'preferred', 'ignore')),
  is_reset       BOOLEAN NOT NULL DEFAULT false,
  changed_by     ulid NOT NULL REFERENCES app_user(id),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((is_reset AND requirement_id IS NULL AND to_kind IS NULL)
      OR (NOT is_reset AND requirement_id IS NOT NULL AND to_kind IS NOT NULL))
);
CREATE INDEX criteria_adjustment_vacancy_idx ON criteria_adjustment (vacancy_id, changed_at);

CREATE TRIGGER criteria_adjustment_no_update BEFORE UPDATE OR DELETE ON criteria_adjustment
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER criteria_adjustment_no_truncate BEFORE TRUNCATE ON criteria_adjustment
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

SELECT app_grant('GRANT SELECT, INSERT ON criteria_adjustment TO cv_app');
