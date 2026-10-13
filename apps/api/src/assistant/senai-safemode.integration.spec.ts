import { describeDb } from '../testing/pg-harness';
import { AiGateway, BREAKER } from '../ai/ai-gateway.service';
import { boot, scriptedModel, type Harness } from '../testing/app-harness';

process.env['TEST_VISIBILITY'] = 'all';

/* eslint-disable @typescript-eslint/no-explicit-any */
describeDb('SenAI safe mode and the circuit breaker (plan 9)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('senaisafe', (system, user) =>
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

  const cvs = [{ name: 'Zed One', lines: ['Strong Excel modelling for finance teams.'] }];
  const LONG = 'please could you show me all the people who know excel in this role';
  const ask = async (a: any, message: string) =>
    (await a.api.post('/assistant/ask', { message })).json();

  it('keeps answering from fixed rules, says so, and stops calling a provider that keeps failing', async () => {
    const a = await h.recruiter('safe1@azerconnect.test');
    await h.scenario(a.api, cvs, 'Safe Role');
    const gw = h.app.get(AiGateway);
    const good = gw.fetcher;
    const saved = { ...BREAKER };
    BREAKER.threshold = 2;
    let providerCalls = 0;
    gw.fetcher = (async () => {
      providerCalls += 1;
      return new Response('{}', { status: 500 });
    }) as typeof fetch;
    try {
      const first = await ask(a, LONG);
      // The rules still find the skill; the person is told the AI reader was not used.
      expect(first.answer.skills).toEqual(['Excel']);
      expect(first.answer.flags).toContain('safe_mode');
      expect(first.answer.notes.join(' ')).toContain('fixed rules only');
      await ask(a, LONG.replace('show me', 'list'));
      expect(gw.breakerState().open).toBe(true);

      // Paused: no further provider calls, same honest note.
      const before = providerCalls;
      const paused = await ask(a, LONG.replace('people', 'candidates'));
      expect(providerCalls).toBe(before);
      expect(paused.answer.flags).toContain('safe_mode');
      expect(paused.answer.skills).toEqual(['Excel']);
    } finally {
      gw.fetcher = good;
      Object.assign(BREAKER, saved);
    }
    // "Test connection" always goes through, and a good result closes the breaker.
    expect(gw.breakerState().open).toBe(true);
    expect((await h.admin.post('/admin/assistant/test', {})).json().ok).toBe(true);
    expect(gw.breakerState().open).toBe(false);
    const mon = (await h.admin.get('/admin/assistant/monitoring?days=7')).json();
    expect(mon.total).toBeGreaterThanOrEqual(3);
    expect(mon.safeMode).toBeGreaterThanOrEqual(3);
    expect(mon.breaker.open).toBe(false);
    expect((await a.api.get('/admin/assistant/monitoring')).statusCode).toBe(403);
    const again = await ask(a, LONG.replace('people', 'applicants'));
    expect(again.answer.flags ?? []).not.toContain('safe_mode');
  });

  it('shows, changes and clears what SenAI keeps about the person (plan F6)', async () => {
    const a = await h.recruiter('prefs1@azerconnect.test');
    expect((await a.api.get('/assistant/preferences')).json()).toEqual({ top: null });
    expect((await a.api.put('/assistant/preferences', { top: 7 })).json()).toEqual({ top: 7 });
    expect((await a.api.get('/assistant/preferences')).json()).toEqual({ top: 7 });
    expect((await a.api.put('/assistant/preferences', { top: 0 })).statusCode).toBe(400);
    expect((await a.api.put('/assistant/preferences', { top: null })).json()).toEqual({
      top: null,
    });
    expect((await a.api.get('/assistant/preferences')).json()).toEqual({ top: null });
  });

  it('can use a separate reader model, falling back to the answer model if it fails', async () => {
    const cur = (await h.admin.get('/admin/assistant')).json();
    const model = cur.settings.modelRowId ?? cur.activeModel.modelRowId;
    const base = {
      enabled: true,
      name: 'SenAI',
      modelRowId: cur.settings.modelRowId,
      features: cur.settings.features,
      unavailableMessage: cur.settings.unavailableMessage,
      regionAllowed: 'EU only',
      dataTerms: 'no_retention',
      dailyCap: null,
      monthlyCap: null,
      warnPct: 80,
      attest: true,
    };
    const bad = await h.admin.put('/admin/assistant', {
      ...base,
      understandModelRowId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });
    expect(bad.statusCode).toBe(400);
    const ok = await h.admin.put('/admin/assistant', { ...base, understandModelRowId: model });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.understandModelRowId).toBe(model);
    const a = await h.recruiter('reader1@azerconnect.test');
    await h.scenario(a.api, cvs, 'Reader Role');
    const res = await ask(a, LONG);
    expect(res.answer.skills).toEqual(['Excel']);
    const cleared = await h.admin.put('/admin/assistant', { ...base, understandModelRowId: null });
    expect(cleared.json().settings.understandModelRowId).toBeNull();
  });
});
