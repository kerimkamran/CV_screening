-- 0043 Oracle sign-in with an OAuth JWT assertion (Stage 3 gap fix). The private key that signs
-- the assertion is AES-GCM ciphertext bound to the row, like the password and the client secret;
-- it is never shown again. The other values (key ID, client ID, scope) live in settings.
SET lock_timeout = '10s';

ALTER TABLE integration_connection ADD COLUMN assertion_key_ciphertext TEXT;
