/**
 * Provider adapters over plain HTTPS (no vendor SDKs: smaller surface, nothing to leak into a bundle).
 *
 * An administrator adds "connections" (an AI company plus ONE api key). Three native protocols are
 * built in; `openai_compatible` covers any other company that speaks the OpenAI chat API
 * (Mistral, DeepSeek, Groq, xAI, Together, OpenRouter, Azure OpenAI v1 ...) via its base URL.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const PROVIDER_KINDS = ['anthropic', 'openai', 'gemini', 'openai_compatible'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

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
  /** Display name of the connection that served the call (e.g. "OpenAI", "Mistral"). */
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
  kind: ProviderKind;
  baseUrl: string | null;
  key: string;
  model: string;
}

// --- Outbound-address safety for administrator-supplied base URLs (SSRF) -------------------------

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^192\.0\.0\./,
  /^198\.(1[89])\./,
  /^2(2[4-9]|[3-5]\d)\./,
];

/** True when an address must never be contacted on an administrator's say-so. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 4) return PRIVATE_V4.some((r) => r.test(v));
  if (isIP(v) === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return (
      v === '::' ||
      v === '::1' ||
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      /^fe[89ab]/.test(v) ||
      v.startsWith('ff')
    );
  }
  return true; // not an address at all
}

/** Syntax-only checks (no network): https, a real hostname, no credentials, no internal names. */
export function validateBaseUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('Base URL is not a valid URL');
  }
  if (u.protocol !== 'https:') throw new Error('Base URL must start with https://');
  if (u.username || u.password) throw new Error('Base URL must not contain credentials');
  if (u.port && u.port !== '443') throw new Error('Base URL must use the standard HTTPS port');
  const host = u.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) {
    throw new Error('Base URL must use a hostname, not an IP address');
  }
  if (
    host === 'localhost' ||
    !host.includes('.') ||
    /\.(local|internal|localdomain|lan|home|corp)$/.test(host)
  ) {
    throw new Error('Base URL must be a public hostname');
  }
  u.hash = '';
  u.search = '';
  return u;
}

/** Resolves the host and refuses private, loopback and link-local addresses. */
export async function assertPublicHost(raw: string): Promise<void> {
  const u = validateBaseUrl(raw);
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error('Base URL resolves to a non-public address');
  }
}

/** Normalised base URL without a trailing slash. */
export function normaliseBaseUrl(raw: string): string {
  const u = validateBaseUrl(raw);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

// --- HTTP helpers ---------------------------------------------------------------------------------

async function send(
  fetcher: FetchLike,
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body?: unknown,
  timeoutMs = 90_000,
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
const OPENAI_REASONING = /^(o\d|gpt-5)/;

// --- Completion -----------------------------------------------------------------------------------

export const ADAPTERS: Record<
  ProviderKind,
  (f: FetchLike, t: Target, r: CompletionRequest) => Promise<string>
> = {
  async anthropic(f, t, r) {
    const out = (await send(
      f,
      'POST',
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': t.key, 'anthropic-version': '2023-06-01' },
      {
        model: t.model,
        max_tokens: r.maxTokens ?? 4096,
        ...(r.omitTemperature ? {} : { temperature: 0 }),
        system: r.system,
        messages: [{ role: 'user', content: r.user }],
      },
    )) as { content?: { type: string; text?: string }[] };
    return (out.content ?? []).map((b) => (b.type === 'text' ? str(b.text) : '')).join('');
  },

  async openai(f, t, r) {
    const reasoning = OPENAI_REASONING.test(t.model);
    const budget = (r.maxTokens ?? 4096) * (reasoning ? 4 : 1);
    const out = (await send(
      f,
      'POST',
      'https://api.openai.com/v1/chat/completions',
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
    )) as { choices?: { message?: { content?: string } }[] };
    return str(out.choices?.[0]?.message?.content);
  },

  async openai_compatible(f, t, r) {
    // Vendors differ on optional parameters, so only the universally supported ones are sent.
    // The prompts ask for JSON and every reply is validated by the caller.
    const out = (await send(
      f,
      'POST',
      `${t.baseUrl}/chat/completions`,
      { authorization: `Bearer ${t.key}` },
      {
        model: t.model,
        ...(r.omitTemperature ? {} : { temperature: 0 }),
        max_tokens: r.maxTokens ?? 4096,
        messages: [
          { role: 'system', content: r.system },
          { role: 'user', content: r.user },
        ],
      },
    )) as { choices?: { message?: { content?: string } }[] };
    return str(out.choices?.[0]?.message?.content);
  },

  async gemini(f, t, r) {
    const out = (await send(
      f,
      'POST',
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(t.model)}:generateContent`,
      { 'x-goog-api-key': t.key },
      {
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts: [{ text: r.user }] }],
        generationConfig: {
          ...(r.omitTemperature ? {} : { temperature: 0 }),
          maxOutputTokens: r.maxTokens ?? 4096,
          ...(r.json ? { responseMimeType: 'application/json' } : {}),
        },
      },
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
  /embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|search|babbage|davinci|instruct|rerank/i;

const get = (f: FetchLike, url: string, headers: Record<string, string>) =>
  send(f, 'GET', url, headers, undefined, 20_000) as Promise<Record<string, unknown>>;

/**
 * Asks the company which models this key may use, so the administrator picks from a real list
 * instead of typing a name. Only text-generation models are returned. Never cached.
 */
export const MODEL_LISTERS: Record<
  ProviderKind,
  (f: FetchLike, t: Omit<Target, 'model'>) => Promise<ModelInfo[]>
> = {
  async anthropic(f, t) {
    const out = (await get(f, 'https://api.anthropic.com/v1/models?limit=100', {
      'x-api-key': t.key,
      'anthropic-version': '2023-06-01',
    })) as { data?: { id?: string; display_name?: string }[] };
    return (out.data ?? [])
      .filter((m) => m.id)
      .map((m) => ({ id: str(m.id), label: str(m.display_name) || str(m.id) }));
  },
  async openai(f, t) {
    const out = (await get(f, 'https://api.openai.com/v1/models', {
      authorization: `Bearer ${t.key}`,
    })) as { data?: { id?: string }[] };
    return (out.data ?? [])
      .map((m) => str(m.id))
      .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !NOT_CHAT.test(id))
      .sort()
      .map((id) => ({ id, label: id }));
  },
  async openai_compatible(f, t) {
    const out = (await get(f, `${t.baseUrl}/models`, {
      authorization: `Bearer ${t.key}`,
    })) as { data?: { id?: string }[] };
    return (out.data ?? [])
      .map((m) => str(m.id))
      .filter((id) => id && !NOT_CHAT.test(id))
      .sort()
      .map((id) => ({ id, label: id }));
  },
  async gemini(f, t) {
    const out = (await get(
      f,
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { 'x-goog-api-key': t.key },
    )) as {
      models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    };
    return (out.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({ id: str(m.name).replace(/^models\//, ''), label: str(m.displayName) }))
      .filter((m) => m.id.startsWith('gemini') && !NOT_CHAT.test(m.id))
      .map((m) => ({ id: m.id, label: m.label || m.id }));
  },
};
