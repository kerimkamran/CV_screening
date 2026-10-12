import { describeDb } from '../testing/pg-harness';
import { boot, scriptedModel, type Harness } from '../testing/app-harness';

process.env['TEST_VISIBILITY'] = 'all';

/* eslint-disable @typescript-eslint/no-explicit-any */
describeDb('SenAI tools: compare, doctor, changes, what-if, open, help (plan section 5)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('senaitools', (system, user) =>
      system.includes('ONE JSON query')
        ? JSON.stringify({ intent: 'unknown' })
        : system.includes('second reader')
          ? JSON.stringify({
              headline: 'The stored match shows a tally.',
              claims: [{ text: 'See the tally.', source: 'MATCH' }],
              cant_see: "The CV doesn't mention everything; that is not evidence of a gap.",
              outcome: 'held',
            })
          : scriptedModel(system, user),
    );
    const cur = (await h.admin.get('/admin/assistant')).json().settings;
    expect((await h.admin.post('/admin/assistant/test', {})).json().ok).toBe(true);
    const r = await h.admin.put('/admin/assistant', {
      enabled: true,
      name: 'SenAI',
      modelRowId: cur.modelRowId,
      features: cur.features,
      unavailableMessage: cur.unavailableMessage,
      regionAllowed: 'EU only',
      dataTerms: 'no_retention',
      dailyCap: null,
      monthlyCap: null,
      warnPct: 80,
      attest: true,
    });
    expect(r.statusCode).toBe(200);
  });
  afterAll(async () => {
    delete process.env['TEST_VISIBILITY'];
    await h?.close();
  });

  const cvs = [
    { name: 'Alice Full', lines: ['BGP routing.', 'Kubernetes.', 'Python scripting.'] },
    { name: 'Bob Routing', lines: ['BGP routing.'] },
    { name: 'Carol Nothing', lines: ['Cooking.'] },
  ];

  async function start(email: string, title: string) {
    const a = await h.recruiter(email);
    const vid = await h.scenario(a.api, cvs, title);
    const first = (
      await a.api.post('/assistant/ask', { message: `candidates for ${title}` })
    ).json();
    return { a, vid, first, cid: first.conversationId as string };
  }

  it('compares two candidates from the last list, side by side, without a model', async () => {
    const { a, first, cid } = await start('t1@azerconnect.test', 'Compare Probe Role');
    const calls = h.modelCalls.length;
    const r = (
      await a.api.post('/assistant/ask', {
        message: 'compare the first and the second',
        conversationId: cid,
      })
    ).json().answer;
    expect(r.kind).toBe('pool');
    expect(r.flags).toContain('compare');
    expect(r.table.head).toHaveLength(3);
    expect(r.table.head[1]).toBe(first.answer.rows[0].label);
    const kube = r.table.rows.find((x: any) => x.cells[0] === 'Kubernetes');
    expect(kube.tag).toBe('must');
    expect(kube.cells.slice(1)).toEqual(['Met', 'Not found']);
    expect(h.modelCalls.length).toBe(calls);
  });

  it('asks who to compare when nobody is pointed at', async () => {
    const { a, cid } = await start('t2@azerconnect.test', 'Compare Who Role');
    const r = (
      await a.api.post('/assistant/ask', { message: 'compare candidates', conversationId: cid })
    ).json().answer;
    expect(r.kind).toBe('help');
    expect(r.headline).toMatch(/Which candidates/);
  });

  it('diagnoses why there are few Strong matches: the rarest must-have', async () => {
    const { a } = await start('t3@azerconnect.test', 'Doctor Probe Role');
    const r = (
      await a.api.post('/assistant/ask', { message: 'why so few Strong for Doctor Probe Role?' })
    ).json().answer;
    expect(r.kind).toBe('pool');
    expect(r.flags).toContain('doctor');
    expect(r.headline).toMatch(/rarest must-have is "Kubernetes": 1 of 3/);
    expect(r.table.rows[0].cells[0]).toBe('Kubernetes');
    expect(r.suggestions[0]).toMatch(/What if "Kubernetes" were nice-to-have/);
  });

  it('answers a what-if from the stored analysis and saves nothing', async () => {
    const { a, vid } = await start('t4@azerconnect.test', 'WhatIf Probe Role');
    const before = (await a.api.get(`/candidates?vacancy=${vid}`))
      .json()
      .rows.map((x: any) => x.score);
    const r = (
      await a.api.post('/assistant/ask', {
        message: 'what if Kubernetes were nice to have for WhatIf Probe Role',
      })
    ).json().answer;
    expect(r.flags).toContain('what_if');
    expect(r.headline).toMatch(/If "Kubernetes" were nice-to-have/);
    expect(r.table.rows.length).toBeGreaterThan(0);
    const after = (await a.api.get(`/candidates?vacancy=${vid}`))
      .json()
      .rows.map((x: any) => x.score);
    expect(after).toEqual(before);
  });

  it('lists what changed since a date', async () => {
    const { a } = await start('t5@azerconnect.test', 'Changes Probe Role');
    const r = (
      await a.api.post('/assistant/ask', {
        message: 'what changed since yesterday in Changes Probe Role',
      })
    ).json().answer;
    expect(r.flags).toContain('changes');
    expect(r.headline).toMatch(/3 new analyzed/);
    expect(r.table.rows).toHaveLength(3);
  });

  it('opens a candidate from the list by number', async () => {
    const { a, first, cid } = await start('t6@azerconnect.test', 'Open Probe Role');
    const r = (
      await a.api.post('/assistant/ask', { message: 'open the second', conversationId: cid })
    ).json().answer;
    expect(r.actions[0].href).toBe(`#/candidates/${first.answer.rows[1].matchId}`);
  });

  it('explains a word and what it can see, in the language asked', async () => {
    const a = await h.recruiter('t7@azerconnect.test');
    await h.scenario(a.api, cvs.slice(0, 1), 'Help Probe Role');
    const w = (
      await a.api.post('/assistant/ask', { message: 'what does out of date mean?' })
    ).json().answer;
    expect(w.kind).toBe('help');
    expect(w.headline).toMatch(/earlier requirements/);
    const about = (await a.api.post('/assistant/ask', { message: 'what can you see?' })).json()
      .answer;
    expect(about.kind).toBe('help');
    expect(about.notes.join(' ')).toMatch(/never sees a resume/);
  });

  it('keeps the list a follow-up refers to after a tool answer', async () => {
    const { a, first, cid } = await start('t8@azerconnect.test', 'Keep Probe Role');
    await a.api.post('/assistant/ask', { message: 'why so few Strong?', conversationId: cid });
    const r = (
      await a.api.post('/assistant/ask', { message: 'open the first', conversationId: cid })
    ).json().answer;
    expect(r.actions[0].href).toBe(`#/candidates/${first.answer.rows[0].matchId}`);
  });
});
