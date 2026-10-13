import { describeDb } from '../testing/pg-harness';
import { boot, scriptedModel, type Harness } from '../testing/app-harness';
import { ProcessorService } from '../pipeline/processor.service';

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
    const answerCalls = () =>
      h.modelCalls.filter((c) => !c.system.includes('ONE JSON query')).length;
    const calls = answerCalls();
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
    // Reading a longer question may call the model; no answer is ever written by it.
    expect(answerCalls()).toBe(calls);
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

  it('writes an interview kit: the same core question per requirement, probes from the resume', async () => {
    const { a, first, cid } = await start('t9@azerconnect.test', 'Kit Probe Role');
    const r = (
      await a.api.post('/assistant/ask', {
        message: 'interview questions for the second',
        conversationId: cid,
      })
    ).json().answer;
    expect(r.flags).toContain('interview_kit');
    expect(r.table.rows).toHaveLength(3);
    expect(r.table.rows[0].cells[0]).toMatch(/Tell me about a time you used BGP routing/);
    expect(r.copyable).toBe(true);
    expect(r.headline).toContain(first.answer.rows[1].label);
    // Bob has BGP only: the Kubernetes probe says it is not found.
    const probes = r.table.rows.map((x: any) => x.cells[2]).join(' ');
    expect(probes).toMatch(/Not found in the resume/);
  });

  it('shows pairs with the same evidence and different marks, only from your own marks', async () => {
    const a = await h.recruiter('t10@azerconnect.test');
    const twin = [
      { name: 'Dana One', lines: ['BGP routing.', 'Kubernetes.'] },
      { name: 'Dana Two', lines: ['BGP routing.', 'Kubernetes.'] },
    ];
    const vid = await h.scenario(a.api, twin, 'Twin Probe Role');
    const rows = (await a.api.get(`/candidates?vacancy=${vid}`)).json().rows;
    await a.api.put(`/candidates/${rows[0].matchId}/decision`, {
      mark: 'shortlist',
      expectedVersion: 0,
    });
    await a.api.put(`/candidates/${rows[1].matchId}/decision`, {
      mark: 'not_now',
      expectedVersion: 0,
      note: 'too old for the team',
    });
    const r = (
      await a.api.post('/assistant/ask', { message: 'check my decisions for Twin Probe Role' })
    ).json().answer;
    expect(r.flags).toContain('consistency');
    expect(r.headline).toMatch(/1 pair/);
    expect(r.notes.join(' ')).toMatch(/not one of the requirements/);
    // Someone else sees nothing: those are not their marks.
    const b = await h.recruiter('t11@azerconnect.test');
    const other = (
      await b.api.post('/assistant/ask', { message: 'check my decisions for Twin Probe Role' })
    ).json().answer;
    expect(other.headline).toMatch(/no pair/);
  });

  it('flags near copies and thin resumes', async () => {
    const a = await h.recruiter('t12@azerconnect.test');
    const body = Array.from(
      { length: 40 },
      (_, i) => `Worked on BGP routing project number ${i} for the core network.`,
    );
    const vid = await h.scenario(
      a.api,
      [
        { name: 'Copy Alpha', lines: body },
        { name: 'Copy Beta', lines: body.map((x) => x) },
        { name: 'Tiny Gamma', lines: ['Hi.'] },
      ],
      'Quality Probe Role',
    );
    expect(vid).toBeTruthy();
    const r = (
      await a.api.post('/assistant/ask', { message: 'data quality for Quality Probe Role' })
    ).json().answer;
    expect(r.flags).toContain('data_quality');
    expect(r.table.rows.map((x: any) => x.cells[1]).join(' ')).toMatch(/copy of/);
    expect(r.table.rows.map((x: any) => x.cells[1]).join(' ')).toMatch(/Thin resume/);
  });

  it('checks a job description and only suggests', async () => {
    const a = await h.recruiter('t13@azerconnect.test');
    await h.scenario(a.api, [], 'Jd Probe Role');
    const r = (
      await a.api.post('/assistant/ask', { message: 'check the JD for Jd Probe Role' })
    ).json().answer;
    expect(r.flags).toContain('jd_check');
    expect(r.headline).toMatch(/Nothing was changed|nothing to suggest/);
  });

  it('gives JD suggestions on its own endpoint, with no model call, in the language asked', async () => {
    const a = await h.recruiter('t13b@azerconnect.test');
    const vid = await h.scenario(a.api, [], 'Coach Probe Role');
    const before = h.modelCalls.length;
    const r = (await a.api.get(`/assistant/jd-coach/${vid}?language=az`)).json();
    expect(r.vacancyId).toBe(vid);
    expect(Array.isArray(r.tips)).toBe(true);
    expect(r.headline).toMatch(/Coach Probe Role/);
    expect(h.modelCalls.length).toBe(before);
    const en = (await a.api.get(`/assistant/jd-coach/${vid}`)).json();
    expect(en.language).toBe('en');
    // Not visible to a recruiter who cannot see the vacancy.
    expect(
      (await a.api.get('/assistant/jd-coach/01ARZ3NDEKTSV4RRFFQ69G5FAV')).statusCode,
    ).toBeGreaterThanOrEqual(403);
  });

  it('declines web lookups, personality guesses and salary per candidate', async () => {
    const a = await h.recruiter('t14@azerconnect.test');
    for (const [q, flag] of [
      ['look him up on LinkedIn', 'refused:web_lookup'],
      ['is she loyal and honest?', 'refused:personality'],
      ['what salary does he expect', 'refused:salary'],
      ['Facebook-da bu namizədi axtar', 'refused:web_lookup'],
    ] as const) {
      const r = (await a.api.post('/assistant/ask', { message: q })).json().answer;
      expect(r.kind).toBe('decline');
      expect(r.flags).toContain(flag);
    }
  });

  it('keeps the stored state when pushed, and checks the resume for what was said', async () => {
    const { a, first, cid } = await start('t15@azerconnect.test', 'Push Probe Role');
    // The second candidate (Bob) has no Kubernetes; the first (Alice) does.
    const found = (
      await a.api.post('/assistant/ask', {
        message: 'but the first does know Kubernetes',
        conversationId: cid,
      })
    ).json().answer;
    expect(found.flags).toContain('possible_missed_evidence');
    expect(found.actions[0].href).toBe(`#/candidates/${first.answer.rows[0].matchId}`);
    const held = (
      await a.api.post('/assistant/ask', {
        message: 'but the second does know Kubernetes',
        conversationId: cid,
      })
    ).json().answer;
    expect(held.flags).toContain('pushback_held');
    expect(held.headline).toMatch(/stored assessment stands/);
  });

  it('remembers "always top N" and lets a chip be taken off', async () => {
    const { a, cid } = await start('t16@azerconnect.test', 'Chip Probe Role');
    const saved = (
      await a.api.post('/assistant/ask', { message: 'always top 2', conversationId: cid })
    ).json().answer;
    expect(saved.flags).toContain('preference');
    const list = (
      await a.api.post('/assistant/ask', { message: 'candidates for Chip Probe Role' })
    ).json();
    expect(list.answer.rows).toHaveLength(2);
    expect(list.answer.more).toBe(1);
    expect(list.answer.receipt.by).toBe('rules');
    // Take the "Top 2" chip off: the same question, all five shown.
    const wide = (
      await a.api.post('/assistant/ask', {
        message: '',
        conversationId: list.conversationId,
        without: { kind: 'top' },
      })
    ).json().answer;
    expect(wide.rows).toHaveLength(3);
  });

  it('keeps rediscovery off until the administrator switches it on', async () => {
    const a = await h.recruiter('t17@azerconnect.test');
    await h.scenario(a.api, cvs, 'Source Probe Role');
    const vid2 = await h.scenario(a.api, [], 'Target Probe Role');
    expect(vid2).toBeTruthy();
    const off = (
      await a.api.post('/assistant/ask', {
        message: 'rediscover candidates from other vacancies for Target Probe Role',
      })
    ).json().answer;
    expect(off.flags).toContain('switch_off:rediscovery');
    // The button endpoint is closed too while the switch is off.
    const closed = await a.api.post('/assistant/rediscovery/analyze', {
      matchId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      vacancyId: vid2,
    });
    expect(closed.statusCode).toBe(403);
    const cur = (await h.admin.get('/admin/assistant')).json().settings;
    const put = await h.admin.put('/admin/assistant', {
      ...cur,
      features: { ...cur.features, rediscovery: true },
      regionAllowed: 'EU only',
      dataTerms: 'no_retention',
      attest: true,
    });
    expect(put.statusCode).toBe(200);
    const on = (
      await a.api.post('/assistant/ask', {
        message: 'rediscover candidates from other vacancies for Target Probe Role',
      })
    ).json().answer;
    expect(on.flags).toContain('rediscovery');
    expect(on.table.rows.length).toBeGreaterThan(0);

    // "Analyze for this vacancy": the resume is copied here and scored like any upload.
    expect(on.analyze.length).toBe(on.table.rows.length);
    const first = on.analyze[0];
    expect(first.vacancyId).toBe(vid2);
    const done = await a.api.post('/assistant/rediscovery/analyze', {
      matchId: first.matchId,
      vacancyId: first.vacancyId,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().queued).toBe(true);
    await h.app.get(ProcessorService).drain();
    const copy = await h.db.owner.query(
      `SELECT d.id, d.copied_from AS "from", s.state FROM cv_document d JOIN screening s ON s.document_id = d.id
        WHERE d.vacancy_id = $1`,
      [vid2],
    );
    expect(copy.rows).toHaveLength(1);
    expect(copy.rows[0].from).toBeTruthy();
    expect(copy.rows[0].state).toBe('completed');
    // The same resume cannot be added twice, and nothing was copied for a vacancy the person cannot see.
    const again = await a.api.post('/assistant/rediscovery/analyze', {
      matchId: first.matchId,
      vacancyId: first.vacancyId,
    });
    expect(again.statusCode).toBe(409);
    const stranger = await h.recruiter('t17b@azerconnect.test');
    const nope = await stranger.api.post('/assistant/rediscovery/analyze', {
      matchId: first.matchId,
      vacancyId: first.vacancyId,
    });
    expect(nope.statusCode).toBeGreaterThanOrEqual(403);
    // Erasing the original erases the copy: it is the same person's data.
    const er = await a.api.post(`/documents/${copy.rows[0].from}/erase`);
    expect(er.statusCode).toBe(200);
    const after = await h.db.owner.query(
      `SELECT erased_at, content, text FROM cv_document WHERE id = $1`,
      [copy.rows[0].id],
    );
    expect(after.rows[0].erased_at).not.toBeNull();
    expect(after.rows[0].content).toBeNull();
    expect(after.rows[0].text).toBeNull();
    const audit = await h.db.owner.query(
      `SELECT action FROM audit_event WHERE action = 'assistant.rediscovery_analyze'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    await h.admin.put('/admin/assistant', {
      ...cur,
      features: { ...cur.features, rediscovery: false },
      regionAllowed: 'EU only',
      dataTerms: 'no_retention',
      attest: true,
    });
  });

  it('says it once, at the moment of the mark: same evidence, different marks; a reason that is not the job', async () => {
    const a = await h.recruiter('t20@azerconnect.test');
    const twin = [
      { name: 'Eli One', lines: ['BGP routing.', 'Kubernetes.'] },
      { name: 'Eli Two', lines: ['BGP routing.', 'Kubernetes.'] },
    ];
    const vid = await h.scenario(a.api, twin, 'Mirror Probe Role');
    const rows = (await a.api.get(`/candidates?vacancy=${vid}`)).json().rows;
    const first = await a.api.put(`/candidates/${rows[0].matchId}/decision`, {
      mark: 'shortlist',
      expectedVersion: 0,
    });
    expect(first.json().mirror).toBeUndefined();
    const second = await a.api.put(`/candidates/${rows[1].matchId}/decision`, {
      mark: 'not_now',
      expectedVersion: 0,
    });
    expect(second.json().mirror).toMatchObject({ kind: 'pair', mark: 'shortlist' });
    // Once per pair: marking again says nothing more.
    const again = await a.api.put(`/candidates/${rows[1].matchId}/decision`, {
      mark: 'not_now',
      note: 'too old',
      expectedVersion: 1,
    });
    expect(again.json().mirror).toMatchObject({ kind: 'reason' });
    const quiet = await a.api.put(`/candidates/${rows[1].matchId}/decision`, {
      mark: 'maybe',
      expectedVersion: 2,
    });
    expect(quiet.json().mirror).toBeUndefined();
    // Another recruiter's marks are never read.
    const b = await h.recruiter('t21@azerconnect.test');
    const other = await b.api.put(`/candidates/${rows[1].matchId}/decision`, {
      mark: 'not_now',
      expectedVersion: 3,
    });
    expect(other.json().mirror).toBeUndefined();
  });
});
