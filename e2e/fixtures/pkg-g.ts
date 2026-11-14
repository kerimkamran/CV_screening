import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { DID, DID2, MID, MID2, VID } from './api';

/**
 * Helpers for UAT package G (SenAI pool panel SA, candidate panel SC, SenAI admin SX).
 * Every person, vacancy and answer here is invented. No provider key is used anywhere: the L2
 * server answers with the fake AI (e2e/fullstack/fake-ai.mjs).
 */

// ---------------------------------------------------------------- L2: SenAI settings

const L2 = `http://127.0.0.1:${process.env.UAT_PORT ?? 4320}`;
const ROOT = new URL('../..', import.meta.url).pathname;
/** The SenAI settings package G found on the shared L2 server (written before the first run). */
export const ORIGINAL_FILE = join(ROOT, 'e2e/test-results/uat/pkg-g-senai-original.json');

async function adminToken(): Promise<string> {
  const acc = JSON.parse(readFileSync(join(ROOT, 'e2e/test-results/uat/accounts.json'), 'utf8'));
  const r = await fetch(`${L2}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: acc.admin.email, password: acc.admin.password }),
  });
  return ((await r.json()) as { token: string }).token;
}
async function call(method: string, path: string, body?: unknown) {
  const t = await adminToken();
  const r = await fetch(`${L2}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${t}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, body: json };
}

export interface SenaiSettings {
  enabled: boolean;
  name: string;
  modelRowId: string | null;
  understandModelRowId: string | null;
  features: Record<string, boolean>;
  unavailableMessage: string;
  regionAllowed: string;
  dataTerms: string;
  dailyCap: number | null;
  monthlyCap: number | null;
  warnPct: number;
}
const KEYS: (keyof SenaiSettings)[] = [
  'enabled',
  'name',
  'modelRowId',
  'understandModelRowId',
  'features',
  'unavailableMessage',
  'regionAllowed',
  'dataTerms',
  'dailyCap',
  'monthlyCap',
  'warnPct',
];
const pick = (s: Record<string, unknown>) =>
  Object.fromEntries(KEYS.map((k) => [k, s[k]])) as unknown as SenaiSettings;

export async function senaiSettings(): Promise<SenaiSettings> {
  return pick((await call('GET', '/admin/assistant')).body.settings);
}

/** Change SenAI settings through the admin API (the rest stays as it is). */
export async function senaiPut(change: Partial<SenaiSettings> & { attest?: boolean }) {
  const now = await senaiSettings();
  const next = { ...now, ...change, features: { ...now.features, ...(change.features ?? {}) } };
  return call('PUT', '/admin/assistant', next);
}

/**
 * SenAI on, with the fake AI as the model, the test passed and the data terms recorded: the
 * precondition "SenAI on with the fake AI as model and Test passed" of every SA/SC/SX row.
 * The default feature set is the plan's (rediscovery and link review off).
 */
