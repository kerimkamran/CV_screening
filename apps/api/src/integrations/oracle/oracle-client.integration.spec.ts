import { describeDb } from '../../testing/pg-harness';
import { bootWithFake, type OracleStack } from '../../testing/oracle-harness';
import { FAKE_FOREIGN, FAKE_ORIGIN } from '../../testing/fake-oracle';
import { SourceError } from '../import-source';
import { OracleConnectionService } from './oracle-connection.service';
import { OracleClientError, ORACLE_BASE_PATH, type OracleTarget } from './oracle-hcm.client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 3, S3-INT-07 (transport, calls B-F, budget) and S3-INT-08 (sign-in, circuit), against the fake.
describeDb('Oracle client and sign-in (S3-INT-07, S3-INT-08)', () => {
  let s: OracleStack;
  let target: () => Promise<OracleTarget>;
  beforeAll(async () => {
    s = await bootWithFake('oracleclient');
    const conns = s.h.app.get(OracleConnectionService);
    target = async () => conns.target((await conns.row())!);
  }, 120_000);
  afterAll(async () => s?.h.close());
  beforeEach(() => {
    s.fake.reset();
    s.fake.seed([{ number: 'REQ-1', applications: 3 }]);
    s.fake.calls.length = 0;
    s.client.timeouts = { metaMs: 15_000, firstByteMs: 30_000, idleMs: 20_000, totalMs: 120_000 };
  });
  const apiUrl = (path: string) => new URL(`${FAKE_ORIGIN}${ORACLE_BASE_PATH}/${path}`);

  it('finds a requisition, its estimate, its applications and attachments, and a file (calls B-F)', async () => {
    const t = await target();
    const req = await s.client.findRequisition(t, 'REQ-1');
    expect(req).toMatchObject({ number: 'REQ-1', state: 'Open' });
    expect(await s.client.estimate(t, req!.id)).toBe(3);
    const page = await s.client.listApplications(t, req!.id, null);
    expect(page.items).toHaveLength(3);
    const atts = await s.client.attachments(t, String(page.items[0]!['JobApplicationId']));
    expect(atts).toHaveLength(1);
    const f = await s.client.downloadFile(
      t,
      String(page.items[0]!['JobApplicationId']),
      String(atts[0]!['AttachedDocumentId']),
    );
    expect(f.bytes.toString()).toMatch(/^Name: Applicant/);
    // Every request carries the framework version, no ';' in q, no field outside the list (10), (13), (14).
    expect(s.fake.calls.every((c) => c.version === '4' || c.resource === 'file')).toBe(true);
    expect(s.fake.calls.some((c) => c.semicolon)).toBe(false);
    expect(s.fake.calls.filter((c) => c.overCollection)).toHaveLength(0);
    expect(await s.client.findRequisition(t, 'NOPE')).toBeNull();
  });

  it('never follows a redirect to another host; a same-host redirect is followed (4), (11)', async () => {
    const t = await target();
    s.fake.set({ redirect: 'foreign' });
    await expect(
      s.client.get(t, apiUrl('recruitingJobRequisitions?limit=1'), { kind: 'meta', resource: 'x' }),
    ).rejects.toBeInstanceOf(OracleClientError);
    expect(s.fake.calls.filter((c) => `https://${c.host}` === FAKE_FOREIGN)).toHaveLength(0);
    s.fake.set({ redirect: 'same' });
    const r = await s.client.findRequisition(t, 'REQ-1');
    expect(r?.number).toBe('REQ-1');
    expect(s.fake.calls.every((c) => `https://${c.host}` === FAKE_ORIGIN)).toBe(true);
  });

  it('refuses a host that resolves to a private address with 0 requests sent (3)', async () => {
    const t = await target();
    const look = s.client.lookup;
    s.client.lookup = async () => ['10.0.0.5'];
    try {
      await expect(s.client.findRequisition(t, 'REQ-1')).rejects.toBeTruthy();
      expect(s.fake.calls).toHaveLength(0);
    } finally {
      s.client.lookup = look;
    }
  });

  it('aborts an 11 MB file once 10 MB is passed; a hung call ends at its deadline (5), (6)', async () => {
    s.fake.seed([{ number: 'REQ-BIG', applications: 1, files: [{ kind: 'oversize' }] }]);
    const t = await target();
    const req = await s.client.findRequisition(t, 'REQ-BIG');
    const app = (await s.client.listApplications(t, req!.id, null)).items[0]!;
    const att = (await s.client.attachments(t, String(app['JobApplicationId'])))[0]!;
    await expect(
      s.client.downloadFile(t, String(app['JobApplicationId']), String(att['AttachedDocumentId'])),
    ).rejects.toMatchObject({ code: 'too_large' });
    s.client.timeouts.metaMs = 150;
    s.fake.set({ hang: 'headers' });
    const started = Date.now();
    await expect(s.client.findRequisition(t, 'REQ-BIG')).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(s.fake.calls.some((c) => c.aborted)).toBe(true);
  });

  it('waits for Retry-After; after 2 tries an outage reports unavailable; error texts carry no body (7), (8)', async () => {
    const t = await target();
    s.fake.set({ throttle: { times: 1, retryAfter: 1 } });
    const t0 = Date.now();
    expect((await s.client.findRequisition(t, 'REQ-1'))?.number).toBe('REQ-1');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(950);
    s.fake.set({ unavailable: { times: 5 } });
    const e = await s.client.findRequisition(t, 'REQ-1').catch((x) => x);
    expect(e).toBeInstanceOf(SourceError);
    expect(e.code).toBe('unavailable');
    expect(String(e.message)).not.toMatch(/MARKER/);
    expect(s.fake.calls.filter((c) => c.status === 503)).toHaveLength(2);
  });

  it('keeps 2 calls in flight and 4 started a second at the default pace (9)', async () => {
    const t = await target();
    const pace = s.client.pace;
    s.client.pace = { concurrency: 2, perSecond: 4 };
    try {
      const t0 = Date.now();
      await Promise.all(Array.from({ length: 8 }, () => s.client.findRequisition(t, 'REQ-1')));
      expect(s.fake.maxInFlight).toBeLessThanOrEqual(2);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
      const starts = s.fake.calls.map((c) => c.at).sort((a, b) => a - b);
      for (let i = 4; i < starts.length; i++)
        expect(starts[i]! - starts[i - 4]!).toBeGreaterThanOrEqual(990);
    } finally {
      s.client.pace = pace;
    }
  });

  it('a 401 sends 1 request, opens the circuit, and later calls send 0 (S3-INT-08 (2), (3))', async () => {
    const conns = s.h.app.get(OracleConnectionService);
    s.fake.set({ auth: true });
    conns.forget((await conns.row())!.id);
    const [a, b] = await Promise.allSettled([
      conns.call((t) => s.client.findRequisition(t, 'REQ-1')),
      conns.call((t) => s.client.findRequisition(t, 'REQ-1')),
    ]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    expect(s.fake.calls.filter((c) => c.status === 401)).toHaveLength(1);
    expect((await conns.row())!.auth_failed_at).not.toBeNull();
    await conns.call((t) => s.client.findRequisition(t, 'REQ-1')).catch(() => undefined);
    expect(s.fake.calls).toHaveLength(1);
    // Activate again with the right password clears it (4).
    s.fake.set({ auth: false });
    await s.h.db.owner.query(`UPDATE integration_connection SET enabled = false`);
    const r = await s.activate();
    expect(r.code).toBe('ok');
    expect((await conns.row())!.auth_failed_at).toBeNull();
  });

  it('the daily budget: the 6th call is not sent; tomorrow it goes on (12)', async () => {
    const t = await target();
    const budget = s.client.budgetPerDay;
    s.client.budgetPerDay = 5;
    await s.h.db.owner.query(`UPDATE integration_connection SET calls_used = 0, budget_day = NULL`);
    try {
      for (let i = 0; i < 5; i++) await s.client.findRequisition(t, 'REQ-1');
      await expect(s.client.findRequisition(t, 'REQ-1')).rejects.toMatchObject({ code: 'budget' });
      expect(s.fake.calls).toHaveLength(5);
      await s.h.db.owner.query(`UPDATE integration_connection SET budget_day = budget_day - 1`);
      expect((await s.client.findRequisition(t, 'REQ-1'))?.number).toBe('REQ-1');
    } finally {
      s.client.budgetPerDay = budget;
      await s.h.db.owner.query(
        `UPDATE integration_connection SET calls_used = 0, budget_day = NULL`,
      );
    }
  });

  it('a renamed field is schema_changed (14)', async () => {
    const t = await target();
    s.fake.set({ schemaChanged: true });
    await expect(s.client.findRequisition(t, 'REQ-1')).rejects.toMatchObject({
      code: 'schema_changed',
    });
  });
});
