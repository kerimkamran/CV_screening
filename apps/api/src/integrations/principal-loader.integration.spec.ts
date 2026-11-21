import { describeDb } from '../testing/pg-harness';
import type { Harness } from '../testing/app-harness';
import { bootOracle } from '../testing/oracle-harness';
import { ActorRevokedError, PrincipalLoader } from './principal-loader';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 3, S3-INT-03 (10) and (11).
describeDb('principal loader and the Oracle switch (S3-INT-03)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootOracle('principal');
  }, 120_000);
  afterAll(async () => h?.close());
  const q = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);

  it('rebuilds the same principal as /me for an active recruiter, writing nothing', async () => {
    const r = await h.recruiter('pl.active@azerconnect.test');
    const me = (await r.api.get('/me')).json();
    const before = (await q(`SELECT last_seen_at FROM app_user WHERE id = $1`, [r.userId])).rows[0]
      .last_seen_at;
    const p = await h.app.get(PrincipalLoader).byUserId(r.userId);
    expect(p.userId).toBe(me.userId);
    expect(p.roles).toEqual(me.roles);
    expect(p.actorType).toBe('human');
    const after = (await q(`SELECT last_seen_at FROM app_user WHERE id = $1`, [r.userId])).rows[0]
      .last_seen_at;
    expect(after).toEqual(before);
  });

  it('refuses a disabled user, a user with no recruiting role, a pending password change, and a service account', async () => {
    const loader = h.app.get(PrincipalLoader);
    const a = await h.recruiter('pl.disabled@azerconnect.test');
    await q(`UPDATE app_user SET status = 'disabled' WHERE id = $1`, [a.userId]);
    await expect(loader.byUserId(a.userId)).rejects.toBeInstanceOf(ActorRevokedError);

    const b = await h.recruiter('pl.gov@azerconnect.test', 'GOVERNANCE');
    await expect(loader.byUserId(b.userId)).rejects.toThrow(/no recruiting role/);

    const c = await h.recruiter('pl.must@azerconnect.test');
    await q(`UPDATE local_credential SET must_change = true WHERE user_id = $1`, [c.userId]);
    await expect(loader.byUserId(c.userId)).rejects.toThrow(/password change/);

    const d = await h.recruiter('pl.svc@azerconnect.test');
    await q(`UPDATE app_user SET actor_kind = 'service' WHERE id = $1`, [d.userId]);
    await expect(loader.byUserId(d.userId)).rejects.toThrow(/not a person/);
  });

  it('every Oracle route answers 404 ORACLE_NOT_AVAILABLE with the switch off, and writes nothing (11)', async () => {
    const off = await (await import('../testing/app-harness')).boot('oracleoff');
    try {
      const audits = async () =>
        Number((await off.db.owner.query(`SELECT count(*) AS n FROM audit_event`)).rows[0].n);
      const before = await audits();
      const list = await off.admin.get('/admin/integrations/oracle/runs');
      expect(list.statusCode).toBe(404);
      expect(list.json()).toMatchObject({ code: 'ORACLE_NOT_AVAILABLE' });
      const ab = await off.admin.post('/admin/import-runs/01JZZZZZZZZZZZZZZZZZZZZZZ9/abandon');
      expect(ab.statusCode).toBe(404);
      expect(await audits()).toBe(before);
    } finally {
      await off.close();
    }
    // Switch on: the route answers; a recruiter is refused by the role guard first.
    expect((await h.admin.get('/admin/integrations/oracle/runs')).statusCode).toBe(200);
    const r = await h.recruiter('pl.rec@azerconnect.test');
    expect((await r.api.get('/admin/integrations/oracle/runs')).statusCode).toBe(403);
  }, 120_000);
});
