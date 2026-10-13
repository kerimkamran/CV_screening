-- 0034 The "Sky" page background is replaced by "Cream-white" (October 2026 design change).
-- People who had picked Sky move to White-grey, the nearest light background.

ALTER TABLE user_preference DROP CONSTRAINT IF EXISTS user_preference_background_check;
UPDATE user_preference SET background = 'grey' WHERE background = 'sky';
ALTER TABLE user_preference
  ADD CONSTRAINT user_preference_background_check
  CHECK (background IN ('white', 'grey', 'cream', 'dark'));
