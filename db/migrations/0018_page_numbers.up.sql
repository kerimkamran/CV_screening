-- 0018 page numbers for quotations (design spec 6.5: "up to two literal sentences with the page number").
-- A PDF's page breaks are kept as the offsets in the stored text where each page starts, so an evidence
-- span can be shown as "p.2". NULL for Word and text files (they have no fixed pages) and for files
-- read before this change; a quote from those simply carries no page.

ALTER TABLE cv_document ADD COLUMN page_starts jsonb;
