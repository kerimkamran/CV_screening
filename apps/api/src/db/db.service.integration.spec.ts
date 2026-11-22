import { createDb, describeDb } from '../testing/pg-harness';
import type { Env } from '../config/env';
import { DbService } from './db.service';

// A database restart or failover closes idle connections. Without an 'error' listener on the pool,
// pg re-emits that as an unhandled event and Node stops the whole API (seen in CI: 57P01).
describeDb('DbService pool', () => {
  let db: Awaited<ReturnType<typeof createDb>>;
  beforeAll(async () => {
    db = await createDb('dbpool');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('survives the server closing an idle connection and keeps answering', async () => {
    const svc = new DbService({ DATABASE_URL: db.apiUrl, DB_POOL_MAX: 2 } as unknown as Env);
    const errors: unknown[] = [];
    const onUncaught = (e: unknown) => errors.push(e);
    process.on('uncaughtException', onUncaught);
    try {
      const pid = (await svc.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await db.owner.query('SELECT pg_terminate_backend($1)', [pid]);
      await new Promise((r) => setTimeout(r, 300));
      expect((await svc.query<{ one: number }>('SELECT 1 AS one')).rows[0]!.one).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
      await svc.onModuleDestroy();
    }
  });
});
