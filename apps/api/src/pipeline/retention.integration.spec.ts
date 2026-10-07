import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';
import { RetentionService } from './retention.service';

describeDb('Retention purge, legal hold, certificates (plan DOC-08..11)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('retain');
  });
  afterAll(async () => h?.close());

  const age = (vid: string, days: number) =>
    h.db.owner.query(
      `UPDATE cv_document SET uploaded_at = now() - ($2 || ' days')::interval WHERE vacancy_id = $1`,
      [vid, String(days)],
    );

  it('is for administrators and governance only, and rejects silly periods', async () => {
    const rec = await h.recruiter('ret-rec@azerconnect.test');
    expect((await rec.api.get('/admin/retention')).statusCode).toBe(403);
    expect((await rec.api.post('/admin/retention/run', {})).statusCode).toBe(403);
    expect((await h.admin.put('/admin/retention', { enabled: true, days: 3 })).statusCode).toBe(
      400,
    );
    const s = (await h.admin.get('/admin/retention')).json();
    expect(s.enabled).toBe(false);
  });

  it('previews, purges only expired documents outside a hold, and issues a certificate', async () => {
    const rec = await h.recruiter('ret-rec2@azerconnect.test');
    const old = await h.scenario(
      rec.api,
      [{ name: 'Old One', lines: ['BGP routing', 'Kubernetes'] }],
      'Old vacancy',
    );
    const held = await h.scenario(
      rec.api,
      [{ name: 'Held One', lines: ['BGP routing'] }],
      'Held vacancy',
    );
    const fresh = await h.scenario(
      rec.api,
      [{ name: 'Fresh One', lines: ['BGP routing'] }],
      'Fresh vacancy',
    );
    await age(old, 400);
    await age(held, 400);
    await h.admin.put('/admin/retention', { enabled: true, days: 180 });
    expect(
      (await h.admin.put(`/admin/vacancies/${held}/legal-hold`, { hold: true })).statusCode,
    ).toBe(400);
    expect(
      (
        await h.admin.put(`/admin/vacancies/${held}/legal-hold`, {
          hold: true,
          matter: 'Claim 2026-14',
        })
      ).statusCode,
    ).toBe(200);

    const dry = (await h.admin.post('/admin/retention/run', { dryRun: true })).json();
    expect(dry).toMatchObject({ dryRun: true, documents: 1, heldBack: 1 });
    expect(
      (await h.db.owner.query(`SELECT count(*)::int AS n FROM cv_document WHERE erased_at IS NULL`))
        .rows[0].n,
    ).toBe(3);

    const real = (await h.admin.post('/admin/retention/run', { dryRun: false })).json();
    expect(real).toMatchObject({ dryRun: false, documents: 1, heldBack: 1, vacancies: 1 });
    expect(real.certificateId).toMatch(/^[0-9A-Z]{26}$/);

    const state = (vid: string) =>
      h.db.owner
        .query(`SELECT erased_at, text, content FROM cv_document WHERE vacancy_id = $1`, [vid])
        .then((r) => r.rows[0]);
    const o = await state(old);
    expect(o.erased_at).not.toBeNull();
    expect(o.text).toBeNull();
    expect(o.content).toBeNull();
    expect((await state(held)).erased_at).toBeNull();
    expect((await state(fresh)).erased_at).toBeNull();

    const cand = (
      await h.db.owner.query(
        `SELECT candidate_name FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1`,
        [old],
      )
    ).rows[0];
    expect(cand.candidate_name).toBeNull();

    const audit = (
      await h.db.owner.query(
        `SELECT action FROM audit_event WHERE action IN ('document.purge','retention.run','vacancy.legal_hold_on') ORDER BY seq`,
      )
    ).rows.map((r: { action: string }) => r.action);
    expect(audit).toEqual(['vacancy.legal_hold_on', 'document.purge', 'retention.run']);

    // Lifting the hold lets the next run take it; a run with nothing left erases nothing.
    await h.admin.put(`/admin/vacancies/${held}/legal-hold`, { hold: false });
    expect((await h.admin.post('/admin/retention/run', { dryRun: false })).json()).toMatchObject({
      documents: 1,
      heldBack: 0,
    });
    expect((await h.admin.post('/admin/retention/run', { dryRun: false })).json()).toMatchObject({
      documents: 0,
    });

    const status = (await h.admin.get('/admin/retention')).json();
    expect(status.certificates.length).toBe(3);
    expect(JSON.stringify(status)).not.toMatch(/Old One|Held One/);
  });

  it('the scheduled path erases nothing while retention is switched off', async () => {
    await h.admin.put('/admin/retention', { enabled: false, days: 180 });
    const svc = h.app.get(RetentionService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (svc as any).scheduled();
    expect(
      (
        await h.db.owner.query(
          `SELECT count(*)::int AS n FROM audit_event WHERE action = 'retention.run'`,
        )
      ).rows[0].n,
    ).toBe(3);
  });
});
