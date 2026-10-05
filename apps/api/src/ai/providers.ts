/** Provider adapters over plain HTTPS (no vendor SDKs: smaller surface, nothing to leak into a bundle). */

export const PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type ProviderKind = (typeof PROVIDERS)[number];

export interface CompletionRequest {
  system: string;
  user: string;
  /** Ask the provider for a JSON object. Callers still validate the result. */
  json?: boolean;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  provider: ProviderKind;
  model: string;
}

export type FetchLike = typeof fetch;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function post(
  fetcher: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const res = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    // Never include the response body: it can echo request content (CV text).
    throw new ProviderError(
      `provider responded ${res.status}`,
      res.status === 429 || res.status >= 500,
    );
  }
  return res.json();
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const ADAPTERS: Record<
  ProviderKind,
  (f: FetchLike, key: string, model: string, r: CompletionRequest) => Promise<string>
> = {
  async anthropic(f, key, model, r) {
    const out = (await post(
      f,
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      {
        model,
        max_tokens: r.maxTokens ?? 4096,
        temperature: 0,
        system: r.system,
        messages: [{ role: 'user', content: r.user }],
      },
    )) as { content?: { type: string; text?: string }[] };
    return (out.content ?? []).map((b) => (b.type === 'text' ? str(b.text) : '')).join('');
  },

  async openai(f, key, model, r) {
    const out = (await post(
      f,
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${key}` },
      {
        model,
        temperature: 0,
        max_tokens: r.maxTokens ?? 4096,
        ...(r.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: r.system },
          { role: 'user', content: r.user },
        ],
      },
    )) as { choices?: { message?: { content?: string } }[] };
    return str(out.choices?.[0]?.message?.content);
  },

  async gemini(f, key, model, r) {
    const out = (await post(
      f,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': key },
      {
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts: [{ text: r.user }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: r.maxTokens ?? 4096,
          ...(r.json ? { responseMimeType: 'application/json' } : {}),
        },
      },
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (out.candidates?.[0]?.content?.parts ?? []).map((p) => str(p.text)).join('');
  },
};
