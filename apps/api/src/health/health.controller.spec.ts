import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@cv/shared';
import { createAdapter } from '../app.factory';
import { CORRELATION_HEADER } from '../common/correlation';
import { ENV } from '../config/env';
import { DbService } from '../db/db.service';
import { HealthController } from './health.controller';

async function build(dbUp: boolean) {
  const mod = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: ENV, useValue: { READINESS_TIMEOUT_MS: 100 } },
      { provide: DbService, useValue: { ping: jest.fn().mockResolvedValue(dbUp) } },
    ],
  }).compile();
  const app = mod.createNestApplication<NestFastifyApplication>(
    createAdapter('silent') as FastifyAdapter,
  );
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (req, reply) => {
      reply.header(CORRELATION_HEADER, req.id);
    });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('HealthController (PLAT-07)', () => {
  it('liveness is ok without touching the database', async () => {
    const app = await build(false);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('readiness is 200 when the database is up', async () => {
    const app = await build(true);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json().checks.database).toBe('up');
    await app.close();
  });

  it('readiness is 503 when the database is down, so the instance leaves rotation', async () => {
    const app = await build(false);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.database).toBe('down');
    await app.close();
  });

  it('echoes a valid correlation ID and mints one otherwise (PLAT-06)', async () => {
    const app = await build(true);
    const id = newId();
    const echoed = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { [CORRELATION_HEADER]: id },
    });
    expect(echoed.headers[CORRELATION_HEADER]).toBe(id);
    const minted = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { [CORRELATION_HEADER]: 'bad' },
    });
    expect(minted.headers[CORRELATION_HEADER]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    await app.close();
  });
});
