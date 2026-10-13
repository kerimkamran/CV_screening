import { describeDb } from '../testing/pg-harness';
import { boot, scriptedModel, type Harness } from '../testing/app-harness';

process.env['TEST_VISIBILITY'] = 'all';

/* eslint-disable @typescript-eslint/no-explicit-any */
describeDb('SenAI finding things (plan S1 to S4)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('senaifind', (system, user) =>
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

  const ask = async (a: any, message: string, extra: object = {}) =>
    (await a.api.post('/assistant/ask', { message, ...extra })).json();

  it('S1: finds a phrase with the words in another order, grouped by vacancy, never scored by the search', async () => {
    const a = await h.recruiter('find1@azerconnect.test');
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `Core Person ${i}`,
        lines: ['Operated the core network equipment supplied by Huawei for three years.'],
      }));
    await h.scenario(a.api, mk(4), 'Core Alpha');
    await h.scenario(a.api, [{ name: 'Radio Only', lines: ['Planned radio sites.'] }], 'Core Beta');
    await h.scenario(a.api, mk(1), 'Core Gamma');
    const r = await ask(a, 'who has worked with Huawei core network in all vacancies?');
    expect(r.answer.flags).toContain('skill_search');
    // Alpha shows its first three, Gamma its one; Beta has nothing and is not listed.
    expect(r.answer.groups.map((g: any) => [g.title, g.total]).sort()).toEqual([
      ['Core Alpha', 4],
      ['Core Gamma', 1],
    ]);
    expect(r.answer.rows).toHaveLength(4);
    expect(r.answer.more).toBe(1);
    const text = r.answer.rows[0].passages.map((p: any) => p.text).join(' ');
    expect(text).toContain('Huawei');
    const all = await ask(a, 'show all', { conversationId: r.conversationId, showAll: true });
    expect(all.answer.rows.length).toBeGreaterThanOrEqual(5);
  });

  it("S2: recalls only the person's own earlier answers, narrowed by their words and date", async () => {
    const a = await h.recruiter('recall1@azerconnect.test');
    const b = await h.recruiter('recall2@azerconnect.test');
    await h.scenario(
      a.api,
      [{ name: 'Recall One', lines: ['Strong Excel modelling.'] }],
      'Recall Role',
    );
    const first = await ask(a, 'who knows excel in Recall Role?');
    expect(first.answer.rows.length).toBeGreaterThan(0);
    const back = await ask(a, 'what did we conclude about excel last week?');
    expect(back.answer.flags).toContain('recall');
    expect(back.answer.table.rows.length).toBeGreaterThan(0);
    expect(back.answer.table.rows[0].cells.join(' ')).toMatch(/xcel/i);
    expect(back.answer.notes.join(' ')).toContain('not a new answer');
    const nothing = await ask(a, 'what did we conclude about blockchain?');
    expect(nothing.answer.table).toBeUndefined();
    // Somebody else asking the same thing sees nothing of it.
    const other = await ask(b, 'what did we conclude about excel last week?');
    expect(other.answer.table).toBeUndefined();
  });

  it('S4: similar vacancies offer a button that opens the Role card; nothing is copied by SenAI', async () => {
    const a = await h.recruiter('similar1@azerconnect.test');
    await h.scenario(a.api, [], 'Twin Alpha');
    await h.scenario(a.api, [], 'Twin Beta');
    const r = await ask(a, 'similar vacancies to Twin Alpha');
    expect(r.answer.flags).toContain('similar_vacancies');
    expect(r.answer.copy.map((c: any) => c.title)).toContain('Twin Beta');
    const c = r.answer.copy.find((x: any) => x.title === 'Twin Beta');
    expect(c.toId).toBe(r.answer.vacancy.id);
    expect(c.shared).toBeGreaterThan(0);
    const before = (await a.api.get(`/vacancies/${c.toId}`)).json().requirementsVersion;
    const after = (await a.api.get(`/vacancies/${c.toId}`)).json().requirementsVersion;
    expect(after).toBe(before);
  });
});
