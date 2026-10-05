import { COMPANIES, COMPANY_IDS, isCompany, publicCatalog, validateSettings } from './catalog';
import { ADAPTERS, ProviderError, listModels, type FetchLike, type Target } from './providers';

interface Seen {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fake fetch that records the request and answers with `reply`. */
function fake(reply: unknown): { f: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({
      url: String(url),
      method: init.method,
      headers: init.headers as Record<string, string>,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as FetchLike;
  return { f, seen };
}

const target = (company: Target['company'], model: string, settings = {}): Target => ({
  company,
  model,
  key: 'test-key-123456',
  settings,
});
const ask = { system: 's', user: 'u', maxTokens: 100 };
const chatReply = { choices: [{ message: { content: 'ok' } }] };

describe('company catalogue', () => {
  it('offers exactly the six supported companies', () => {
    expect([...COMPANY_IDS]).toEqual(['google', 'openai', 'anthropic', 'zai', 'sakana', 'nvidia']);
    expect(isCompany('qwen')).toBe(false);
    expect(isCompany('mistral')).toBe(false);
  });

  it('shows the browser names, options and models, never an address', () => {
    const json = JSON.stringify(publicCatalog());
    expect(json).not.toMatch(/https?:|\/v\d|\bapi\.|integrate\.|googleapis/i);
    expect(publicCatalog().map((c) => c.name)).toEqual([
      'Google',
      'OpenAI',
      'Anthropic',
      'Z.ai',
      'Sakana Fugu',
      'NVIDIA',
    ]);
    for (const c of publicCatalog()) expect(c.knownModels.length).toBeGreaterThan(0);
  });

  it('validates each company’s own options and nothing else', () => {
    expect(validateSettings('openai', { dataRegion: 'eu' })).toEqual({ dataRegion: 'eu' });
    expect(validateSettings('openai', { dataRegion: '' })).toEqual({});
    expect(validateSettings('openai', undefined)).toEqual({});
    expect(() => validateSettings('openai', { dataRegion: 'mars' })).toThrow(/unsupported/);
    expect(() => validateSettings('openai', { baseUrl: 'https://evil.example' })).toThrow(
      /Unknown setting/,
    );
    for (const c of ['google', 'anthropic', 'zai', 'sakana', 'nvidia'] as const) {
      expect(validateSettings(c, {})).toEqual({});
      expect(() => validateSettings(c, { dataRegion: 'eu' })).toThrow(/Unknown setting/);
    }
  });

  it('keeps every endpoint on the company’s own https host', () => {
    expect(COMPANIES.openai.baseUrl({})).toBe('https://api.openai.com/v1');
    expect(COMPANIES.openai.baseUrl({ dataRegion: 'eu' })).toBe('https://eu.api.openai.com/v1');
    for (const id of COMPANY_IDS) expect(COMPANIES[id].baseUrl({})).toMatch(/^https:\/\/[a-z.]+\//);
  });
});

describe('requests sent to each company', () => {
  it('Google: model in the path, key in a header, thinking headroom', async () => {
    const { f, seen } = fake({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    expect(await ADAPTERS.gemini(f, target('google', 'gemini-3.8-flash'), ask)).toBe('ok');
    expect(seen[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(seen[0]!.headers['x-goog-api-key']).toBe('test-key-123456');
    expect(seen[0]!.url).not.toContain('test-key');
    expect((seen[0]!.body.generationConfig as { maxOutputTokens: number }).maxOutputTokens).toBe(
      400,
    );
  });

  it('OpenAI: newer reasoning models get a completion budget and no temperature; EU region changes the host', async () => {
    const { f, seen } = fake(chatReply);
    await ADAPTERS.openai(f, target('openai', 'gpt-6-astra', { dataRegion: 'eu' }), ask);
    expect(seen[0]!.url).toBe('https://eu.api.openai.com/v1/chat/completions');
    expect(seen[0]!.body).not.toHaveProperty('temperature');
    expect(seen[0]!.body.max_completion_tokens).toBe(400);
    await ADAPTERS.openai(f, target('openai', 'gpt-4.1'), ask);
    expect(seen[1]!.body.temperature).toBe(0);
    expect(seen[1]!.body.max_completion_tokens).toBe(100);
  });

  it('Anthropic: messages endpoint with its own headers', async () => {
    const { f, seen } = fake({ content: [{ type: 'text', text: 'ok' }] });
    await ADAPTERS.anthropic(f, target('anthropic', 'claude-sonnet-5-5'), ask);
    expect(seen[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0]!.headers['x-api-key']).toBe('test-key-123456');
    expect(seen[0]!.body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 100 });
  });

  it('Z.ai: GLM-5.3 always thinks, so it is sent thinking enabled with low effort and extra headroom', async () => {
    const { f, seen } = fake(chatReply);
    await ADAPTERS.chat(f, target('zai', 'glm-5.3'), ask);
    expect(seen[0]!.url).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    expect(seen[0]!.body).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
      max_tokens: 400,
    });
    await ADAPTERS.chat(f, target('zai', 'glm-5.2'), ask);
    expect(seen[1]!.body).not.toHaveProperty('thinking');
  });

  it('Sakana Fugu: no temperature (ignored by Fugu), long timeout configured', async () => {
    const { f, seen } = fake(chatReply);
    await ADAPTERS.chat(f, target('sakana', 'fugu-ultra'), ask);
    expect(seen[0]!.url).toBe('https://api.sakana.ai/v1/chat/completions');
    expect(seen[0]!.body).not.toHaveProperty('temperature');
    expect(COMPANIES.sakana.timeoutMs).toBeGreaterThanOrEqual(300_000);
  });

  it('NVIDIA: model ids keep their publisher prefix', async () => {
    const { f, seen } = fake(chatReply);
    await ADAPTERS.chat(f, target('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b'), ask);
    expect(seen[0]!.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(seen[0]!.body.model).toBe('nvidia/nemotron-3-ultra-550b-a55b');
    expect(seen[0]!.body.temperature).toBe(0);
  });
});

describe('live model lists keep only the company’s own text models', () => {
  const t = (company: Target['company']) => ({ company, key: 'test-key-123456', settings: {} });

  it('NVIDIA: hides other vendors’ models but keeps its instruct models', async () => {
    const { f, seen } = fake({
      data: [
        { id: 'meta/llama-3.1-70b-instruct' },
        { id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
        { id: 'nvidia/nv-embedqa-e5-v5' },
        { id: 'nvidia/nemotron-3-ultra-550b-a55b' },
      ],
    });
    expect((await listModels(f, t('nvidia'))).map((m) => m.id)).toEqual([
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'nvidia/nemotron-3-ultra-550b-a55b',
    ]);
    expect(seen[0]!.url).toBe('https://integrate.api.nvidia.com/v1/models');
  });

  it('Z.ai and Sakana: only GLM / Fugu and Namazu models', async () => {
    const z = fake({ data: [{ id: 'glm-5.3' }, { id: 'glm-image' }, { id: 'cogvideox-3' }] });
    expect((await listModels(z.f, t('zai'))).map((m) => m.id)).toEqual(['glm-5.3']);
    const s = fake({ data: [{ id: 'fugu' }, { id: 'sakana-namazu' }, { id: 'other' }] });
    expect((await listModels(s.f, t('sakana'))).map((m) => m.id)).toEqual([
      'fugu',
      'sakana-namazu',
    ]);
  });

  it('OpenAI: text models only', async () => {
    const { f } = fake({
      data: [{ id: 'gpt-6-astra' }, { id: 'gpt-realtime-2' }, { id: 'text-embedding-3-large' }],
    });
    expect((await listModels(f, t('openai'))).map((m) => m.id)).toEqual(['gpt-6-astra']);
  });
});

describe('provider error reasons', () => {
  const failing = (status: number, body: unknown): FetchLike =>
    (async () => new Response(JSON.stringify(body), { status })) as FetchLike;
  const req = { system: 's', user: 'u', maxTokens: 16 };

  it('keeps the message body-free but carries the provider’s short reason on 4xx', async () => {
    const f = failing(400, {
      error: {
        code: 400,
        message: 'API key not valid.\nPlease pass a valid API key.',
        status: 'INVALID_ARGUMENT',
      },
    });
    const e = await ADAPTERS.gemini(f, target('google', 'gemini-3.8-flash'), req).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ProviderError);
    expect((e as ProviderError).message).toBe('provider responded 400');
    expect((e as ProviderError).detail).toBe('API key not valid. Please pass a valid API key.');
  });

  it('caps the reason and ignores bodies it cannot read, and 5xx carry none', async () => {
    const long = await ADAPTERS.openai(
      failing(401, { error: { message: 'x'.repeat(900) } }),
      target('openai', 'gpt-6-astra'),
      req,
    ).catch((x: unknown) => x);
    expect((long as ProviderError).detail).toHaveLength(200);
    const plain = (async () => new Response('<html>nope</html>', { status: 403 })) as FetchLike;
    const bad = await ADAPTERS.anthropic(
      plain,
      target('anthropic', 'claude-sonnet-5-5'),
      req,
    ).catch((x: unknown) => x);
    expect((bad as ProviderError).detail).toBeUndefined();
    const down = await ADAPTERS.openai(
      failing(503, { error: { message: 'busy' } }),
      target('openai', 'gpt-6-astra'),
      req,
    ).catch((x: unknown) => x);
    expect((down as ProviderError).detail).toBeUndefined();
  });
});
