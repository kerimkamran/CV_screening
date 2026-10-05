import { createHash } from 'node:crypto';

/** Shortest secret accepted (characters). Render's "generated secret" is 32 hex characters. */
export const MIN_SECRET_LENGTH = 32;

/**
 * The AES-256 master key from SETTINGS_ENCRYPTION_KEY.
 * - A base64 value that decodes to exactly 32 bytes (e.g. `openssl rand -base64 32`, or Render's
 *   `generateValue`) is used as it is.
 * - Any other secret of at least 32 characters (e.g. `openssl rand -hex 32`, or a value produced
 *   by a host's secret generator) is hashed with SHA-256 to 32 bytes.
 * The same input always gives the same key, so stored provider keys stay readable.
 */
export function deriveMasterKey(raw: string): Buffer {
  const value = raw.trim();
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`SETTINGS_ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const b64 = Buffer.from(value, 'base64');
  if (b64.length === 32) return b64;
  return createHash('sha256').update(value, 'utf8').digest();
}
