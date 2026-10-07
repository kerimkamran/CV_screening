import {
  codeAt,
  newRecoveryCodes,
  newSecret,
  otpauthUri,
  unbase32,
  verifyTotp,
  base32,
} from './totp';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1, secret "12345678901234567890", 8 digits -> last 6 digits here.
  const secret = base32(Buffer.from('12345678901234567890'));
  it('matches the RFC test vectors', () => {
    expect(codeAt(secret, Math.floor(59 / 30))).toBe('287082');
    expect(codeAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(codeAt(secret, Math.floor(1234567890 / 30))).toBe('005924');
  });
  it('round-trips base32', () => {
    const s = newSecret();
    expect(base32(unbase32(s))).toBe(s);
    expect(s).toHaveLength(32);
  });
  it('accepts one step of drift, rejects others, and never accepts a step twice', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(secret, codeAt(secret, step), null, now)).toBe(step);
    expect(verifyTotp(secret, codeAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, codeAt(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, codeAt(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, '12345', null, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });
  it('builds an otpauth link and recovery codes', () => {
    expect(otpauthUri('ABC', 'a@b.az')).toContain('otpauth://totp/');
    const c = newRecoveryCodes();
    expect(new Set(c).size).toBe(8);
    expect(c[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  });
});
