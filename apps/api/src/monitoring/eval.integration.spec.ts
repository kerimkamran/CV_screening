import { describeDb } from '../testing/pg-harness';
import { boot, scriptedModel, type Harness } from '../testing/app-harness';
import { EvalService } from './eval.service';

describeDb('Fairness tooling (plan EVAL-01/06)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('fair');
  });
  afterAll(async () => h?.close());

  async function runEval(arms?: string[]) {
    const r = await h.admin.post('/admin/eval/paired', arms ? { arms } : {});
    expect(r.statusCode).toBe(202);
    await h.app.get(EvalService).idle();
    return (await h.admin.get(`/admin/eval/${r.json().id}`)).json();
  }

  it('only the administrator can start a run; others cannot even read it', async () => {
    const rec = await h.recruiter('fair-rec@azerconnect.test');
    expect((await rec.api.post('/admin/eval/paired', {})).statusCode).toBe(403);
    expect((await rec.api.get('/admin/eval')).statusCode).toBe(403);
    expect((await rec.api.get('/admin/fairness')).statusCode).toBe(403);
    expect((await h.admin.post('/admin/eval/paired', { arms: ['nonsense'] })).statusCode).toBe(400);
  });

  it('sends synthetic CVs with masked identities, and finds a fair model consistent', async () => {
    h.modelCalls.length = 0;
    const run = await runEval();
    expect(run.state).toBe('done');
    expect(run.total).toBe(48);
    expect(run.progress).toBe(48);
    expect(
      run.result.summary.map((s: { arm: string; verdict: string }) => [s.arm, s.verdict]),
    ).toEqual([
      ['masked', 'consistent'],
      ['unmasked', 'consistent'],
    ]);
    // 3 templates x 3 variants that carry "Aysel" were sent as written in the unmasked arm only.
    const withName = h.modelCalls.filter((c) => c.user.includes('Aysel'));
    expect(withName).toHaveLength(9);
    expect(h.modelCalls.filter((c) => c.user.includes('maternity'))).toHaveLength(6); // free text is not masked
    const log = (
      await h.db.owner.query(
        `SELECT action FROM audit_event WHERE action LIKE 'eval.%' ORDER BY seq`,
      )
    ).rows;
    expect(log.map((r: { action: string }) => r.action)).toEqual(['eval.started', 'eval.finished']);
  });

  it('catches a model whose score moves with the name, and shows what masking still leaves', async () => {
    h.setModel((system, user) => {
      const base = scriptedModel(system, user);
      if (!system.includes('assess ONE candidate') && !user.includes('<<<CV_START>>>')) return base;
      if (!/Aysel|Elçin|Elena|Sergey|maternity/.test(user)) return base;
      const j = JSON.parse(base);
      j.assessments = j.assessments.map((a: { id: string; status: string }, i: number) =>
        i === 0
          ? {
              id: a.id,
              status: 'not_found',
              confidence: 'high',
              evidence: [],
              rationale: 'Absent.',
            }
          : a,
      );
      return JSON.stringify(j);
    });
    const run = await runEval();
    const by = Object.fromEntries(run.result.summary.map((s: { arm: string }) => [s.arm, s]));
    // Names and personal lines never reach the model in production, so only the free-text career
    // break still moves the score (two templates have a BGP line to lose).
    expect(by.masked.verdict).toBe('review');
    expect(by.masked.differing).toBe(2);
    expect(by.masked.worst.variant).toBe('break');
    // Without masking, every changed name moves it.
    expect(by.unmasked.differing).toBe(12);
    expect(by.unmasked.maxAbsDelta).toBeGreaterThan(by.masked.maxAbsDelta - 1);
    const list = (await h.admin.get('/admin/eval')).json();
    expect(list.runs).toHaveLength(2);
    expect(list.design.variants.map((v: { key: string }) => v.key)).toContain('break');
    h.setModel(scriptedModel);
  });

  it('a failing provider ends the run as failed, not stuck', async () => {
    h.setModel(() => {
      throw new Error('boom');
    });
    const run = await runEval(['masked']);
    expect(run.state).toBe('failed');
    expect(run.error).toBeTruthy();
    h.setModel(scriptedModel);
  });

  it('reports aggregate fairness signals and nothing about individuals', async () => {
    const ayla = await h.recruiter('fair-ayla@azerconnect.test');
    await h.scenario(ayla.api, [
      { name: 'Alice Full', lines: ['BGP routing.', 'Kubernetes.'] },
      { name: 'Bob Routing', lines: ['BGP routing.'] },
    ]);
    const r = (await h.admin.get('/admin/fairness')).json();
    expect(r.totals.files).toBeGreaterThanOrEqual(2);
    expect(r.dimensions.map((d: { key: string }) => d.key)).toEqual([
      'language',
      'format',
      'length',
    ]);
    // Fewer than five files in a group: suppressed, never listed.
    expect(r.dimensions[0].groups).toEqual([]);
    expect(r.dimensions[0].suppressed).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(r)).not.toMatch(/Alice|Bob|candidateName/);
  });
});
