-- 0011 per-user display preferences. The background choice follows the person across devices
-- (design spec 4.2). A missing row means "follow the device".

CREATE TABLE user_preference (
  user_id    ulid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  background TEXT NOT NULL CHECK (background IN ('white', 'grey', 'sky', 'dark')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

SELECT app_grant('GRANT SELECT, INSERT, UPDATE, DELETE ON user_preference TO cv_app');
