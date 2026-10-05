/** Admin-managed AI companies and models: keys are encrypted at rest, never returned, and routed by the active selection. */
import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createAdapter } from '../app.factory';
import { AppModule } from '../app.module';
import { createDb, describeDb } from '../testing/pg-harness';
import { AiGateway } from './ai-gateway.service';

const ADMIN = 'admin@azerconnect.test';
const PW = 'Bootstrap-Passw0rd!';
const KEY = 'sk-test-1234567890abcdef';
const KEYS = {
  openai: KEY,
  anthropic: 'sk-ant-abcdefgh1234',
  google: 'AIza-abcdefgh1234',
  zai: 'zai-key-abcdefgh5678',
  sakana: 'sakana-key-abcdefgh9012',
  nvidia: 'nvapi-abcdefgh3456',
} as const;

describeDb('AI companies and models', () => {
  let db: Awaited<ReturnType<typeof createDb>>;
  let app: NestFastifyApplication;
  let token: string;
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];

  beforeAll(async () => {
    db = await createDb('ai');
    Object.assign(process.env, {
      DATABASE_URL: db.apiUrl,
      AUTH_MODE: 'local',
      SESSION_SECRET: 'y'.repeat(48),
      BOOTSTRAP_ADMIN_EMAIL: ADMIN,
      BOOTSTRAP_ADMIN_PASSWORD: PW,
      SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      LOG_LEVEL: 'silent',
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(createAdapter('silent'));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    app.get(AiGateway).fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      const u = String(url);
      const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (init.method === 'GET') {
        if (u.includes('anthropic'))
          return j({ data: [{ id: 'claude-x', display_name: 'Claude X' }] });
        if (u.includes('api.openai.com'))
          return j({
            data: [
              { id: 'gpt-6-astra' },
              { id: 'gpt-4.1' },
              { id: 'text-embedding-3-large' },
              { id: 'whisper-1' },
            ],
          });
        if (u.includes('api.z.ai')) return j({ data: [{ id: 'glm-5.3' }, { id: 'glm-image' }] });
        if (u.includes('nvidia'))
          return j({
            data: [{ id: 'meta/llama-3.1-70b-instruct' }, { id: 'nvidia/nemotron-x' }],
          });
        if (u.includes('sakana')) return j({}, 404); // no live list: documented models are shown
        return j({
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
          ],
        });
      }
      const req = JSON.parse(String(init.body)) as { model?: string; temperature?: number };
      if (req.model === 'picky-model' && req.temperature !== undefined) return j({}, 400);
      if (u.includes('anthropic')) return j({ content: [{ type: 'text', text: 'ok' }] });
      if (u.includes('generativelanguage'))
        return j({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
      return j({ choices: [{ message: { content: 'ok' } }] });
    }) as typeof fetch;

    const first = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: ADMIN, password: PW },
    });
    const changed = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${first.json().token}` },
      payload: { currentPassword: PW, newPassword: 'A-much-longer-secret-1' },
    });
    token = changed.json().token;
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });

  const get = async () => (await call('GET', '/admin/ai')).json();
  const ids: Record<string, string> = {};
  const names = (r: { connections: { name: string }[] }) => r.connections.map((c) => c.name);

  it('offers the six supported companies, with documented models and no addresses', async () => {
    const r = await call('GET', '/admin/ai/catalog');
    expect(r.statusCode).toBe(200);
    expect(r.json().companies.map((c: { id: string }) => c.id)).toEqual([
      'google',
      'openai',
      'anthropic',
      'zai',
      'sakana',
      'nvidia',
    ]);
    expect(r.body).not.toMatch(/https?:/);
  });

  it('starts with no companies and nothing active', async () => {
    const r = await get();
    expect(r.connections).toEqual([]);
    expect(r.active).toBeNull();
    await expect(app.get(AiGateway).complete({ system: 's', user: 'u' })).rejects.toThrow(
      /No AI model is active/,
    );
  });

  it('adds each company with one key; keys are encrypted and never returned', async () => {
    for (const company of Object.keys(KEYS) as (keyof typeof KEYS)[]) {
      const r = await call('POST', '/admin/ai/connections', {
        company,
        apiKey: KEYS[company],
        ...(company === 'openai' ? { settings: { dataRegion: 'global' } } : {}),
      });
      expect([company, r.statusCode]).toEqual([company, 201]);
      expect(r.body).not.toContain(KEYS[company]);
      ids[company] = r.json().id;
    }
    const list = await call('GET', '/admin/ai');
    for (const k of Object.values(KEYS)) expect(list.body).not.toContain(k);
    expect(names(list.json())).toEqual([
      'Anthropic',
      'Google',
      'NVIDIA',
      'OpenAI',
      'Sakana Fugu',
      'Z.ai',
    ]);
    const zai = list.json().connections.find((c: { company: string }) => c.company === 'zai');
    expect(zai).toMatchObject({ name: 'Z.ai', keyHint: '5678', settings: {} });
    const raw = await db.owner.query(`SELECT key_ciphertext FROM ai_connection`);
    for (const k of Object.values(KEYS)) expect(JSON.stringify(raw.rows)).not.toContain(k);
    const audit = await db.owner.query(
      `SELECT after::text AS a FROM audit_event WHERE action LIKE 'ai.%'`,
    );
    for (const k of Object.values(KEYS)) expect(JSON.stringify(audit.rows)).not.toContain(k);
  });

  it('refuses a company twice, unknown companies, and options the company does not have', async () => {
    const post = (payload: object) => call('POST', '/admin/ai/connections', payload);
    expect((await post({ company: 'openai', apiKey: 'sk-another-key-1' })).statusCode).toBe(409);
    for (const company of ['qwen', 'mistral', 'custom', '']) {
      expect([company, (await post({ company, apiKey: 'sk-another-key-1' })).statusCode]).toEqual([
        company,
        400,
      ]);
    }
    await call('DELETE', `/admin/ai/connections/${ids.nvidia}`);
    // No address can be supplied: not as an option, and a top-level one is simply ignored.
    expect(
      (
        await post({
          company: 'nvidia',
          apiKey: 'sk-another-key-1',
          settings: { baseUrl: 'https://evil.example/v1' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post({ company: 'openai', apiKey: 'x', settings: { dataRegion: 'eu' } })).statusCode,
    ).toBe(400); // key too short
    const re = await post({
      company: 'nvidia',
      apiKey: KEYS.nvidia,
      baseUrl: 'https://evil.example/v1',
      models: [{ modelId: 'nvidia/nemotron-x' }],
    });
    expect(re.statusCode).toBe(201);
    ids.nvidia = re.json().id;
    expect(re.json().added).toBe(1);
    await call('POST', `/admin/ai/models/${'0'.repeat(26)}/test`);
    expect(JSON.stringify(calls.map((c) => c.url))).not.toContain('evil.example');
  });

  it('lists a company’s models from its own API, before and after the key is stored', async () => {
    // Before saving: the key is used once and not stored.
    const before = await call('POST', '/admin/ai/discover', {
      company: 'openai',
      apiKey: 'sk-never-stored-9999',
    });
    expect(before.json()).toMatchObject({ live: true });
    expect(before.json().models.map((m: { id: string }) => m.id)).toEqual([
      'gpt-4.1',
      'gpt-6-astra',
    ]);
    expect(calls.at(-1)!.headers.authorization).toBe('Bearer sk-never-stored-9999');
    expect(before.body).not.toContain('never-stored');
    const stored = await db.owner.query(`SELECT count(*)::int AS n FROM ai_connection`);
    expect(stored.rows[0].n).toBe(6);

    // After saving: the stored key is used.
    const ids2 = (company: string, id: string | undefined) =>
      call('GET', `/admin/ai/connections/${id}/available-models`).then((r) => ({ company, r }));
    const o = (await ids2('openai', ids.openai)).r.json();
    expect(o.models.map((m: { id: string }) => m.id)).toEqual(['gpt-4.1', 'gpt-6-astra']);
    expect(calls.at(-1)!.headers.authorization).toBe(`Bearer ${KEY}`);
    const g = (await ids2('google', ids.google)).r.json();
    expect(g.models).toEqual([{ id: 'gemini-3.8-flash', label: 'gemini-3.8-flash' }]);
    expect(calls.at(-1)!.url).not.toContain('AIza'); // key travels in a header, not the URL
    expect((await ids2('anthropic', ids.anthropic)).r.json().models).toEqual([
      { id: 'claude-x', label: 'Claude X' },
    ]);
    expect((await ids2('zai', ids.zai)).r.json().models.map((m: { id: string }) => m.id)).toEqual([
      'glm-5.3',
    ]);
    expect(
      (await ids2('nvidia', ids.nvidia)).r.json().models.map((m: { id: string }) => m.id),
    ).toEqual(['nvidia/nemotron-x']); // other vendors' models are not offered
    expect(calls.at(-1)!.url).toBe('https://integrate.api.nvidia.com/v1/models');
  });

  it('falls back to the documented models when a company has no live list or refuses the key', async () => {
    const s = (await call('GET', `/admin/ai/connections/${ids.sakana}/available-models`)).json();
    expect(s.live).toBe(false);
    expect(s.models.map((m: { id: string }) => m.id)).toContain('fugu-ultra');
    expect(s.error).toMatch(/404/);

    const orig = app.get(AiGateway).fetcher;
    app.get(AiGateway).fetcher = (async () => new Response('no', { status: 401 })) as typeof fetch;
    const r = await call('GET', `/admin/ai/connections/${ids.openai}/available-models`);
    app.get(AiGateway).fetcher = orig;
    expect(r.statusCode).toBe(200);
    expect(r.json().live).toBe(false);
    expect(r.json().models.map((m: { id: string }) => m.id)).toContain('gpt-6-astra');
    expect(r.json().error).toMatch(/401/);
  });

  it('lets the admin add several models per company (picked or typed)', async () => {
    const add = (id: string, models: string[]) =>
      call('POST', `/admin/ai/connections/${id}/models`, {
        models: models.map((modelId) => ({ modelId })),
      });
    expect((await add(ids.openai!, ['gpt-6-astra', 'gpt-4.1', 'picky-model'])).json()).toEqual({
      added: 3,
    });
    expect((await add(ids.openai!, ['gpt-6-astra'])).json()).toEqual({ added: 0 }); // already there
    await add(ids.anthropic!, ['claude-x']);
    await add(ids.google!, ['gemini-3.8-flash']);
    await add(ids.zai!, ['glm-5.3']);
    await add(ids.sakana!, ['fugu-ultra']);
    const list = await get();
    const openai = list.connections.find((c: { name: string }) => c.name === 'OpenAI');
    expect(openai.models.map((x: { modelId: string }) => x.modelId)).toEqual([
      'gpt-4.1',
      'gpt-6-astra',
      'picky-model',
    ]);
    for (const c of list.connections)
      for (const mo of c.models) ids[`${c.name}/${mo.modelId}`] = mo.id;
  });

  it('activates any one model and routes calls to that company; switching changes the route', async () => {
    expect((await call('PUT', '/admin/ai/active', { modelId: '0'.repeat(26) })).statusCode).toBe(
      404,
    );
    const use = (key: string) => call('PUT', '/admin/ai/active', { modelId: ids[key] });
    const run = () => app.get(AiGateway).complete({ system: 's', user: 'u' });

    expect((await use('OpenAI/gpt-6-astra')).statusCode).toBe(200);
    expect(await run()).toMatchObject({ text: 'ok', provider: 'OpenAI', model: 'gpt-6-astra' });
    expect(calls.at(-1)!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls.at(-1)!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(calls.at(-1)!.body)).not.toHaveProperty('temperature');
    expect(JSON.parse(calls.at(-1)!.body)).toHaveProperty('max_completion_tokens');

    await use('OpenAI/gpt-4.1'); // same company, different model
    expect((await run()).model).toBe('gpt-4.1');
    expect(JSON.parse(calls.at(-1)!.body).temperature).toBe(0);

    await use('Z.ai/glm-5.3');
    expect(await run()).toMatchObject({ provider: 'Z.ai', model: 'glm-5.3' });
    expect(calls.at(-1)!.url).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    expect(calls.at(-1)!.headers.authorization).toBe(`Bearer ${KEYS.zai}`);
    expect(JSON.parse(calls.at(-1)!.body)).toMatchObject({ thinking: { type: 'enabled' } });

    await use('Sakana Fugu/fugu-ultra');
    expect(await run()).toMatchObject({ provider: 'Sakana Fugu', model: 'fugu-ultra' });
    expect(calls.at(-1)!.url).toBe('https://api.sakana.ai/v1/chat/completions');

    await use('NVIDIA/nvidia/nemotron-x');
    expect(await run()).toMatchObject({ provider: 'NVIDIA', model: 'nvidia/nemotron-x' });
    expect(calls.at(-1)!.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect((await get()).active).toMatchObject({ provider: 'NVIDIA' });

    await use('Google/gemini-3.8-flash');
    expect((await run()).provider).toBe('Google');
    expect(calls.at(-1)!.headers['x-goog-api-key']).toBe(KEYS.google);
    await use('Anthropic/claude-x');
    expect((await run()).provider).toBe('Anthropic');
    expect(calls.at(-1)!.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('tests a model without activating it, and retries once without temperature if it refuses it', async () => {
    const t = await call('POST', `/admin/ai/models/${ids['Google/gemini-3.8-flash']}/test`);
    expect(t.json()).toMatchObject({ ok: true });
    expect((await get()).active).toMatchObject({ provider: 'Anthropic' });

    const before = calls.length;
    const p = await call('POST', `/admin/ai/models/${ids['OpenAI/picky-model']}/test`);
    expect(p.json()).toMatchObject({ ok: true });
    expect(calls.length - before).toBe(2);
    expect(JSON.parse(calls.at(-1)!.body)).not.toHaveProperty('temperature');
  });

  it('changes a key or option, removes a model, and removing a company clears the active model', async () => {
    expect(
      (
        await call('PUT', `/admin/ai/connections/${ids.anthropic}`, {
          apiKey: 'sk-ant-newkey-9999',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await get()).connections.find((c: { name: string }) => c.name === 'Anthropic').keyHint,
    ).toBe('9999');
    await app.get(AiGateway).complete({ system: 's', user: 'u' });
    expect(calls.at(-1)!.headers['x-api-key']).toBe('sk-ant-newkey-9999');

    // An option changes the route; an invalid one or one the company lacks is refused.
    expect(
      (await call('PUT', `/admin/ai/connections/${ids.openai}`, { settings: { dataRegion: 'eu' } }))
        .statusCode,
    ).toBe(200);
    await call('POST', `/admin/ai/models/${ids['OpenAI/gpt-4.1']}/test`);
    expect(calls.at(-1)!.url).toBe('https://eu.api.openai.com/v1/chat/completions');
    expect(
      (await call('PUT', `/admin/ai/connections/${ids.openai}`, { settings: { dataRegion: 'x' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('PUT', `/admin/ai/connections/${ids.zai}`, { settings: { dataRegion: 'eu' } }))
        .statusCode,
    ).toBe(400);
    expect((await call('PUT', `/admin/ai/connections/${ids.zai}`, {})).statusCode).toBe(400);

    expect((await call('DELETE', `/admin/ai/models/${ids['OpenAI/picky-model']}`)).statusCode).toBe(
      200,
    );
    expect((await call('DELETE', `/admin/ai/models/${ids['OpenAI/picky-model']}`)).statusCode).toBe(
      404,
    );

    expect((await call('DELETE', `/admin/ai/connections/${ids.anthropic}`)).statusCode).toBe(200);
    const after = await get();
    expect(after.active).toBeNull();
    expect(names(after)).not.toContain('Anthropic');
    await expect(app.get(AiGateway).complete({ system: 's', user: 'u' })).rejects.toThrow(
      /No AI model is active/,
    );
  });

  it('is ADMIN-only', async () => {
    for (const [method, url] of [
      ['GET', '/admin/ai'],
      ['GET', '/admin/ai/catalog'],
      ['POST', '/admin/ai/connections'],
      ['POST', '/admin/ai/discover'],
    ] as const) {
      expect([url, (await app.inject({ method, url, payload: {} })).statusCode]).toEqual([
        url,
        401,
      ]);
    }
  });
});
