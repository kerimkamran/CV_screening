-- 0043 down: the key goes; a connection set to the JWT assertion can no longer sign in until a
-- key is saved again (the auth mode itself was allowed since 0042).
SET lock_timeout = '10s';

ALTER TABLE integration_connection DROP COLUMN IF EXISTS assertion_key_ciphertext;
