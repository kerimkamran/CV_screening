import { describeDb } from '../../testing/pg-harness';
import { bootWithFake, drainAll, runner, type OracleStack } from '../../testing/oracle-harness';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 3, S3-INT-10 (link, lookup, start), S3-INT-11/12 through the real client, S3-INT-13 (refresh).
describeDb('Oracle import from the recruiter side (S3-INT-10 to S3-INT-13)', () => {
  let s: OracleStack;
  let rec: { userId: string; api: any; token: string };
  let lead: { userId: string; api: any };
  beforeAll(async () => {
    s = await bootWithFake('oraclelink');
    rec = await s.h.recruiter('link.rec@azerconnect.test');
    lead = await s.h.recruiter('link.lead@azerconnect.test', 'TA_LEAD');
  }, 120_000);
  afterAll(async () => s?.h.close());
  const q = (sql: string, p: unknown[] = []) => s.h.db.owner.query(sql, p);
  let n = 0;
  const fresh = async (apps: number, opts: { estimate?: number; files?: any[] } = {}) => {
    const ref = `R${++n}${Date.now() % 10000}`;
    s.fake.addRequisition({
      number: ref,
      applications: apps,
      estimate: opts.estimate,
      files: opts.files,
    });
    const vid = await s.h.scenario(rec.api, [], `Link ${ref}`);
    return { ref, vid };
  };
  const cooldownOff = () =>
    q(
      `UPDATE import_run SET created_at = created_at - interval '1 hour', finished_at = finished_at - interval '1 hour'`,
    );

  it('lookup: number, title, state, estimate, room; not found; one audit row (10b (1))', async () => {
    const { ref, vid } = await fresh(4);
    const r = (await rec.api.post(`/vacancies/${vid}/oracle/lookup`, { ref })).json();
    expect(r).toMatchObject({ found: true, number: ref, state: 'Open', estimate: 4, room: 500 });
    expect(r.title).toContain(ref);
    expect(
      (await rec.api.post(`/vacancies/${vid}/oracle/lookup`, { ref: 'NO-SUCH' })).json(),
    ).toEqual({ found: false });
    const a = (
      await q(`SELECT after FROM audit_event WHERE action = 'oracle.lookup' AND entity_id = $1`, [
        vid,
      ])
    ).rows;
    expect(a[0].after).toEqual({ requisitionNumber: ref });
  });

  it('the first import saves the link and starts the run; then lists, fetches and analyzes every CV (10a (4), (13))', async () => {
    const { ref, vid } = await fresh(6, {
      files: [{ kind: 'pdf' }, { kind: 'docx' }, null, { kind: 'noExtension' }],
    });
    const st = await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 6 });
    expect(st.statusCode).toBe(202);
    const runId = st.json().runId;
    const v = (
      await q(
        `SELECT external_ref, external_system, external_link_state, status FROM vacancy WHERE id = $1`,
        [vid],
      )
    ).rows[0];
    expect(v).toEqual({
      external_ref: ref,
      external_system: 'oracle_hcm',
      external_link_state: 'approved',
      status: 'open',
    });
    const state0 = (await rec.api.get(`/vacancies/${vid}/oracle`)).json();
    expect(state0.link).toMatchObject({ ref, state: 'approved', canUnlink: false }); // a run is active
    expect(state0.run).toMatchObject({ runId, state: 'queued', phase: 'listing' });
    expect(JSON.stringify(state0)).not.toContain('oraclecloud');
    await drainAll(s.h);
    const state = (await rec.api.get(`/vacancies/${vid}/oracle`)).json();
    expect(state.run).toBeNull();
    expect(state.lastRun).toMatchObject({ state: 'completed', listed: 5 });
    expect(state.lastRun.counts).toMatchObject({ seen: 6, noFile: 1, listed: 5, fetched: 5 });
    const docs = (
      await q(
        `SELECT filename, parse_status FROM cv_document WHERE vacancy_id = $1 ORDER BY filename`,
        [vid],
      )
    ).rows;
    expect(docs).toHaveLength(5);
    expect(docs.map((d: any) => d.filename)).toEqual(expect.arrayContaining(['Resume.pdf']));
    expect(docs.every((d: any) => d.parse_status === 'parsed')).toBe(true);
    expect(s.fake.calls.filter((c) => c.overCollection)).toHaveLength(0);
    const link = (
      await q(
        `SELECT after FROM audit_event WHERE action = 'vacancy.external_link' AND entity_id = $1`,
        [vid],
      )
    ).rows;
    expect(link).toHaveLength(1);
    // No vacancy.start audit row (9).
    expect(
      (
        await q(
          `SELECT count(*)::int AS n FROM audit_event WHERE action = 'vacancy.start' AND entity_id = $1`,
          [vid],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('two POSTs at once: 1 run, 1 link row, the other 409 IMPORT_RUNNING with the same runId (10a (5))', async () => {
    const { ref, vid } = await fresh(2);
    const [a, b] = await Promise.all([
      rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 2 }),
      rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 2 }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([202, 409]);
    const ok = a.statusCode === 202 ? a : b;
    const no = a.statusCode === 202 ? b : a;
    expect(no.json()).toMatchObject({ code: 'IMPORT_RUNNING', runId: ok.json().runId });
    expect(
      (await q(`SELECT count(*)::int AS n FROM import_run WHERE vacancy_id = $1`, [vid])).rows[0].n,
    ).toBe(1);
    expect(
      (
        await q(
          `SELECT count(*)::int AS n FROM audit_event WHERE action = 'vacancy.external_link' AND entity_id = $1`,
          [vid],
        )
      ).rows[0].n,
    ).toBe(1);
    await drainAll(s.h);
  });

  it('a requisition linked to another vacancy: 409 ORACLE_REQ_LINKED, nothing written (10a (6))', async () => {
    const { ref, vid } = await fresh(1);
    await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 1 });
    await drainAll(s.h);
    const other = await s.h.scenario(rec.api, [], 'Other');
    const r = await rec.api.post(`/vacancies/${other}/oracle/imports`, { ref, estimate: 1 });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'ORACLE_REQ_LINKED', vacancyId: vid });
    expect(
      (await q(`SELECT external_ref FROM vacancy WHERE id = $1`, [other])).rows[0].external_ref,
    ).toBeNull();
  });

  it('every refusal has its code (10a (7)): retention off, cooldown, notice, EU AI, not found, Oracle down, sign-in', async () => {
    const { ref, vid } = await fresh(1);
    await q(`UPDATE retention_setting SET enabled = false WHERE id = 1`);
    expect((await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref })).json().code).toBe(
      'RETENTION_OFF',
    );
    await q(`UPDATE retention_setting SET enabled = true WHERE id = 1`);
    await s.h.admin.put('/admin/integrations/oracle/settings', { requireEuAi: true });
    expect((await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref })).json().code).toBe(
      'AI_NOT_EU',
    );
    await s.h.admin.put('/admin/integrations/oracle/settings', { requireEuAi: false });
    await q(`UPDATE integration_connection SET notice_attested_at = NULL`);
    expect((await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref })).json().code).toBe(
      'NOTICE_NOT_ATTESTED',
    );
    await q(`UPDATE integration_connection SET notice_attested_at = now()`);
    const nf = await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref: 'NOT-THERE' });
    expect([nf.statusCode, nf.json().code]).toEqual([404, 'ORACLE_REQ_NOT_FOUND']);
    s.fake.set({ unavailable: 'until_lifted' });
    const down = await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref });
    expect([down.statusCode, down.json().code]).toEqual([503, 'ORACLE_UNAVAILABLE']);
    s.fake.set({ unavailable: null });
    // 0 links and 0 runs were written by the refusals.
    expect(
      (await q(`SELECT count(*)::int AS n FROM import_run WHERE vacancy_id = $1`, [vid])).rows[0].n,
    ).toBe(0);
    expect(
      (await q(`SELECT external_ref FROM vacancy WHERE id = $1`, [vid])).rows[0].external_ref,
    ).toBeNull();
    // Cooldown after a run.
    await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 1 });
    await drainAll(s.h);
    const cool = (await rec.api.post(`/vacancies/${vid}/oracle/imports`, {})).json();
    expect(cool.code).toBe('IMPORT_COOLDOWN');
    expect(cool.message).toMatch(/^You can refresh again at \d\d:\d\d\.$/);
    expect(cool.allowedAt).toBeTruthy();
  });

  it('no edit right: 403; archived: 409 (10a (3))', async () => {
    const { ref, vid } = await fresh(1);
    const gov = await s.h.recruiter(`gov.${Date.now()}@azerconnect.test`, 'GOVERNANCE');
    expect((await gov.api.post(`/vacancies/${vid}/oracle/imports`, { ref })).statusCode).toBe(403);
    await q(`UPDATE vacancy SET archived_at = now(), archived_by = $2 WHERE id = $1`, [
      vid,
      rec.userId,
    ]);
    expect((await rec.api.post(`/vacancies/${vid}/oracle/lookup`, { ref })).statusCode).toBe(409);
    await q(`UPDATE vacancy SET archived_at = NULL, archived_by = NULL WHERE id = $1`, [vid]);
  });

  it('pauses above the estimate; Confirm continues and copies; Cancel on a pause copies nothing (S3-INT-11 (2))', async () => {
    const { ref, vid } = await fresh(5, { estimate: 3 });
    const runId = (
      await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 3 })
    ).json().runId;
    await drainAll(s.h);
    const st = (await rec.api.get(`/vacancies/${vid}/oracle`)).json();
    expect(st.run).toMatchObject({
      state: 'awaiting_confirm',
      confirmReason: 'above_estimate',
      listed: 5,
    });
    expect(st.run.pauseEndsAt).toBeTruthy();
    const c = await rec.api.post(`/import-runs/${runId}/confirm`);
    expect(c.statusCode).toBe(200);
    await drainAll(s.h);
    expect(
      (await q(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [vid])).rows[0]
        .n,
    ).toBe(5);

    const two = await fresh(4, { estimate: 2 });
    const r2 = (
      await rec.api.post(`/vacancies/${two.vid}/oracle/imports`, { ref: two.ref, estimate: 2 })
    ).json().runId;
    await drainAll(s.h);
    expect((await rec.api.post(`/import-runs/${r2}/cancel`)).json()).toEqual({ cancelled: true });
    const run = (await q(`SELECT state FROM import_run WHERE id = $1`, [r2])).rows[0];
    expect(run.state).toBe('cancelled');
    expect(
      (await q(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [two.vid]))
        .rows[0].n,
    ).toBe(0);
  });

  it('Refresh: nothing new; a gone applicant is flagged, then cleared when back; erased ones are withheld (S3-INT-13 (1)-(3), (6), (7))', async () => {
    const { ref, vid } = await fresh(3);
    await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 3 });
    await drainAll(s.h);
    const req = s.fake.state.requisitions.get(ref)!;
    await cooldownOff();
    const r1 = (await rec.api.post(`/vacancies/${vid}/oracle/imports`, {})).json().runId;
    await drainAll(s.h);
    expect(
      (await q(`SELECT state, batch_id, stats FROM import_run WHERE id = $1`, [r1])).rows[0],
    ).toMatchObject({
      state: 'completed',
      batch_id: null,
    });
    s.fake.withdraw(req.applications[0]!.id);
    await cooldownOff();
    await rec.api.post(`/vacancies/${vid}/oracle/imports`, {});
    await drainAll(s.h);
    expect((await rec.api.get(`/vacancies/${vid}/oracle`)).json().goneCount).toBe(1);
    s.fake.restore(req.applications[0]!.id);
    await cooldownOff();
    await rec.api.post(`/vacancies/${vid}/oracle/imports`, {});
    await drainAll(s.h);
    expect((await rec.api.get(`/vacancies/${vid}/oracle`)).json().goneCount).toBe(0);
    // Erase one, Refresh: withheld, nothing copied.
    const doc = (
      await q(
        `SELECT document_id FROM import_item WHERE vacancy_id = $1 AND document_id IS NOT NULL LIMIT 1`,
        [vid],
      )
    ).rows[0].document_id;
    await rec.api.post(`/documents/${doc}/erase`);
    await cooldownOff();
    const r4 = (await rec.api.post(`/vacancies/${vid}/oracle/imports`, {})).json().runId;
    await drainAll(s.h);
    const st = (await q(`SELECT stats FROM import_run WHERE id = $1`, [r4])).rows[0].stats;
    expect(st.withheld).toBe(1);
    expect(st.already).toBe(2);
    await q(
      `UPDATE import_run SET finished_at = now() - interval '31 days' WHERE vacancy_id = $1 AND state = 'completed'`,
      [vid],
    );
    expect((await rec.api.get(`/vacancies/${vid}/oracle`)).json().staleDays).toBe(31);
  });

  it('Oracle returns 0 applications: nothing is flagged as gone (S3-INT-13 (4))', async () => {
    const { ref, vid } = await fresh(2);
    await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 2 });
    await drainAll(s.h);
    s.fake.state.requisitions.get(ref)!.applications.forEach((a) => (a.purged = true));
    await cooldownOff();
    await rec.api.post(`/vacancies/${vid}/oracle/imports`, {});
    await drainAll(s.h);
    expect((await rec.api.get(`/vacancies/${vid}/oracle`)).json().goneCount).toBe(0);
  });

  it('a newer CV is imported next to the older one (S3-INT-11 (8)); old Word ends rejected (S3-INT-12 (4))', async () => {
    const { ref, vid } = await fresh(2, { files: [{ kind: 'txt' }, { kind: 'docAsPdf' }] });
    await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 2 });
    await drainAll(s.h);
    const codes = (
      await q(
        `SELECT u.outcome, u.code FROM import_item i JOIN upload_item u ON u.id = i.upload_item_id WHERE i.vacancy_id = $1 ORDER BY i.seq`,
        [vid],
      )
    ).rows.map((r: any) => `${r.outcome}/${r.code ?? ''}`);
    expect(codes).toEqual(['queued/', 'rejected/old_word_format']);
    const req = s.fake.state.requisitions.get(ref)!;
    s.fake.replaceCv(req.applications[0]!.id);
    await cooldownOff();
    const r = (await rec.api.post(`/vacancies/${vid}/oracle/imports`, {})).json().runId;
    await drainAll(s.h);
    const it = (await q(`SELECT supersedes_document_id FROM import_item WHERE run_id = $1`, [r]))
      .rows;
    expect(it).toHaveLength(1);
    expect(it[0].supersedes_document_id).toBeTruthy();
  });

  it('unlink: an editor while nothing imported; afterwards a team lead only; refused while a run is active (10a (8))', async () => {
    const a = await fresh(1);
    await s.h.admin.put('/admin/integrations/oracle/settings', { linkPolicy: 'open' });
    // Link without importing: start and cancel before anything is fetched.
    const runId = (
      await rec.api.post(`/vacancies/${a.vid}/oracle/imports`, { ref: a.ref, estimate: 1 })
    ).json().runId;
    expect((await rec.api.del(`/vacancies/${a.vid}/oracle/link`)).json().code).toBe(
      'IMPORT_RUNNING',
    );
    await rec.api.post(`/import-runs/${runId}/cancel`);
    expect((await rec.api.del(`/vacancies/${a.vid}/oracle/link`)).json()).toEqual({
      unlinked: true,
    });
    const b = await fresh(1);
    await rec.api.post(`/vacancies/${b.vid}/oracle/imports`, { ref: b.ref, estimate: 1 });
    await drainAll(s.h);
    expect((await rec.api.del(`/vacancies/${b.vid}/oracle/link`)).statusCode).toBe(403);
    await s.h.db.owner
      .query(
        `INSERT INTO vacancy_access (id, vacancy_id, user_id, granted_by) VALUES ('01JZZZZZZZZZZZZZZZZZZZZZZB', $1, $2, $3)`,
        [b.vid, lead.userId, rec.userId],
      )
      .catch(() => undefined);
    const byLead = await lead.api.del(`/vacancies/${b.vid}/oracle/link`);
    expect(byLead.json()).toEqual({ unlinked: true });
    expect(
      (await q(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [b.vid])).rows[0]
        .n,
    ).toBe(1);
  });

  it('lead approval switched on: a recruiter proposes, a team lead approves (10b (10))', async () => {
    const { ref, vid } = await fresh(1);
    await s.h.admin.put('/admin/integrations/oracle/settings', { linkPolicy: 'lead_approval' });
    try {
      const r = await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 1 });
      expect(r.json().code).toBe('LINK_NOT_APPROVED');
      expect(
        (await q(`SELECT external_link_state FROM vacancy WHERE id = $1`, [vid])).rows[0]
          .external_link_state,
      ).toBe('proposed');
      expect((await rec.api.post(`/vacancies/${vid}/oracle/link/approve`)).statusCode).toBe(403);
    } finally {
      await s.h.admin.put('/admin/integrations/oracle/settings', { linkPolicy: 'open' });
    }
  });

  it('the 11th lookup by one user in a minute answers 429 (10b (2))', async () => {
    const { ref, vid } = await fresh(1);
    const other = await s.h.recruiter(`lim.${Date.now()}@azerconnect.test`);
    const v2 = await s.h.scenario(other.api, [], 'Limit');
    let last;
    for (let i = 0; i < 11; i++)
      last = await other.api.post(`/vacancies/${v2}/oracle/lookup`, { ref });
    expect([last!.statusCode, last!.json().code]).toEqual([429, 'LOOKUP_LIMIT']);
    void vid;
  });

  it('Stop during fetching cancels the import (S3-INT-13 (8)); archive waits for it, then succeeds (9)', async () => {
    const { ref, vid } = await fresh(8);
    await rec.api.post(`/vacancies/${vid}/oracle/imports`, { ref, estimate: 8 });
    s.fake.hold();
    const tick = runner(s.h).tick();
    for (let i = 0; i < 200; i++) {
      const r = (await q(`SELECT phase FROM import_run WHERE vacancy_id = $1`, [vid])).rows[0];
      if (r?.phase === 'fetching') break;
      s.fake.release();
      s.fake.hold();
      await new Promise((res) => setTimeout(res, 5));
    }
    expect((await rec.api.post(`/vacancies/${vid}/archive`)).statusCode).toBe(409);
    const stop = (await rec.api.post(`/vacancies/${vid}/stop`)).json();
    expect(stop.importCancelled).toBe(true);
    s.fake.release();
    await tick;
    const run = (await q(`SELECT state FROM import_run WHERE vacancy_id = $1`, [vid])).rows[0];
    expect(run.state).toBe('cancelled');
    expect(
      (await q(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [vid])).rows[0]
        .n,
    ).toBeLessThanOrEqual(2);
    expect((await rec.api.post(`/vacancies/${vid}/archive`)).statusCode).toBeLessThan(300);
  });
});
