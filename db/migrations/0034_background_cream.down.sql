ALTER TABLE user_preference DROP CONSTRAINT IF EXISTS user_preference_background_check;
UPDATE user_preference SET background = 'grey' WHERE background = 'cream';
ALTER TABLE user_preference
  ADD CONSTRAINT user_preference_background_check
  CHECK (background IN ('white', 'grey', 'sky', 'dark'));
