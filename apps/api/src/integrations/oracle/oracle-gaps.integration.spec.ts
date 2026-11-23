import { generateKeyPairSync } from 'node:crypto';
import { describeDb } from '../../testing/pg-harness';
import { bootWithFake, drainAll, type OracleStack } from '../../testing/oracle-harness';
import {
  FAKE_FOREIGN,
  FAKE_ORIGIN,
  FAKE_OWN_ORIGIN,
  FAKE_TOKEN_URL,
} from '../../testing/fake-oracle';
import { OracleConnectionService } from './oracle-connection.service';
import type { OracleTarget } from './oracle-hcm.client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 3 gap fixes (Oracle developer review): the documented FileContents download through the
// attachment's own link, CV category codes, the candidate profile, the JWT assertion, own domains.
describeDb('Oracle gap fixes: download, categories, profile, JWT assertion', () => {
  let s: OracleStack;
  let rec: { userId: string; api: any };
  let target: () => Promise<OracleTarget>;
  beforeAll(async () => {
    s = await bootWithFake('oraclegaps');
    rec = await s.h.recruiter('gaps.rec@azerconnect.test');
    const conns = s.h.app.get(OracleConnectionService);
    target = async () => conns.target((await conns.row())!);
  }, 120_000);
  afterAll(async () => s?.h.close());
  const q = (sql: string, p: unknown[] = []) => s.h.db.owner.query(sql, p);
  const settings = (b: Record<string, unknown>) =>
    s.h.admin.put('/admin/integrations/oracle/settings', b);
  let n = 0;
  const fresh = async (apps: number, files?: any[]) => {
    const ref = `G${++n}${Date.now() % 10000}`;
    s.fake.addRequisition({ number: ref, applications: apps, files });
    const vid = await s.h.scenario(rec.api, [], `Gaps ${ref}`);
    return { ref, vid };
  };
  const firstFile = async (ref: string) => {
    const t = await target();
    const req = await s.client.findRequisition(t, ref);
    const app = (await s.client.listApplications(t, req!.id, null)).items[0]!;
    const att = (await s.client.attachments(t, String(app['JobApplicationId'])))[0]!;
    return { t, app: String(app['JobApplicationId']), att: String(att['AttachedDocumentId']) };
  };
  const importAll = async (ref: string, vid: string, estimate: number) => {
    const st = await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate });
    expect(st.statusCode).toBe(202);
    await drainAll(s.h);
    return (await rec.api.get(`/vacancies/${vid}/oracle`)).json().lastRun;
  };

  it('downloads through the documented FileContents enclosure, addressed by the self link (gap 1)', async () => {
    const { ref } = await fresh(1, [{ kind: 'pdf' }]);
    const f0 = await firstFile(ref);
    s.fake.calls.length = 0;
    const f = await s.client.downloadFile(f0.t, f0.app, f0.att);
    expect(f.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const enc = s.fake.calls.filter((c) => c.resource === 'enclosure');
    expect(enc).toHaveLength(1);
    expect(enc[0]).toMatchObject({ status: 200, auth: 'basic' });
    // The attachment list asked for links (no onlyData) and never for a field outside the list.
    const list = s.fake.calls.find((c) => c.resource === 'attachments')!;
    expect(list.queryKeys).not.toContain('onlyData');
    expect(s.fake.calls.filter((c) => c.overCollection)).toHaveLength(0);
  });

  it('the inline and FileUrl routes also start from the self link; the setting picks the route (gap 1)', async () => {
    const { ref } = await fresh(1);
    const f0 = await firstFile(ref);
    s.fake.calls.length = 0;
    const inline = await s.client.downloadFile(f0.t, f0.app, f0.att, undefined, 'inline');
    expect(inline.bytes.toString()).toMatch(/^Name: Applicant/);
    expect(s.fake.calls.map((c) => c.resource)).toEqual(['attachments', 'attachment']);
    s.fake.calls.length = 0;
    const viaUrl = await s.client.downloadFile(f0.t, f0.app, f0.att, undefined, 'fileUrl');
    expect(viaUrl.bytes.toString()).toMatch(/^Name: Applicant/);
    expect(s.fake.calls.map((c) => c.resource)).toEqual(['attachments', 'attachment', 'file']);
    const g = (await settings({ downloadRoute: 'inline' })).json();
    expect(g.settings.downloadRoute).toBe('inline');
    expect((await settings({ downloadRoute: 'nonsense' })).statusCode).toBe(400);
    await settings({ downloadRoute: 'enclosure' });
  });

  it('a link that names another host is not followed; a refused enclosure is a refused file, not a refused sign-in (gap 1)', async () => {
    const { ref } = await fresh(1);
    const f0 = await firstFile(ref);
    s.fake.set({ linkOrigin: FAKE_FOREIGN });
    s.fake.calls.length = 0;
    const f = await s.client.downloadFile(f0.t, f0.app, f0.att);
    expect(f.bytes.toString()).toMatch(/^Name: Applicant/);
    expect(s.fake.calls.every((c) => `https://${c.host}` === FAKE_ORIGIN)).toBe(true);
    s.fake.set({ linkOrigin: null, enclosureForbidden: true });
    await expect(s.client.downloadFile(f0.t, f0.app, f0.att)).rejects.toMatchObject({
      code: 'link_forbidden',
    });
    expect(
      (await q(`SELECT auth_failed_at FROM integration_connection`)).rows[0].auth_failed_at,
    ).toBeNull();
    s.fake.set({ enclosureForbidden: false });
    // An attachment no longer listed reads as a refused link (the runner skips the file).
    await expect(s.client.downloadFile(f0.t, f0.app, '999')).rejects.toMatchObject({
      code: 'link_forbidden',
    });
  });

  it("Oracle's category code and spelling variants count as a CV; other documents do not (gap 2)", async () => {
    const { ref, vid } = await fresh(4, [
      { category: 'IRC_CANDIDATE_RESUME' },
      { category: 'curriculum_vitae' },
      { category: 'Cover Letter' },
      { category: 'RESUME' },
    ]);
    const run = await importAll(ref, vid, 4);
    expect(run.counts).toMatchObject({ seen: 4, noFile: 1, fetched: 3 });
  });

  it('Find category names: names and counts for one vacancy, and which ones count (gap 2)', async () => {
    const { ref } = await fresh(3, [
      { category: 'IRC_CANDIDATE_RESUME' },
      { category: 'IRC_CANDIDATE_RESUME' },
      { category: 'Certificate' },
    ]);
    const r = (
      await s.h.admin.post('/admin/integrations/oracle/categories', { requisition: ref })
    ).json();
    expect(r).toEqual({
      found: true,
      applicationsChecked: 3,
      categories: [
        { name: 'IRC_CANDIDATE_RESUME', files: 2, counted: true },
        { name: 'Certificate', files: 1, counted: false },
      ],
    });
    expect(
      (
        await s.h.admin.post('/admin/integrations/oracle/categories', { requisition: 'NOPE' })
      ).json(),
    ).toEqual({ found: false, applicationsChecked: 0, categories: [] });
    const recr = await rec.api.post('/admin/integrations/oracle/categories', { requisition: ref });
    expect(recr.statusCode).toBe(403);
    const a = (await q(`SELECT after FROM audit_event WHERE action = 'oracle.categories_checked'`))
      .rows;
    expect(a.at(-1).after).toEqual({ requisition: 'NOPE', applications: 0 });
  });

  it('a CV only on the candidate profile: off by default, read when switched on (gap 5)', async () => {
    const { ref, vid } = await fresh(2, [{ onProfile: true, kind: 'docx' }, undefined]);
    let run = await importAll(ref, vid, 2);
    expect(run.counts).toMatchObject({ seen: 2, noFile: 1, fetched: 1 });
    expect(s.fake.calls.some((c) => c.resource === 'recruitingCandidates')).toBe(false);
    expect((await settings({ profileFallback: true })).json().settings.profileFallback).toBe(true);
    await q(
      `UPDATE import_run SET created_at = created_at - interval '1 hour', finished_at = finished_at - interval '1 hour'`,
    );
    s.fake.calls.length = 0;
    run = await importAll(ref, vid, 2);
    expect(run.counts).toMatchObject({ seen: 2, fetched: 1 });
    expect(run.counts.noFile ?? 0).toBe(0);
    expect(s.fake.calls.filter((c) => c.resource === 'recruitingCandidates')).toHaveLength(1);
    const docs = (
      await q(`SELECT filename FROM cv_document WHERE vacancy_id = $1 ORDER BY uploaded_at`, [vid])
    ).rows;
    expect(docs).toHaveLength(2);
    expect(docs[1].filename).toMatch(/\.docx$/);
    await settings({ profileFallback: false });
  });

  it('signs in with an OAuth JWT user assertion, with a client assertion or a client secret (gap 3)', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    s.fake.set({
      assertionPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    expect((await settings({ privateKey: 'not a key' })).statusCode).toBe(400);
    const saved = (
      await settings({
        authMode: 'oauth_jwt_assertion',
        tokenUrl: FAKE_TOKEN_URL,
        clientId: s.fake.state.switches.clientId,
        keyId: s.fake.state.switches.keyId,
        scope: 'urn:opc:resource:fa:instanceid=test urn:opc:resource:consumer::all',
        privateKey: pem,
      })
    ).json();
    expect(saved.connection).toMatchObject({
      authMode: 'oauth_jwt_assertion',
      privateKeySaved: true,
    });
    expect(saved.settings.keyId).toBe(s.fake.state.switches.keyId);
    expect(JSON.stringify(saved)).not.toContain('PRIVATE KEY');
    const test = async () => {
      await q(`UPDATE integration_connection SET last_test_at = NULL, auth_failed_at = NULL`);
      s.h.app
        .get(OracleConnectionService)
        .forget((await q(`SELECT id FROM integration_connection`)).rows[0].id);
      s.fake.calls.length = 0;
      return (await s.h.admin.post('/admin/integrations/oracle/test', {})).json();
    };
    // No client secret saved: the client signs in with a client assertion.
    expect(await test()).toMatchObject({ code: 'ok' });
    expect(s.fake.calls.map((c) => [c.resource, c.auth])).toEqual([
      ['token', 'none'],
      ['recruitingJobRequisitions', 'bearer'],
    ]);
    // With a client secret: Basic client sign-in, the user assertion unchanged.
    await settings({ clientSecret: s.fake.state.switches.clientSecret });
    expect(await test()).toMatchObject({ code: 'ok' });
    expect(s.fake.calls[0]).toMatchObject({ resource: 'token', auth: 'basic' });
    // A key the identity domain does not trust: refused, the import switches off.
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await settings({ privateKey: other.export({ type: 'pkcs8', format: 'pem' }).toString() });
    expect(await test()).toMatchObject({ code: 'auth_failed', enabled: false });
    // The audit trail says the key was replaced, never what it is.
    const a = (
      await q(
        `SELECT after FROM audit_event WHERE action = 'oracle.setting_changed' AND after ? 'privateKey'`,
      )
    ).rows;
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a.every((r: any) => r.after.privateKey === 'replaced')).toBe(true);
  });
});

