export type ApiHealth = { state: 'checking' } | { state: 'up' } | { state: 'down' };

/** In dev the Vite proxy mounts the API under /api; in production the API serves this app itself. */
export const BASE = import.meta.env.DEV ? '/api' : '';

/** Readiness of the API. The browser only ever calls our own API; never a model provider (AISEC-01). */
export async function fetchReadiness(fetchFn: typeof fetch = fetch): Promise<ApiHealth> {
  try {
    const res = await fetchFn(`${BASE}/readyz`);
    return res.ok ? { state: 'up' } : { state: 'down' };
  } catch {
    return { state: 'down' };
  }
}

// ---------------------------------------------------------------- session (tab-scoped, never persisted)

const KEY = 'cv.session';
let memory: string | null = null;

export const session = {
  get(): string | null {
    try {
      return sessionStorage.getItem(KEY) ?? memory;
    } catch {
      return memory;
    }
  },
  set(token: string | null) {
    memory = token;
    try {
      if (token) sessionStorage.setItem(KEY, token);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: memory only */
    }
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Listener = () => void;
const onUnauthorized: Listener[] = [];
export const subscribeUnauthorized = (fn: Listener) => {
  onUnauthorized.push(fn);
  return () => void onUnauthorized.splice(onUnauthorized.indexOf(fn), 1);
};

async function raw(method: string, path: string, body?: unknown, form?: FormData) {
  const token = session.get();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const j = (await res.json()) as { message?: string | string[]; code?: string };
      message = Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? message);
      code = j.code;
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401 && token) onUnauthorized.forEach((f) => f());
    throw new ApiError(res.status, message, code);
  }
  return res;
}

export const api = {
  get: async <T>(path: string): Promise<T> => (await raw('GET', path)).json() as Promise<T>,
  post: async <T>(path: string, body?: unknown): Promise<T> =>
    (await raw('POST', path, body ?? {})).json() as Promise<T>,
  put: async <T>(path: string, body: unknown): Promise<T> =>
    (await raw('PUT', path, body)).json() as Promise<T>,
  del: async <T>(path: string): Promise<T> => (await raw('DELETE', path)).json() as Promise<T>,
  upload: async <T>(path: string, files: File[]): Promise<T> => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return (await raw('POST', path, undefined, form)).json() as Promise<T>;
  },
  /** Authenticated download: the token travels in a header, never in a URL. */
  download: async (path: string, filename: string) => {
    const blob = await (await raw('GET', path)).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

// ---------------------------------------------------------------- types

export type Role = 'TA_PARTNER' | 'TA_LEAD' | 'GOVERNANCE' | 'ADMIN' | 'SERVICE';
export interface Me {
  userId: string;
  email: string | null;
  displayName: string | null;
  roles: Role[];
  mustChangePassword?: boolean;
  /** Chosen page background; null or absent means follow the device. */
  background?: 'white' | 'grey' | 'sky' | 'dark' | null;
}
export interface Session {
  token: string;
  expiresIn: number;
  mustChangePassword: boolean;
}
export type Classification = 'mandatory' | 'preferred' | 'informational' | 'disqualifier';
export type ReqStatus =
  'met' | 'partially_met' | 'not_met' | 'not_found' | 'ambiguous' | 'not_applicable';
export type Rule = { type: 'must_contain_any' | 'must_not_contain_any'; terms: string[] };
export interface Requirement {
  id?: string;
  text: string;
  classification: Classification;
  weight: number | null;
  rule: Rule | null;
  confidence?: string | null;
}
export interface Criteria {
  versions: { id: string; version: number; frozenAt: string | null }[];
  current: { id: string; version: number; frozen: boolean; requirements: Requirement[] } | null;
}
export interface Breakdown {
  formula: string;
  earned: number;
  possible: number;
  mandatoryGaps: number;
  items: {
    requirementId: string;
    text: string;
    classification: Classification;
    weight: number;
    status: ReqStatus;
    points: number;
    earned: number;
  }[];
}
export interface Decision {
  outcome: 'shortlist' | 'hold' | 'reject';
  reason: string;
  decidedAt: string;
  decidedBy: string;
}
export interface CandidateRow {
  screeningId: string | null;
  documentId: string;
  filename: string;
  uploadedAt: string;
  parseStatus: string;
  erased: boolean;
  /** `stopped`: waiting when the recruiter stopped the scan; "Continue" puts it back in the queue. */
  state: 'queued' | 'processing' | 'completed' | 'failed' | 'manual' | 'stopped';
  candidateName: string | null;
  band: 'strong_match' | 'possible_match' | 'weak_match' | 'needs_review' | null;
  score: { value: number; breakdown: Breakdown } | null;
  knockoutTriggered: boolean | null;
  injectionSuspected: boolean | null;
  error: string | null;
  decision: Decision | null;
}
export interface AdminUser {
  id: string;
  email: string | null;
  displayName: string | null;
  issuer: string;
  status: 'active' | 'disabled';
  roles: Role[];
  lastSeenAt: string;
  mustChangePassword: boolean;
}
export interface AiModel {
  id: string;
  connectionId: string;
  modelId: string;
  label: string;
  isActive: boolean;
}
export interface AiConnection {
  id: string;
  company: string;
  name: string;
  /** Non-secret options such as data region. */
  settings: Record<string, string>;
  keyHint: string;
  models: AiModel[];
}
export interface AiOverview {
  active: { modelRowId: string; provider: string; model: string } | null;
  connections: AiConnection[];
}
export interface AiExtraField {
  key: string;
  label: string;
  hint?: string;
  required: boolean;
  options: { value: string; label: string }[];
}
export interface AiCompany {
  id: string;
  name: string;
  keyHelp: string;
  dataNote: string;
  extraFields: AiExtraField[];
  knownModels: { id: string; label: string; note?: string }[];
}
export interface AiModelChoice {
  id: string;
  label: string;
  note?: string;
}