export async function senaiOn(change: Partial<SenaiSettings> = {}) {
  const now = await senaiSettings();
  const test = await call('POST', '/admin/assistant/test', { modelRowId: null });
  if (!test.body?.ok) throw new Error(`SenAI test failed: ${JSON.stringify(test.body)}`);
  const base: Partial<SenaiSettings> & { attest?: boolean } = {
    enabled: true,
    name: 'SenAI',
    dataTerms: 'no_retention',
    regionAllowed: now.regionAllowed || 'West Europe',
    dailyCap: null,
    monthlyCap: null,
    warnPct: 80,
    features: {
      challenge: true,
      compare: true,
      interview: true,
      challengeRecruiter: true,
      understand: true,
      rediscovery: false,
      linkReview: false,
    },
    attest: true,
    ...change,
  };
  const r = await senaiPut(base);
  if (r.status >= 300) throw new Error(`SenAI on: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Put every SenAI setting back exactly as package G found it (the file written before the first run). */
export async function senaiRestore() {
  const o = JSON.parse(readFileSync(ORIGINAL_FILE, 'utf8')) as SenaiSettings &
    Record<string, unknown>;
  const r = await call('PUT', '/admin/assistant', { ...pick(o), attest: false });
  if (r.status >= 300) throw new Error(`restore: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.settings;
}

// ---------------------------------------------------------------- L1: SenAI mocks

/** The plan's L1 config: challenge, compare, interview, challengeRecruiter and understand on, rediscovery and linkReview off. */
export const CFG = {
  enabled: true,
  name: 'SenAI',
  unavailableMessage: '',
  features: {
    challenge: true,
    compare: true,
    interview: true,
    challengeRecruiter: true,
    understand: true,
    rediscovery: false,
    linkReview: false,
  },
};

const poolRow = (
  documentId: string,
  matchId: string,
  label: string,
  score: number,
  band: string,
) => ({
  matchId,
  documentId,
  label,
  score,
  band,
  mustFound: 3,
  mustTotal: 4,
  decision: 'new',
  decisionLabel: 'New',
  outOfDate: false,
  strengths: ['BGP routing'],
  missing: ['CCIE certification'],
});

/** A pool answer (the server's shape) with Aysel Məmmədova 88 Strong and Rauf Əliyev 71 Good. */
export function poolAnswer(over: Record<string, unknown> = {}) {
  return {
    kind: 'pool',
    headline: 'Found 2 for Network Engineer: 1 Strong, 1 Good, 0 Partial, 0 Limited.',
    notes: [],
    vacancy: { id: VID, title: 'Network Engineer', status: 'open' },
    options: [],
    counts: { total: 2, analyzed: 2, shortlist: 0, outOfDate: 0 },
    rows: [
      poolRow(DID, MID, 'Aysel Məmmədova', 88, 'strong'),
      poolRow(DID2, MID2, 'Rauf Əliyev', 71, 'good'),
    ],
    used: [{ kind: 'vacancy', text: 'Network Engineer' }],
    more: 0,
    asOf: new Date().toISOString(),
    suggestions: [],
    flags: [],
    language: 'en',
    receipt: {
      read: 'find candidates',
      by: 'rules',
      sources: ['Stored results'],
      asOf: new Date().toISOString(),
    },
    ...over,
  };
}

export interface AskLog {
  asks: {
    message: string;
    vacancyId?: string;
    language?: string;
    pick?: string;
    showAll?: boolean;
    without?: unknown;
    conversationId?: string;
  }[];
  cand: { url: string; method: string; body: any }[];
}

/**
 * Answers the SenAI routes on top of mockApi (use as `extra`): /assistant/ask (pool), the
 * candidate thread /screenings/:id/assistant, conversations, preferences and the vacancy page.
 */
export function senaiRoutes(
  log: AskLog,
  opts: {
    ask?: (body: any, n: number) => unknown | Promise<unknown>;
    askStatus?: number;
    askDelayMs?: number;
    thread?: Record<string, unknown[]>;
    cand?: (body: any, sid: string) => unknown;
    candDelayMs?: number;
  } = {},
) {
  return async (route: Route, url: URL): Promise<boolean> => {
    const p = url.pathname;
    const req = route.request();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body }).then(() => true);
    let body: any = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    if (p === '/assistant/ask' && req.method() === 'POST') {
      log.asks.push(body);
      if (opts.askDelayMs) await new Promise((r) => setTimeout(r, opts.askDelayMs));
      if (opts.askStatus) return json({ message: 'stub error' }, opts.askStatus);
      const a = opts.ask ? await opts.ask(body, log.asks.length) : poolAnswer();
      return json({
        conversationId: '01K00000000000000000000CV1',
        messageId: `01K00000000000000000000M${log.asks.length}`,
        answer: a,
      });
    }
    if (p === '/assistant/conversations') return json([]);
    if (p === '/assistant/preferences') return json({ top: null });
    const sc = /^\/screenings\/(\w{26})\/assistant$/.exec(p);
    if (sc) {
      log.cand.push({ url: p, method: req.method(), body });
      if (req.method() === 'GET')
        return json({ thread: opts.thread?.[sc[1]!] ? { messages: opts.thread[sc[1]!] } : null });
      if (req.method() === 'DELETE') return json({ ok: true });
      if (opts.candDelayMs) await new Promise((r) => setTimeout(r, opts.candDelayMs));
      return json({
        messageId: `01K0000000000000000000AM${String(log.cand.length).padStart(2, '0')}`,
        answer: opts.cand ? opts.cand(body, sc[1]!) : candAnswer(),
      });
    }
    return false;
  };
}

/** senaiRoutes as `answers` of resultsApi (package D): every method, falls through when not SenAI. */
export function senaiAnswers(log: AskLog, opts: Parameters<typeof senaiRoutes>[1] = {}) {
  const r = senaiRoutes(log, opts);
  const f = async (route: Route, url: URL) => ((await r(route, url)) ? true : undefined);
  return { 'GET /*': f, 'POST /*': f, 'DELETE /*': f };
}

/** A candidate-panel answer (the server's verified shape). */
export function candAnswer(over: Record<string, unknown> = {}) {
  return {
    kind: 'answer',
    headline: 'Aysel Məmmədova matches on what the record shows.',
    claims: [
      {
        text: 'BGP route reflectors are in the CV.',
        state: 'found',
        source: 'R1',
        quote: 'BGP route reflectors',
      },
      { text: 'CCIE is not in this CV.', state: 'not_found', source: 'R4' },
    ],
    cantSee: "The CV doesn't mention everything; that is not evidence of a gap.",
    questions: [{ text: 'Tell me about a recent BGP project.', source: 'R1' }],
    outcome: null,
    handoff: [],
    facts: [],
    flags: [],
    about: [],
    ...over,
  };
}

/** A saved thread message pair (user then assistant). */
export const threadPair = (n: number, q = 'Why this band?') => [
  {
    id: `01K000000000000000000TU${String(n).padStart(3, '0')}`,
    role: 'user',
    content: { text: q, intent: 'ask' },
    createdAt: new Date().toISOString(),
  },
  {
    id: `01K000000000000000000TA${String(n).padStart(3, '0')}`,
    role: 'assistant',
    content: candAnswer(),
    createdAt: new Date().toISOString(),
  },
];

/** Open the pool panel through its stored state for this user (as after a person opened it before). */
export async function panelOpen(page: Page, userId: string) {
  await page.addInitScript((k) => {
    try {
      localStorage.setItem(k, '1');
    } catch {
      /* storage blocked */
    }
  }, `cv-assistant-open:${userId}`);
}
