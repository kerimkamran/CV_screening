/** Admin-managed AI providers: keys are encrypted at rest, never returned, and routed by the active selection. */
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
    app.get(AiGateway).fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      const u = String(url);
      const body = u.includes('anthropic')
        ? { content: [{ type: 'text', text: 'ok' }] }
        : u.includes('openai')
          ? { choices: [{ message: { content: 'ok' } }] }
          : { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
      return new Response(JSON.stringify(body), { status: 200 });
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

  it('starts with three providers, none active, no keys', async () => {
    const r = await call('GET', '/admin/ai');
    expect(r.json().map((p: { provider: string }) => p.provider)).toEqual([
      'anthropic',
      'openai',
      'gemini',
    ]);
    expect(
      r.json().every((p: { hasKey: boolean; isActive: boolean }) => !p.hasKey && !p.isActive),
    ).toBe(true);
    // Nothing to call yet.
    await expect(app.get(AiGateway).complete({ system: 's', user: 'u' })).rejects.toThrow(
      /No AI provider is active/,
    );
  });

  it('stores a key encrypted and never returns it', async () => {
    const put = await call('PUT', '/admin/ai/openai', { apiKey: KEY, model: 'gpt-4.1-mini' });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain(KEY);
    const list = await call('GET', '/admin/ai');
    expect(list.body).not.toContain(KEY);
    const row = list.json().find((p: { provider: string }) => p.provider === 'openai');
    expect(row).toMatchObject({ hasKey: true, keyHint: KEY.slice(-4), model: 'gpt-4.1-mini' });
    const raw = await db.owner.query(
      `SELECT key_ciphertext FROM ai_provider_config WHERE provider='openai'`,
    );
    expect(raw.rows[0].key_ciphertext).not.toContain(KEY);
    const audit = await db.owner.query(
      `SELECT after::text AS a FROM audit_event WHERE action='ai.configure'`,
    );
    expect(JSON.stringify(audit.rows)).not.toContain(KEY);
  });

  it('refuses to activate a provider without a key, then routes calls to the active one', async () => {
    expect((await call('PUT', '/admin/ai/active', { provider: 'gemini' })).statusCode).toBe(400);
    expect((await call('PUT', '/admin/ai/active', { provider: 'openai' })).statusCode).toBe(200);
    const r = await app.get(AiGateway).complete({ system: 's', user: 'u' });
    expect(r).toMatchObject({ text: 'ok', provider: 'openai', model: 'gpt-4.1-mini' });
    expect(calls.at(-1)!.url).toContain('api.openai.com');
    expect(calls.at(-1)!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it('lets the admin switch providers, and test each without making it active', async () => {
    await call('PUT', '/admin/ai/anthropic', { apiKey: 'sk-ant-abcdefgh1234' });
    await call('PUT', '/admin/ai/gemini', { apiKey: 'AIza-abcdefgh1234' });
    const t = await call('POST', '/admin/ai/gemini/test');
    expect(t.json()).toMatchObject({ ok: true });
    expect(calls.at(-1)!.headers['x-goog-api-key']).toBe('AIza-abcdefgh1234');
    expect(calls.at(-1)!.url).not.toContain('AIza'); // key travels in a header, not the URL
    await call('PUT', '/admin/ai/active', { provider: 'anthropic' });
    const r = await app.get(AiGateway).complete({ system: 's', user: 'u' });
    expect(r.provider).toBe('anthropic');
  });

  it('deactivates a provider whose key is removed', async () => {
    await call('DELETE', '/admin/ai/anthropic/key');
    const list = (await call('GET', '/admin/ai')).json();
    expect(list.some((p: { isActive: boolean }) => p.isActive)).toBe(false);
    await expect(app.get(AiGateway).complete({ system: 's', user: 'u' })).rejects.toThrow(
      /No AI provider is active/,
    );
  });

  it('is ADMIN-only', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/ai' });
    expect(r.statusCode).toBe(401);
  });
});
