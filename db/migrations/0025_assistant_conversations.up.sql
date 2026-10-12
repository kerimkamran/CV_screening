-- 0025 SenAI conversations over the pool (Development Plan WP 4.7): a person's own list of
-- conversations, each with its turns. Private to the person; deleting is soft so a compliance
-- review still sees what was asked until retention removes it. A turn stores only what the screen
-- showed (counts, pseudonyms, requirement wording), never a resume.
CREATE TABLE assistant_conversation (
  id         ulid PRIMARY KEY,
  user_id    ulid NOT NULL REFERENCES app_user(id),
  title      TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  vacancy_id ulid REFERENCES vacancy(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX assistant_conversation_user_idx ON assistant_conversation (user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE assistant_pool_message (
  id              ulid PRIMARY KEY,
  conversation_id ulid NOT NULL REFERENCES assistant_conversation(id),
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         JSONB NOT NULL,
  flags           TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_pool_message_idx ON assistant_pool_message (conversation_id, created_at, id);

SELECT app_grant('GRANT SELECT, INSERT, UPDATE ON assistant_conversation TO cv_app');
SELECT app_grant('GRANT SELECT, INSERT ON assistant_pool_message TO cv_app');
