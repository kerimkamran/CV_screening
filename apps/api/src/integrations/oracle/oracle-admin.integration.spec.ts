import { describeDb } from '../../testing/pg-harness';
import { bootWithFake, type OracleStack } from '../../testing/oracle-harness';
import { FAKE_ORIGIN } from '../../testing/fake-oracle';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 3, S3-INT-09: Activate, Test again, Replace password, Turn off, the Advanced settings.
describeDb('Oracle admin card (S3-INT-09)', () => {
  let s: OracleStack;
  beforeAll(async () => {
    s = await bootWithFake('oracleadmin', { activate: false, keepEuDefault: true });
    s.fake.seed([{ number: 'REQ-A', applications: 2 }]);
  }, 120_000);
  afterAll(async () => s?.h.close());
  const q = (sql: string, p: unknown[] = []) => s.h.db.owner.query(sql, p);
  const audits = async (action: string) =>
    (
      await q(`SELECT before, after FROM audit_event WHERE action = $1 ORDER BY occurred_at`, [
        action,
      ])
    ).rows;

  it('before anything is saved: defaults, the example address and the ending; no connection (13)', async () => {
    const g = (await s.h.admin.get('/admin/integrations/oracle')).json();
    expect(g.connection).toBeNull();
    expect(g.settings).toMatchObject({
      linkPolicy: 'open',
      requireEuAi: true,
      goneInSource: 'flag',
    });
    expect(g.example).toBe('https://xxxx.fa.em2.oraclecloud.com');
    expect(g.suffix).toBe('.oraclecloud.com');
  });

  it('needs three values and the tick; nothing saved and 0 requests without them (4); a non-admin gets 403 (2)', async () => {
    const r = await s.h.admin.post('/admin/integrations/oracle/activate', {
      address: FAKE_ORIGIN,
      user: 'u',
      password: 'p',
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().missing).toEqual(['notice']);
    expect(s.fake.calls).toHaveLength(0);
    expect((await q(`SELECT count(*)::int AS n FROM integration_connection`)).rows[0].n).toBe(0);
    const rec = await s.h.recruiter('adm.rec@azerconnect.test');
    expect((await rec.api.get('/admin/integrations/oracle')).statusCode).toBe(403);
  });

  it('not an Oracle address: nothing saved, the sentence comes from the server (result 5)', async () => {
    const r = (await s.activate({ address: 'https://evil.example.com' })).valueOf();
    expect(r).toMatchObject({ code: 'not_oracle_address', enabled: false });
    expect(r.message).toBe(
      'This is not an Oracle address. It must start with https:// and end in .oraclecloud.com.',
    );
    expect((await q(`SELECT count(*)::int AS n FROM integration_connection`)).rows[0].n).toBe(0);
  });

  it('a wrong password: saved, not switched on, the circuit is open (result 2); empty scope (result 3)', async () => {
    let r = await s.activate({ password: 'wrong-password' });
    expect(r).toEqual({ code: 'auth_failed', enabled: false });
    const row = (
      await q(`SELECT enabled, auth_failed_at, secret_ciphertext FROM integration_connection`)
    ).rows[0];
    expect(row.enabled).toBe(false);
    expect(row.auth_failed_at).not.toBeNull();
    s.fake.set({ emptyScope: true });
    r = await s.activate();
    expect(r).toEqual({ code: 'empty_scope', enabled: false });
    s.fake.set({ emptyScope: false, unavailable: { times: 1 } });
    r = await s.activate();
    expect(r).toEqual({ code: 'unreachable', enabled: false });
  });

  it('Activate: ok, switched on; the password appears in no answer, log or audit row (result 1, (5), (6), (11))', async () => {
    s.fake.set({ unavailable: null });
    const r = await s.activate({ passwordExpiresOn: '2027-03-01', noticeEffectiveFrom: null });
    expect(r).toEqual({ code: 'ok', enabled: true });
    const g = (await s.h.admin.get('/admin/integrations/oracle')).json();
    expect(g.connection).toMatchObject({
      address: FAKE_ORIGIN,
      enabled: true,
      lastTestCode: 'ok',
      passwordSaved: true,
      passwordExpiresOn: '2027-03-01',
    });
    expect(g.connection.notice.by).toBeTruthy();
    const pw = s.fake.state.switches.password;
    expect(JSON.stringify(g)).not.toContain(pw);
    const all = (
      await q(`SELECT coalesce(before::text,'') || coalesce(after::text,'') AS t FROM audit_event`)
    ).rows;
    expect(all.some((x: any) => x.t.includes(pw))).toBe(false);
    expect(all.some((x: any) => x.t.includes('wrong-password'))).toBe(false);
    const act = (await audits('oracle.activate')).at(-1).after;
    expect(act).toEqual({ code: 'ok', host: new URL(FAKE_ORIGIN).hostname });
  });

  it('Test again twice within 5 minutes: the second answers 429 and sends nothing (7)', async () => {
    await q(`UPDATE integration_connection SET last_test_at = now() - interval '10 minutes'`);
    const a = await s.h.admin.post('/admin/integrations/oracle/test');
    expect(a.json()).toEqual({ code: 'ok', enabled: true });
    const n = s.fake.calls.length;
    const b = await s.h.admin.post('/admin/integrations/oracle/test');
    expect(b.statusCode).toBe(429);
    expect(b.json().secondsLeft).toBeGreaterThan(0);
    expect(s.fake.calls.length).toBe(n);
  });

  it('Test again is refused while the sign-in circuit is open, with 0 requests (A10)', async () => {
    await q(
      `UPDATE integration_connection SET auth_failed_at = now(), last_test_at = now() - interval '10 minutes'`,
    );
    const n = s.fake.calls.length;
    const r = await s.h.admin.post('/admin/integrations/oracle/test');
    expect([r.statusCode, r.json().code]).toEqual([409, 'ORACLE_AUTH']);
    expect(s.fake.calls.length).toBe(n);
    await q(`UPDATE integration_connection SET auth_failed_at = NULL`);
  });

  it('Replace password: a wrong new one leaves everything as it was; a right one replaces it (8), (4)', async () => {
    const before = (await q(`SELECT secret_ciphertext, enabled FROM integration_connection`))
      .rows[0];
    const bad = await s.activate({ password: 'another-wrong' });
    expect(bad).toEqual({ code: 'auth_failed', enabled: true });
    const after = (
      await q(`SELECT secret_ciphertext, enabled, auth_failed_at FROM integration_connection`)
    ).rows[0];
    expect(after.secret_ciphertext).toBe(before.secret_ciphertext);
    expect(after.enabled).toBe(true);
    expect(after.auth_failed_at).toBeNull();
    s.fake.set({ password: 'the-new-password' });
    const ok = await s.activate({ password: 'the-new-password' });
    expect(ok).toEqual({ code: 'ok', enabled: true });
    const now = (await q(`SELECT secret_ciphertext FROM integration_connection`)).rows[0];
    expect(now.secret_ciphertext).not.toBe(before.secret_ciphertext);
  });

  it('a ciphertext copied to another row does not decrypt (12)', async () => {
    const crypto = s.h.app.get((await import('../../ai/settings-crypto')).SettingsCrypto);
    const row = (await q(`SELECT id, secret_ciphertext FROM integration_connection`)).rows[0];
    expect(crypto.decrypt(row.secret_ciphertext, `oracle:${row.id}:password`)).toBe(
      'the-new-password',
    );
    expect(() =>
      crypto.decrypt(row.secret_ciphertext, `oracle:01JZZZZZZZZZZZZZZZZZZZZZZZ:password`),
    ).toThrow();
  });

  it('Advanced settings: one audit row per changed value, none for an unchanged one, a secret only as replaced (15)', async () => {
    const r = await s.h.admin.put('/admin/integrations/oracle/settings', {
      requireEuAi: false,
      linkPolicy: 'open',
      categories: ['Resume', 'CV'],
      clientSecret: 'oauth-secret-value',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().settings).toMatchObject({
      requireEuAi: false,
      linkPolicy: 'open',
      categories: ['Resume', 'CV'],
    });
    const rows = await audits('oracle.setting_changed');
    const fields = rows.map((x: any) => Object.keys(x.after)[0]).sort();
    expect(fields).toEqual(['categories', 'clientSecret', 'requireEuAi']);
    expect(rows.find((x: any) => x.after.clientSecret).after.clientSecret).toBe('replaced');
    expect(JSON.stringify(rows)).not.toContain('oauth-secret-value');
    const row = (await q(`SELECT enabled FROM integration_connection`)).rows[0];
    expect(row.enabled).toBe(true);
  });

  it('Turn off: switched off, active runs cancelled switched_off; recruiters then get ORACLE_NOT_ACTIVE (9)', async () => {
    const rec = await s.h.recruiter('adm.off@azerconnect.test');
    const vid = await s.h.scenario(rec.api, [], 'Turn off');
    await q(
      `INSERT INTO import_run (id, vacancy_id, mode, state, started_by) VALUES ('01JZZZZZZZZZZZZZZZZZZZZZZA', $1, 'import', 'queued', $2)`,
      [vid, rec.userId],
    );
    const r = (await s.h.admin.post('/admin/integrations/oracle/deactivate')).json();
    expect(r).toEqual({ enabled: false, cancelled: 1 });
    const run = (
      await q(`SELECT state, error_code FROM import_run WHERE id = '01JZZZZZZZZZZZZZZZZZZZZZZA'`)
    ).rows[0];
    expect(run).toEqual({ state: 'cancelled', error_code: 'switched_off' });
    const l = await rec.api.post(`/vacancies/${vid}/oracle/lookup`, { ref: 'REQ-A' });
    expect(l.json().code).toBe('ORACLE_NOT_ACTIVE');
  });
});
