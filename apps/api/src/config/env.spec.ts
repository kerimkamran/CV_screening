import { loadEnv } from './env';

const OIDC = {
  OIDC_ISSUER: 'https://idp.test/',
  OIDC_AUDIENCE: 'api://x',
  OIDC_JWKS_URI: 'https://idp.test/jwks',
};

describe('loadEnv (PLAT-05)', () => {
  it('applies defaults and coerces numbers', () => {
    const env = loadEnv({ ...OIDC, DATABASE_URL: 'postgres://u:p@h:5432/d', PORT: '8080' });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe('development');
    expect(env.READINESS_TIMEOUT_MS).toBe(2000);
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('never echoes configuration values in the error', () => {
    const secret = 'super-secret-value';
    try {
      loadEnv({ DATABASE_URL: secret });
      fail('expected loadEnv to throw');
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it('refuses to start without OIDC settings (no open-by-default API)', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgres://h/d' })).toThrow(/OIDC_ISSUER/);
  });

  it('rejects out-of-range ports', () => {
    expect(() => loadEnv({ ...OIDC, DATABASE_URL: 'postgres://h/d', PORT: '70000' })).toThrow(
      /PORT/,
    );
  });

  it('defines no model-provider credentials (AISEC-01)', () => {
    const env = loadEnv({ ...OIDC, DATABASE_URL: 'postgres://h/d' });
    expect(Object.keys(env).join(' ')).not.toMatch(/api_?key|gemini|openai|anthropic/i);
  });
});
