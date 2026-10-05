/**
 * The AI companies an administrator can choose from. Endpoints are fixed HERE, on the server:
 * the browser is only ever told names, options and model names (AISEC-01), and no
 * administrator-typed address is ever called.
 *
 * `knownModels` come from each company's own documentation and only seed the picker; the live
 * list ("Load all models") asks the company which models the stored key can actually use.
 */
export const COMPANY_IDS = ['google', 'openai', 'anthropic', 'zai', 'sakana', 'nvidia'] as const;
export type CompanyId = (typeof COMPANY_IDS)[number];

/** Wire protocol an adapter speaks. `chat` is the common OpenAI-style chat-completions shape. */
export type Protocol = 'anthropic' | 'openai' | 'gemini' | 'chat';

export interface ExtraField {
  key: string;
  label: string;
  hint?: string;
  required: boolean;
  options: { value: string; label: string }[];
}

export interface KnownModel {
  id: string;
  label: string;
  note?: string;
}

export interface CompanyDef {
  id: CompanyId;
  /** Name shown to administrators, and recorded on every assessment. */
  name: string;
  protocol: Protocol;
  baseUrl: (settings: Record<string, string>) => string;
  extraFields: ExtraField[];
  keyHelp: string;
  /** Where the data goes; shown to the administrator before they choose. */
  dataNote: string;
  /** Live model lists include other vendors' models on some platforms: keep only this company's. */
  ownModel: RegExp;
  knownModels: KnownModel[];
  /** Multiplier for the output budget: reasoning models spend tokens thinking before answering. */
  budgetFactor: number;
  timeoutMs: number;
  /** Whether to send `temperature` at all (Sakana ignores it). */
  sendTemperature: boolean;
  /** Extra request fields some models require. */
  requestExtras?: (model: string) => Record<string, unknown>;
}

