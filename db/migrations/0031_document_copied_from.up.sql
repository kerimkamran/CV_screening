-- 0031 A resume analyzed again for another vacancy (SenAI plan 5.2 M3, "Analyze for this vacancy").
-- The copy points at the resume it came from, so erasing the original erases every copy too.
ALTER TABLE cv_document ADD COLUMN copied_from ulid REFERENCES cv_document(id);
CREATE INDEX cv_document_copied_from_idx ON cv_document (copied_from) WHERE copied_from IS NOT NULL;
