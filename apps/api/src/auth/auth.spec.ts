import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createAdapter } from '../app.factory';
import { AppModule } from '../app.module';
import { createTestIdp } from '../testing/idp';
import { KEY_RESOLVER, toIdentity } from './token-verifier';
import { USER_DIRECTORY } from './user-directory';

const ISSUER = 'https://idp.test/';
const AUDIENCE = 'api://cv-screening';
const USER_ID = '0000000000000000000000000A';

describe('OIDC bearer authentication (IAM-01, IAM-06)', () => {
  let app: NestFastifyApplication;
  let idp: Awaited<ReturnType<typeof createTestIdp>>;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: 'postgres://cv:cv@127.0.0.1:1/x',
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
      OIDC_JWKS_URI: 'https://idp.test/jwks',
      MAX_TOKEN_LIFETIME_SECONDS: '3600',
      LOG_LEVEL: 'silent',
    });
    idp = await createTestIdp(ISSUER, AUDIENCE);
    // Token mechanics only: the directory is stubbed (see iam.integration.spec.ts for the DB path).
    const directory = {
      resolve: async (id: { subject: string; issuer: string; actorType: 'human' | 'service' }) => ({
        userId: USER_ID,
        ...id,
        roles: [],
      }),
    };
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KEY_RESOLVER)
      .useValue(idp.resolver)
      .overrideProvider(USER_DIRECTORY)
      .useValue(directory)
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(createAdapter('silent'));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (url: string, token?: string) =>
    app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('leaves only the health probes unauthenticated', async () => {
    expect((await get('/healthz')).statusCode).toBe(200);
    expect((await get('/me')).statusCode).toBe(401);
    expect((await get('/vacancies')).statusCode).toBe(401);
    expect((await get('/admin/users')).statusCode).toBe(401);
  });

  it('accepts a valid token and exposes the principal', async () => {
    const res = await get('/me', await idp.sign('user-123'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      subject: 'user-123',
      issuer: ISSUER,
      actorType: 'human',
      roles: [],
    });
  });

  it('ignores role claims in the token — roles come only from database grants', async () => {
    const res = await get('/me', await idp.sign('user-123', { claims: { roles: ['ADMIN'] } }));
    expect(res.json().roles).toEqual([]);
  });

  it.each([
    ['wrong audience', () => idp.sign('u', { aud: 'api://other' })],
    ['wrong issuer', () => idp.sign('u', { iss: 'https://evil.test/' })],
    ['expired', () => idp.sign('u', { exp: Math.floor(Date.now() / 1000) - 3600 })],
    ['signed by an unknown key', () => idp.sign('u', { signWithUnknownKey: true })],
    ['a lifetime beyond policy (IAM-06)', () => idp.sign('u', { lifetime: 7200 })],
  ])('rejects a token with %s', async (_n, make) => {
    expect((await get('/me', await make())).statusCode).toBe(401);
  });

  it('accepts a token exactly at the lifetime policy', async () => {
    expect((await get('/me', await idp.sign('u', { lifetime: 3600 }))).statusCode).toBe(200);
  });

  it('rejects alg=none and garbage without leaking why', async () => {
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
      `{"sub":"x","iss":"${ISSUER}","aud":"${AUDIENCE}","exp":9999999999}`,
    ).toString('base64url')}.`;
    for (const t of [none, 'not.a.jwt', '']) {
      const res = await get('/me', t);
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toMatch(/expired|signature|audience|issuer|lifetime/i);
    }
  });

  it('rejects a non-Bearer scheme', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Basic abc' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('toIdentity', () => {
  it('treats app-only tokens (idtyp=app) as service principals (IAM-02)', () => {
    expect(toIdentity({ sub: 'w', idtyp: 'app' }, ISSUER).actorType).toBe('service');
    expect(toIdentity({ sub: 'u' }, ISSUER).actorType).toBe('human');
  });
});
