-- 0035 "Match my device" becomes an explicit choice ('auto'). Nothing chosen now means the
-- light default (White-grey) for everyone, so a recruiter on a dark-mode computer sees the same
-- design as everyone else unless they pick Dark or Match my device.

ALTER TABLE user_preference DROP CONSTRAINT IF EXISTS user_preference_background_check;
ALTER TABLE user_preference
  ADD CONSTRAINT user_preference_background_check
  CHECK (background IN ('white', 'grey', 'cream', 'dark', 'auto'));