describeDb('Oracle on the company own domain (gap 4)', () => {
  it('an own host works only when the operator lists it in ORACLE_OWN_HOSTS', async () => {
    const own = await bootWithFake('oracleown', {
      activate: false,
      env: { ORACLE_OWN_HOSTS: new URL(FAKE_OWN_ORIGIN).hostname },
    });
    try {
      own.fake.seed([{ number: 'OWN-1', applications: 1 }]);
      const r = await own.activate({ address: `${FAKE_OWN_ORIGIN}/hcmRestApi` });
      expect(r).toEqual({ code: 'ok', enabled: true });
      expect(own.fake.calls.every((c) => `https://${c.host}` === FAKE_OWN_ORIGIN)).toBe(true);
      const g = (await own.h.admin.get('/admin/integrations/oracle')).json();
      expect(g.ownHosts).toEqual([new URL(FAKE_OWN_ORIGIN).hostname]);
      expect(g.connection.address).toBe(FAKE_OWN_ORIGIN);
    } finally {
      await own.h.close();
    }
    const plain = await bootWithFake('oracleplain', { activate: false });
    try {
      const r = await plain.activate({ address: FAKE_OWN_ORIGIN });
      expect(r).toMatchObject({ code: 'not_oracle_address', enabled: false });
      expect(plain.fake.calls).toHaveLength(0);
    } finally {
      await plain.h.close();
    }
  }, 240_000);
});