export const COMPANIES: Record<CompanyId, CompanyDef> = {
  google: {
    id: 'google',
    name: 'Google',
    protocol: 'gemini',
    baseUrl: () => 'https://generativelanguage.googleapis.com/v1beta',
    extraFields: [],
    keyHelp: 'A Gemini API key from Google AI Studio.',
    dataNote:
      'Gemini Developer API (Google AI Studio keys): processing region is chosen by Google; there is no EU-only option on this key type.',
    ownModel: /^gemini/i,
    knownModels: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', note: 'preview' },
    ],
    budgetFactor: 4,
    timeoutMs: 120_000,
    sendTemperature: true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: (s) =>
      s.dataRegion === 'eu' ? 'https://eu.api.openai.com/v1' : 'https://api.openai.com/v1',
    extraFields: [
      {
        key: 'dataRegion',
        label: 'Data region',
        hint: 'Choose Europe only if the API key belongs to a project created with European data residency; otherwise calls are rejected.',
        required: false,
        options: [
          { value: 'global', label: 'Global (default)' },
          { value: 'eu', label: 'Europe (project with EU data residency)' },
        ],
      },
    ],
    keyHelp: 'A secret key from the OpenAI platform (project key recommended).',
    dataNote: 'Processed in the United States unless the project uses European data residency.',
    ownModel: /^(gpt-|o\d|chatgpt-)/i,
    knownModels: [
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    ],
    budgetFactor: 4,
    timeoutMs: 120_000,
    sendTemperature: true,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: () => 'https://api.anthropic.com/v1',
    extraFields: [],
    keyHelp: 'An API key from the Anthropic Console.',
    dataNote: 'Processed in the United States by default.',
    ownModel: /^claude/i,
    knownModels: [
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
    budgetFactor: 1,
    timeoutMs: 120_000,
    sendTemperature: true,
  },
  zai: {
    id: 'zai',
    name: 'Z.ai',
    protocol: 'chat',
    baseUrl: () => 'https://api.z.ai/api/paas/v4',
    extraFields: [],
    keyHelp:
      'A key for the general Z.ai API (not a "Coding Plan" key: those are limited to coding tools).',
    dataNote: 'International Z.ai platform (Zhipu AI); confirm where it processes data before use.',
    ownModel: /^glm/i,
    knownModels: [
      { id: 'glm-5.3', label: 'GLM-5.3' },
      { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash' },
      { id: 'glm-5.2', label: 'GLM-5.2' },
    ],
    budgetFactor: 4,
    timeoutMs: 180_000,
    sendTemperature: true,
    // GLM-5.3 always thinks: it requires thinking enabled and a reasoning effort; "low" keeps it quick.
    requestExtras: (m) =>
      /^glm-(5\.[3-9]|[6-9])/i.test(m)
        ? { thinking: { type: 'enabled' }, reasoning_effort: 'low' }
        : {},
  },
  sakana: {
    id: 'sakana',
    name: 'Sakana Fugu',
    protocol: 'chat',
    baseUrl: () => 'https://api.sakana.ai/v1',
    extraFields: [],
    keyHelp: 'An API key from the Sakana AI console.',
    dataNote:
      'Sakana AI (Japan). Fugu orchestrates several underlying models, so the data may be handled by more than one provider: confirm this with Sakana first.',
    ownModel: /^(fugu|sakana)/i,
    knownModels: [
      { id: 'fugu', label: 'Fugu (default)' },
      { id: 'fugu-ultra', label: 'Fugu Ultra' },
      { id: 'fugu-ultra-v1.1', label: 'Fugu Ultra v1.1' },
      { id: 'fugu-max', label: 'Fugu Max' },
      { id: 'fugu-cyber', label: 'Fugu Cyber', note: 'needs access approval' },
      { id: 'sakana-namazu', label: 'Sakana Namazu', note: 'Japanese-specialised' },
    ],
    budgetFactor: 1,
    timeoutMs: 300_000, // Fugu runs several agents per answer and can take minutes
    sendTemperature: false, // accepted but ignored by Fugu
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA',
    protocol: 'chat',
    baseUrl: () => 'https://integrate.api.nvidia.com/v1',
    extraFields: [],
    keyHelp: 'An API key (starts with nvapi-) from build.nvidia.com.',
    dataNote:
      'NVIDIA API catalog (United States). The free tier is for development and testing and is rate-limited: not suitable for production use.',
    ownModel: /^nvidia\//i,
    knownModels: [
      { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B' },
      { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', label: 'Nemotron 3.5 Lightning 30B' },
    ],
    budgetFactor: 4,
    timeoutMs: 180_000,
    sendTemperature: true,
  },
};

export function isCompany(v: string): v is CompanyId {
  return (COMPANY_IDS as readonly string[]).includes(v);
}

/** What the browser may see: no endpoints. */
export function publicCatalog() {
  return COMPANY_IDS.map((id) => {
    const c = COMPANIES[id];
    return {
      id: c.id,
      name: c.name,
      keyHelp: c.keyHelp,
      dataNote: c.dataNote,
      extraFields: c.extraFields,
      knownModels: c.knownModels,
    };
  });
}

/** Keeps only the options the company defines, each with an allowed value. */
export function validateSettings(
  company: CompanyId,
  raw: Record<string, unknown> | undefined,
): Record<string, string> {
  const def = COMPANIES[company];
  const input = raw ?? {};
  const out: Record<string, string> = {};
  for (const k of Object.keys(input)) {
    if (!def.extraFields.some((f) => f.key === k)) throw new Error(`Unknown setting "${k}"`);
  }
  for (const f of def.extraFields) {
    const v = input[f.key];
    if (v === undefined || v === '') {
      if (f.required) throw new Error(`${f.label} is required`);
      continue;
    }
    if (typeof v !== 'string' || !f.options.some((o) => o.value === v)) {
      throw new Error(`${f.label} has an unsupported value`);
    }
    out[f.key] = v;
  }
  return out;
}
