import { describeDb } from '../testing/pg-harness';
import { boot, scriptedModel, type Harness } from '../testing/app-harness';

process.env['TEST_VISIBILITY'] = 'all';

/* eslint-disable @typescript-eslint/no-explicit-any */
describeDb('SenAI skills dictionary that an administrator extends (plan F7, C9)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('senaiskills', (system, user) =>
      system.includes('ONE JSON query')
        ? JSON.stringify({ intent: 'unknown' })
        : system.includes('second reader')
          ? JSON.stringify({
              headline: 'x',
              claims: [{ text: 'x', source: 'MATCH' }],
              cant_see: 'x',
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
    { name: 'Zed One', lines: ['Built Zorblax suites for operators.'] },
    { name: 'Yan Two', lines: ['Cooking.'] },
  ];
  const ask = async (a: any, message: string) =>
    (await a.api.post('/assistant/ask', { message })).json();

  it('knows a word only after an administrator approves it', async () => {
    const a = await h.recruiter('sk1@azerconnect.test');
    await h.scenario(a.api, cvs, 'Skills Role');
    // Not in the dictionary: the question is still searched as written words.
    const before = await ask(a, 'who knows Zorblax?');
    expect(before.answer.skills).toEqual(['Zorblax']);

    // A recruiter suggests; nothing changes until it is approved.
    const sug = await a.api.post('/assistant/skills/suggest', {
      label: 'Zorblax',
      kind: 'tool',
      aliases: ['zorblax suite', 'zorblaxx'],
    });
    expect(sug.statusCode).toBe(200);
    expect(sug.json().status).toBe('proposed');
    const typo = await ask(a, 'who knows zorblaxx?');
    expect(typo.answer.rows).toHaveLength(0);

    const approved = await h.admin.post(`/admin/assistant/skills/${sug.json().id}/decide`, {
      to: 'approved',
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('approved');
    // The typo-spelling now reads as the same skill and finds the line.
    const after = await ask(a, 'who knows zorblaxx?');
    expect(after.answer.skills).toEqual(['Zorblax']);
    expect(after.answer.rows.length).toBeGreaterThan(0);
  });

  it('only an administrator can add or decide, and a recruiter cannot list the table', async () => {
    const a = await h.recruiter('sk2@azerconnect.test');
    expect(
      (await a.api.post('/admin/assistant/skills', { label: 'X1', kind: 'tool', aliases: ['x1'] }))
        .statusCode,
    ).toBe(403);
    expect((await a.api.get('/admin/assistant/skills')).statusCode).toBe(403);
  });

  it('adds ways to write a built-in skill, refuses a clash, and a rejected entry is not read', async () => {
    const add = await h.admin.post('/admin/assistant/skills', {
      label: 'Excel',
      kind: 'tool',
      extends: 'excel',
      aliases: ['spreadsheet wizardry'],
    });
    expect(add.statusCode).toBe(201);
    const a = await h.recruiter('sk3@azerconnect.test');
    await h.scenario(
      a.api,
      [{ name: 'Wiz', lines: ['Spreadsheet wizardry and Excel.'] }],
      'Skills Role 2',
    );
    const r = await ask(a, 'who knows spreadsheet wizardry?');
    expect(r.answer.skills).toEqual(['Excel']);

    // "python" is already read as Python: a new skill may not claim it.
    const clash = await h.admin.post('/admin/assistant/skills', {
      label: 'Snake',
      kind: 'tool',
      aliases: ['python'],
    });
    expect(clash.statusCode).toBe(409);
    // A built-in id cannot be extended with a made-up id.
    const bad = await h.admin.post('/admin/assistant/skills', {
      label: 'Nope',
      kind: 'tool',
      extends: 'nosuchskill',
      aliases: ['nope nope'],
    });
    expect(bad.statusCode).toBe(400);

    const rej = await h.admin.post(`/admin/assistant/skills/${add.json().id}/decide`, {
      to: 'rejected',
      note: 'not needed',
    });
    expect(rej.json().status).toBe('rejected');
    const gone = await ask(a, 'who knows spreadsheet wizardry?');
    expect(gone.answer.skills[0]).not.toBe('Excel');
  });

  it('writes every change to the audit trail', async () => {
    const { rows } = await h.db.owner.query(
      `SELECT action FROM audit_event WHERE entity_type = 'assistant_skill' ORDER BY seq`,
    );
    const actions = rows.map((r: any) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'assistant.skill_suggested',
        'assistant.skill_approved',
        'assistant.skill_added',
        'assistant.skill_rejected',
      ]),
    );
  });
});
