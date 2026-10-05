import { randomBytes } from 'node:crypto';
import { deriveMasterKey } from './master-key';

describe('SETTINGS_ENCRYPTION_KEY handling', () => {
  it('uses a 32-byte base64 value as it is', () => {
    const raw = randomBytes(32);
    expect(deriveMasterKey(raw.toString('base64')).equals(raw)).toBe(true);
  });

  it('hashes any other long-enough secret to 32 bytes, deterministically', () => {
    for (const secret of [
      'eeb76cdc4734dc743eff1117ad3526dd', // 32 hex characters, as Render generates
      randomBytes(32).toString('hex'),
      'a long passphrase that is at least thirty-two characters',
    ]) {
      const k = deriveMasterKey(secret);
      expect(k).toHaveLength(32);
      expect(deriveMasterKey(secret).equals(k)).toBe(true);
    }
    expect(deriveMasterKey('x'.repeat(40)).equals(deriveMasterKey('y'.repeat(40)))).toBe(false);
  });

  it('refuses a short secret', () => {
    expect(() => deriveMasterKey('too-short')).toThrow(/at least 32/);
  });
});
