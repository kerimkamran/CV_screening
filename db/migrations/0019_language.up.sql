-- 0019 interface language (design spec 13): English or Azerbaijani, saved per person so it follows
-- them across devices. NULL means "follow the browser's language".
ALTER TABLE user_preference ADD COLUMN language TEXT CHECK (language IN ('en', 'az'));
