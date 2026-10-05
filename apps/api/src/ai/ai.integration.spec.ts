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
const MISTRAL = 'https://api.mistral.example.com/v1';

describeDb('AI provider settings', () => {
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
    app.get(AiGateway).hostCheck = async () => undefined; // no DNS in tests
    app.get(AiGateway).fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      const u = String(url);
      const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (init.method === 'GET') {
        if (u.includes('anthropic'))
          return j({ data: [{ id: 'claude-x', display_name: 'Claude X' }] });
        if (u.includes('mistral'))
          return j({
            data: [{ id: 'mistral-large' }, { id: 'mistral-embed' }, { id: 'codestral' }],
          });
        if (u.includes('openai.com'))
          return j({
            data: [
              { id: 'gpt-5' },
              { id: 'gpt-4.1' },
              { id: 'text-embedding-3-large' },
              { id: 'whisper-1' },
            ],
          });
        return j({
          models: [
            { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
          ],
        });
      }
      const req = JSON.parse(String(init.body)) as { model?: string; temperature?: number };
      if (req.model === 'picky-model' && req.temperature !== undefined) return j({}, 400);
      if (u.includes('anthropic')) return j({ content: [{ type: 'text', text: 'ok' }] });
      if (u.includes('openai.com') || u.includes('mistral'))
        return j({ choices: [{ message: { content: 'ok' } }] });
      return j({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
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

  it('starts with no companies and nothing active', async () => {
    const r = await get();
    expect(r.connections).toEqual([]);
    expect(r.active).toBeNull();
    await expect(app.get(AiGateway).complete({ system: 's', user: 'u' })).rejects.toThrow(
      /No AI model is active/,
    );
  });

  it('adds companies freely, with one key each; keys are encrypted and never returned', async () => {
    const o = await call('POST', '/admin/ai/connections', {
      name: 'OpenAI',
      kind: 'openai',
      apiKey: KEY,
    });
    expect(o.statusCode).toBe(201);
    expect(o.body).not.toContain(KEY);
    ids.openai = o.json().id;
    const a = await call('POST', '/admin/ai/connections', {
      name: 'Anthropic',
      kind: 'anthropic',
      apiKey: 'sk-ant-abcdefgh1234',
    });
    ids.anthropic = a.json().id;
    const g = await call('POST', '/admin/ai/connections', {
      name: 'Google',
      kind: 'gemini',
      apiKey: 'AIza-abcdefgh1234',
    });
    ids.gemini = g.json().id;
    // A fourth company the platform has never heard of: anything OpenAI-compatible.
    const m = await call('POST', '/admin/ai/connections', {
      name: 'Mistral',
      kind: 'openai_compatible',
      baseUrl: `${MISTRAL}/`,
      apiKey: 'mistral-key-1234567',
    });
    expect(m.statusCode).toBe(201);
    ids.mistral = m.json().id;

    const list = await call('GET', '/admin/ai');
    expect(list.body).not.toContain(KEY);
    expect(list.body).not.toContain('abcdefgh1234');
    expect(list.json().connections.map((c: { name: string }) => c.name)).toEqual([
      'Anthropic',
      'Google',
      'Mistral',
      'OpenAI',
    ]);
    const mistral = list.json().connections.find((c: { name: string }) => c.name === 'Mistral');
    expect(mistral).toMatchObject({ kind: 'openai_compatible', baseUrl: MISTRAL, keyHint: '4567' });
    const raw = await db.owner.query(`SELECT key_ciphertext FROM ai_connection`);
    expect(JSON.stringify(raw.rows)).not.toContain(KEY);
    const audit = await db.owner.query(
      `SELECT after::text AS a FROM audit_event WHERE action LIKE 'ai.%'`,
    );
    expect(JSON.stringify(audit.rows)).not.toContain(KEY);
    expect(JSON.stringify(audit.rows)).not.toContain('abcdefgh1234');
  });

  it('rejects duplicates, a missing or misplaced base URL, and unsafe base URLs', async () => {
    const post = (payload: object) => call('POST', '/admin/ai/connections', payload);
    expect(
      (await post({ name: 'openai', kind: 'openai', apiKey: 'sk-another-key-1' })).statusCode,
    ).toBe(409);
    expect(
      (await post({ name: 'X', kind: 'openai_compatible', apiKey: 'sk-another-key-1' })).statusCode,
    ).toBe(400);
    expect(
      (await post({ name: 'Y', kind: 'openai', baseUrl: MISTRAL, apiKey: 'sk-another-key-1' }))
        .statusCode,
    ).toBe(400);
    for (const bad of [
      'http://api.example.com/v1',
      'https://localhost/v1',
      'https://127.0.0.1/v1',
      'https://10.0.0.5/v1',
      'https://metadata.internal/v1',
      'https://user:pw@api.example.com/v1',
      'https://api.example.com:8443/v1',
    ]) {
      const r = await post({
        name: 'Z',
        kind: 'openai_compatible',
        baseUrl: bad,
        apiKey: 'sk-another-key-1',
      });
      expect([bad, r.statusCode]).toEqual([bad, 400]);
    }
  });

  it('lists the models a key can use (text models only), and the admin picks several per company', async () => {
    const o = await call('GET', `/admin/ai/connections/${ids.openai}/available-models`);
    expect(o.json().models.map((m: { id: string }) => m.id)).toEqual(['gpt-4.1', 'gpt-5']);
    expect(calls.at(-1)!.headers.authorization).toBe(`Bearer ${KEY}`);
    const g = await call('GET', `/admin/ai/connections/${ids.gemini}/available-models`);
    expect(g.json().models).toEqual([{ id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }]);
    expect(calls.at(-1)!.url).not.toContain('AIza'); // key travels in a header, not the URL
    const a = await call('GET', `/admin/ai/connections/${ids.anthropic}/available-models`);
    expect(a.json().models).toEqual([{ id: 'claude-x', label: 'Claude X' }]);
    const m = await call('GET', `/admin/ai/connections/${ids.mistral}/available-models`);
    expect(m.json().models.map((x: { id: string }) => x.id)).toEqual([
      'codestral',
      'mistral-large',
    ]);
    expect(calls.at(-1)!.url).toBe(`${MISTRAL}/models`);

    const add = (id: string, models: string[]) =>
      call('POST', `/admin/ai/connections/${id}/models`, {
        models: models.map((modelId) => ({ modelId })),
      });
    expect((await add(ids.openai!, ['gpt-5', 'gpt-4.1', 'picky-model'])).json()).toEqual({
      added: 3,
    });
    expect((await add(ids.openai!, ['gpt-5'])).json()).toEqual({ added: 0 }); // already there
    await add(ids.anthropic!, ['claude-x']);
    await add(ids.gemini!, ['gemini-2.5-pro']);
    await add(ids.mistral!, ['mistral-large']);
    const list = await get();
    const openai = list.connections.find((c: { name: string }) => c.name === 'OpenAI');
    expect(openai.models.map((x: { modelId: string }) => x.modelId)).toEqual([
      'gpt-4.1',
      'gpt-5',
      'picky-model',
    ]);
    for (const c of list.connections)
      for (const mo of c.models) ids[`${c.name}/${mo.modelId}`] = mo.id;
  });

  it('answers with an empty list and a message when the company refuses', async () => {
    const orig = app.get(AiGateway).fetcher;
    app.get(AiGateway).fetcher = (async () => new Response('no', { status: 401 })) as typeof fetch;
    const r = await call('GET', `/admin/ai/connections/${ids.openai}/available-models`);
    app.get(AiGateway).fetcher = orig;
    expect(r.statusCode).toBe(200);
    expect(r.json().models).toEqual([]);
    expect(r.json().error).toMatch(/401/);
  });

  it('activates any one model and routes calls to it; switching changes the route', async () => {
    expect((await call('PUT', '/admin/ai/active', { modelId: '0'.repeat(26) })).statusCode).toBe(
      404,
    );
    expect(
      (await call('PUT', '/admin/ai/active', { modelId: ids['OpenAI/gpt-5'] })).statusCode,
    ).toBe(200);
    let r = await app.get(AiGateway).complete({ system: 's', user: 'u' });
    expect(r).toMatchObject({ text: 'ok', provider: 'OpenAI', model: 'gpt-5' });
    expect(calls.at(-1)!.url).toContain('api.openai.com');
    expect(calls.at(-1)!.headers.authorization).toBe(`Bearer ${KEY}`);
    // A reasoning model: no temperature, completion-token budget.
    expect(JSON.parse(calls.at(-1)!.body)).not.toHaveProperty('temperature');
    expect(JSON.parse(calls.at(-1)!.body)).toHaveProperty('max_completion_tokens');

    // Same company, different model.
    await call('PUT', '/admin/ai/active', { modelId: ids['OpenAI/gpt-4.1'] });
    r = await app.get(AiGateway).complete({ system: 's', user: 'u' });
    expect(r.model).toBe('gpt-4.1');
    expect(JSON.parse(calls.at(-1)!.body).temperature).toBe(0);

    // A different company entirely, through its own base URL.
    await call('PUT', '/admin/ai/active', { modelId: ids['Mistral/mistral-large'] });
    r = await app.get(AiGateway).complete({ system: 's', user: 'u' });
    expect(r).toMatchObject({ provider: 'Mistral', model: 'mistral-large' });
    expect(calls.at(-1)!.url).toBe(`${MISTRAL}/chat/completions`);
    expect((await get()).active).toMatchObject({ provider: 'Mistral', model: 'mistral-large' });

    await call('PUT', '/admin/ai/active', { modelId: ids['Anthropic/claude-x'] });
    expect((await app.get(AiGateway).complete({ system: 's', user: 'u' })).provider).toBe(
      'Anthropic',
    );
  });

  it('tests a model without activating it, and retries once without temperature if it refuses it', async () => {
    const t = await call('POST', `/admin/ai/models/${ids['Google/gemini-2.5-pro']}/test`);
    expect(t.json()).toMatchObject({ ok: true });
    expect(calls.at(-1)!.headers['x-goog-api-key']).toBe('AIza-abcdefgh1234');
    expect((await get()).active).toMatchObject({ provider: 'Anthropic' });

    const before = calls.length;
    const p = await call('POST', `/admin/ai/models/${ids['OpenAI/picky-model']}/test`);
    expect(p.json()).toMatchObject({ ok: true });
    expect(calls.length - before).toBe(2);
    expect(JSON.parse(calls.at(-1)!.body)).not.toHaveProperty('temperature');
  });

  it('refuses a private address even if DNS were to point there', async () => {
    const gw = app.get(AiGateway);
    const real = gw.hostCheck;
    gw.hostCheck = async () => {
      throw new Error('Base URL resolves to a non-public address');
    };
    const t = await call('POST', `/admin/ai/models/${ids['Mistral/mistral-large']}/test`);
    gw.hostCheck = real;
    expect(t.json().ok).toBe(false);
    expect(t.json().error).toMatch(/non-public/);
  });

  it('changes a key or name, removes a model, and removing a company clears the active model', async () => {
    const upd = await call('PUT', `/admin/ai/connections/${ids.anthropic}`, {
      apiKey: 'sk-ant-newkey-9999',
    });
    expect(upd.statusCode).toBe(200);
    expect(
      (await get()).connections.find((c: { name: string }) => c.name === 'Anthropic').keyHint,
    ).toBe('9999');
    await app.get(AiGateway).complete({ system: 's', user: 'u' });
    expect(calls.at(-1)!.headers['x-api-key']).toBe('sk-ant-newkey-9999');
    expect(
      (await call('PUT', `/admin/ai/connections/${ids.anthropic}`, { name: 'OpenAI' })).statusCode,
    ).toBe(409);

    expect((await call('DELETE', `/admin/ai/models/${ids['OpenAI/picky-model']}`)).statusCode).toBe(
      200,
    );
    expect((await call('DELETE', `/admin/ai/models/${ids['OpenAI/picky-model']}`)).statusCode).toBe(
      404,
    );

    expect((await call('DELETE', `/admin/ai/connections/${ids.anthropic}`)).statusCode).toBe(200);
    const after = await get();
    expect(after.active).toBeNull();
    expect(after.connections.map((c: { name: string }) => c.name)).not.toContain('Anthropic');
    await expect(app.get(AiGateway).complete({ system: 's', user: 'u' })).rejects.toThrow(
      /No AI model is active/,
    );
  });

  it('is ADMIN-only', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/ai' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/admin/ai/connections', payload: {} })).statusCode,
    ).toBe(401);
  });
});
