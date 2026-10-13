-- 0032 Consent record and reviewing a link the candidate gave (SenAI plan 5.4 S3, 11.1, 13.2 D1 and D2).
-- Off unless the administrator turns on "link review". A link is read only while a consent is recorded
-- for that resume, and only on the recruiter's click. The text kept is redacted, and goes with the resume.
CREATE TABLE candidate_consent (
  id           ulid PRIMARY KEY,
  document_id  ulid NOT NULL REFERENCES cv_document(id),
  scope        TEXT NOT NULL CHECK (scope IN ('link_review')),
  source       TEXT NOT NULL CHECK (source IN ('application_form', 'hr_system', 'email', 'other')),
  evidence_ref TEXT NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 3 AND 200),
  recorded_by  ulid NOT NULL REFERENCES app_user(id),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  withdrawn_by ulid REFERENCES app_user(id)
);
CREATE UNIQUE INDEX candidate_consent_live_uq ON candidate_consent (document_id, scope)
  WHERE withdrawn_at IS NULL;
SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON candidate_consent TO cv_app');

CREATE TABLE candidate_link_review (
  id           ulid PRIMARY KEY,
  document_id  ulid NOT NULL REFERENCES cv_document(id),
  consent_id   ulid NOT NULL REFERENCES candidate_consent(id),
  url          TEXT NOT NULL CHECK (length(url) <= 2000),
  host         TEXT NOT NULL,
  text         TEXT NOT NULL,
  words        INT NOT NULL,
  flagged      BOOLEAN NOT NULL DEFAULT false,
  requested_by ulid NOT NULL REFERENCES app_user(id),
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX candidate_link_review_doc_idx ON candidate_link_review (document_id, fetched_at DESC);
SELECT app_grant('GRANT SELECT, INSERT, DELETE ON candidate_link_review TO cv_app');
