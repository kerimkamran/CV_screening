DELETE FROM user_preference WHERE background IS NULL;
ALTER TABLE user_preference DROP COLUMN focus_on_skills;
ALTER TABLE user_preference ALTER COLUMN background SET NOT NULL;
