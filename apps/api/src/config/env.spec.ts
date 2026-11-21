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

  it('accepts any settings encryption secret of 32+ characters, and refuses a short one', () => {
    const base = { ...OIDC, DATABASE_URL: 'postgres://u:p@h:5432/d' };
    for (const key of [
      'eeb76cdc4734dc743eff1117ad3526dd',
      Buffer.alloc(32, 7).toString('base64'),
    ]) {
      expect(loadEnv({ ...base, SETTINGS_ENCRYPTION_KEY: key }).SETTINGS_ENCRYPTION_KEY).toBe(key);
    }
    expect(() => loadEnv({ ...base, SETTINGS_ENCRYPTION_KEY: 'short' })).toThrow(
      /SETTINGS_ENCRYPTION_KEY/,
    );
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

  // Stage 3, S3-INT-02 (3): the three Oracle import settings.
  it('keeps the Oracle import off by default, with a 1 GB database budget', () => {
    const env = loadEnv({ ...OIDC, DATABASE_URL: 'postgres://h/d' });
    expect(env.ORACLE_IMPORT_ENABLED).toBe('false');
    expect(env.DB_SIZE_LIMIT_MB).toBe(1024);
    expect(env.IMPORT_TOMBSTONE_KEY).toBeUndefined();
  });

  it('needs a tombstone key of 32+ characters when the import is switched on, and names only the variable', () => {
    const base = { ...OIDC, DATABASE_URL: 'postgres://h/d', ORACLE_IMPORT_ENABLED: 'true' };
    expect(() => loadEnv(base)).toThrow(/IMPORT_TOMBSTONE_KEY/);
    const short = 'short-secret-value';
    try {
      loadEnv({ ...base, IMPORT_TOMBSTONE_KEY: short });
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as Error).message).toMatch(/IMPORT_TOMBSTONE_KEY/);
      expect((e as Error).message).not.toContain(short);
    }
    expect(() => loadEnv({ ...base, IMPORT_TOMBSTONE_KEY: `2:${'n'.repeat(32)},1:short` })).toThrow(
      /IMPORT_TOMBSTONE_KEY/,
    );
    const ok = loadEnv({
      ...base,
      IMPORT_TOMBSTONE_KEY: `2:${'n'.repeat(32)},1:${'o'.repeat(32)}`,
    });
    expect(ok.ORACLE_IMPORT_ENABLED).toBe('true');
  });
});
