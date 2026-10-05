import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from './app.factory';
import { CORRELATION_HEADER } from './common/correlation';

describe('createApp (wiring)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgres://cv:cv@127.0.0.1:1/unreachable'; // nothing listens on :1
    process.env.OIDC_ISSUER = 'https://idp.test/';
    process.env.OIDC_AUDIENCE = 'api://cv-screening';
    process.env.OIDC_JWKS_URI = 'https://idp.test/jwks';
    process.env.LOG_LEVEL = 'silent';
    process.env.READINESS_TIMEOUT_MS = '500';
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves liveness and stamps a correlation ID header', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.headers[CORRELATION_HEADER]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('reports not-ready when the real database pool cannot connect', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
  });

  it('denies unauthenticated access to everything except the health probes (IAM exit criteria)', async () => {
    const res = await app.inject({ method: 'GET', url: '/vacancies' });
    expect(res.statusCode).toBe(401); // route exists but is default-deny
  });
});
