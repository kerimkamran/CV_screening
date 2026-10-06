-- 0014 "Focus on skills" (design spec 6.2.6): one switch, the recruiter's own choice, remembered
-- per recruiter rather than per browser. The background choice becomes optional so a person can
-- set one without the other (a missing background still means "follow the device").

ALTER TABLE user_preference ALTER COLUMN background DROP NOT NULL;
ALTER TABLE user_preference ADD COLUMN focus_on_skills BOOLEAN NOT NULL DEFAULT false;
