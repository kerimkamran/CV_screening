/**
 * Provider adapters over plain HTTPS (no vendor SDKs: smaller surface, nothing to leak into a bundle).
 * Four wire protocols cover the supported companies (see catalog.ts); every address comes from the
 * catalogue, never from user input.
 */
import { COMPANIES, type CompanyId } from './catalog';

export interface CompletionRequest {
  system: string;
  user: string;
  /** Ask the provider for a JSON object. Callers still validate the result. */
  json?: boolean;
  maxTokens?: number;
  /** Set by the gateway when a model rejected `temperature` (some newer models do). */
  omitTemperature?: boolean;
}

export interface CompletionResult {
  text: string;
  /** Display name of the company that served the call (e.g. "OpenAI", "Z.ai"). */
  provider: string;
  model: string;
}

export type FetchLike = typeof fetch;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface Target {
  company: CompanyId;
  key: string;
  settings: Record<string, string>;
  model: string;
}

// --- HTTP helpers ---------------------------------------------------------------------------------

async function send(
  fetcher: FetchLike,
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetcher(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error', // never follow a redirect with a key attached
  });
  if (!res.ok) {
    // Never include the response body: it can echo request content (CV text).
    throw new ProviderError(
      `provider responded ${res.status}`,
      res.status === 429 || res.status >= 500,
      res.status,
    );
  }
  return res.json();
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** OpenAI's reasoning models spend completion tokens thinking, and reject `temperature`. */
const OPENAI_REASONING = /^(o\d|gpt-[5-9])/;

const base = (t: Pick<Target, 'company' | 'settings'>) =>
  COMPANIES[t.company].baseUrl(t.settings).replace(/\/+$/, '');

// --- Completion -----------------------------------------------------------------------------------

export const ADAPTERS: Record<
  'anthropic' | 'openai' | 'gemini' | 'chat',
  (f: FetchLike, t: Target, r: CompletionRequest) => Promise<string>
> = {
  async anthropic(f, t, r) {
    const def = COMPANIES[t.company];
    const out = (await send(
      f,
      'POST',
      `${base(t)}/messages`,
      { 'x-api-key': t.key, 'anthropic-version': '2023-06-01' },
      {
        model: t.model,
        max_tokens: (r.maxTokens ?? 4096) * def.budgetFactor,
        ...(r.omitTemperature ? {} : { temperature: 0 }),
        system: r.system,
        messages: [{ role: 'user', content: r.user }],
      },
      def.timeoutMs,
    )) as { content?: { type: string; text?: string }[] };
    return (out.content ?? []).map((b) => (b.type === 'text' ? str(b.text) : '')).join('');
  },

  async openai(f, t, r) {
    const def = COMPANIES[t.company];
    const reasoning = OPENAI_REASONING.test(t.model);
    const budget = (r.maxTokens ?? 4096) * (reasoning ? def.budgetFactor : 1);
    const out = (await send(
      f,
      'POST',
      `${base(t)}/chat/completions`,
      { authorization: `Bearer ${t.key}` },
      {
        model: t.model,
        ...(reasoning || r.omitTemperature ? {} : { temperature: 0 }),
        max_completion_tokens: budget,
        ...(r.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: r.system },
          { role: 'user', content: r.user },
        ],
      },
      def.timeoutMs,
    )) as { choices?: { message?: { content?: string } }[] };
    return str(out.choices?.[0]?.message?.content);
  },

  /** OpenAI-style chat completions as served by Z.ai, Sakana and NVIDIA. */
  async chat(f, t, r) {
    // Vendors differ on optional parameters, so only the universally supported ones are sent.
    // The prompts ask for JSON and every reply is validated by the caller.
    const def = COMPANIES[t.company];
    const out = (await send(
      f,
      'POST',
      `${base(t)}/chat/completions`,
      { authorization: `Bearer ${t.key}` },
      {
        model: t.model,
        ...(def.sendTemperature && !r.omitTemperature ? { temperature: 0 } : {}),
        max_tokens: (r.maxTokens ?? 4096) * def.budgetFactor,
        ...(def.requestExtras?.(t.model) ?? {}),
        messages: [
          { role: 'system', content: r.system },
          { role: 'user', content: r.user },
        ],
      },
      def.timeoutMs,
    )) as { choices?: { message?: { content?: string } }[] };
    return str(out.choices?.[0]?.message?.content);
  },

  async gemini(f, t, r) {
    const def = COMPANIES[t.company];
    const out = (await send(
      f,
      'POST',
      `${base(t)}/models/${encodeURIComponent(t.model)}:generateContent`,
      { 'x-goog-api-key': t.key },
      {
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts: [{ text: r.user }] }],
        generationConfig: {
          ...(r.omitTemperature ? {} : { temperature: 0 }),
          maxOutputTokens: (r.maxTokens ?? 4096) * def.budgetFactor,
          ...(r.json ? { responseMimeType: 'application/json' } : {}),
        },
      },
      def.timeoutMs,
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (out.candidates?.[0]?.content?.parts ?? []).map((p) => str(p.text)).join('');
  },
};

// --- Model discovery ------------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  label: string;
}

const NOT_CHAT =
  /embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|search|babbage|davinci|gpt-3\.5-turbo-instruct|rerank|guard|safety|reward|parse|vision-?only/i;

const get = (f: FetchLike, url: string, headers: Record<string, string>) =>
  send(f, 'GET', url, headers, undefined, 20_000) as Promise<Record<string, unknown>>;

const idsOf = (out: Record<string, unknown>): string[] =>
  ((out.data as { id?: string }[] | undefined) ?? []).map((m) => str(m.id)).filter(Boolean);

/**
 * Asks the company which models this key may use, so the administrator picks from a real list
 * instead of typing a name. Only this company's own text-generation models are returned.
 * Never cached.
 */
export async function listModels(f: FetchLike, t: Omit<Target, 'model'>): Promise<ModelInfo[]> {
  const def = COMPANIES[t.company];
  const own = (id: string) => def.ownModel.test(id) && !NOT_CHAT.test(id);
  const bearer = { authorization: `Bearer ${t.key}` };

  if (def.protocol === 'anthropic') {
    const out = (await get(f, `${base(t)}/models?limit=100`, {
      'x-api-key': t.key,
      'anthropic-version': '2023-06-01',
    })) as { data?: { id?: string; display_name?: string }[] };
    return (out.data ?? [])
      .filter((m) => m.id && own(str(m.id)))
      .map((m) => ({ id: str(m.id), label: str(m.display_name) || str(m.id) }));
  }
  if (def.protocol === 'gemini') {
    const out = (await get(f, `${base(t)}/models?pageSize=200`, {
      'x-goog-api-key': t.key,
    })) as {
      models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    };
    return (out.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({ id: str(m.name).replace(/^models\//, ''), label: str(m.displayName) }))
      .filter((m) => own(m.id))
      .map((m) => ({ id: m.id, label: m.label || m.id }));
  }
  // openai and chat protocols share the GET /models shape.
  return idsOf(await get(f, `${base(t)}/models`, bearer))
    .filter(own)
    .sort()
    .map((id) => ({ id, label: id }));
}
