import { createHmac } from 'node:crypto';
import { accounts, api, BASE, tempPasswordFor, type Account } from '../fullstack/stack';
import type { Page, Route } from '@playwright/test';
import { AZ } from '../../apps/web/src/i18n/az';
import { mockApi, ME, type Seen } from './api';
import type { Meta } from '../ux/test';

/**
 * Mocks and helpers for UAT package A (shell SH, sign-in AU, account menu AC, role matrix RO).
 * Every person and company here is invented.
 */

/** The app's own wording in the run's language (English key → Azerbaijani, as the app does). */
export function words(meta: Pick<Meta, 'lang'>) {
  return (en: string, vars?: Record<string, string | number>) => {
    const s = meta.lang === 'az' ? (AZ[en] ?? en) : en;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}

export const ROLE: Record<string, string[]> = {
  recruiter: ['TA_PARTNER'],
  lead: ['TA_LEAD'],
  admin: ['ADMIN'],
  adminTa: ['ADMIN', 'TA_PARTNER'],
  governance: ['GOVERNANCE'],
  viewer: [],
};

// ------------------------------------------------------------------ admin and monitoring answers

export const FAIRNESS = {
  generatedAt: '2026-11-03T08:00:00Z',
  totals: { files: 40, scored: 38, unread: 2 },
  dimensions: [
    {
      key: 'language',
      label: 'Language of the CV',
      groups: [
        {
          group: 'az',
          files: 15,
          scored: 15,
          meanScore: 64,
          favourableRate: 0.4,
          needsLookRate: 0.1,
          unreadRate: 0,
          impactRatio: 0.9,
          flag: 'ok',
        },
        {
          group: 'en',
          files: 14,
          scored: 13,
          meanScore: 66,
          favourableRate: 0.45,
          needsLookRate: 0.1,
          unreadRate: 0.07,
          impactRatio: 1,
          flag: 'ok',
        },
        {
          group: 'ru',
          files: 9,
          scored: 8,
          meanScore: 61,
          favourableRate: 0.35,
          needsLookRate: 0.1,
          unreadRate: 0.1,
          impactRatio: 0.78,
          flag: 'not_enough_data',
        },
      ],
      suppressed: 0,
    },
    { key: 'format', label: 'File format', groups: [], suppressed: 3 },
  ],
  method: {
    favourable: 'Strong or Good band (score 70 or more), not sent to a human look',
    rule: 'A group whose favourable rate is below 80% of the best group\'s, with at least 20 scored CVs, is marked "review". That is a prompt to look, not a finding.',
    privacy: 'No protected attribute is collected or inferred. Groups under 5 files are not shown.',
  },
};
export const EVAL = {
  runs: [
    {
      id: '01K0000000000000000000RUN1',
      state: 'done',
      startedAt: '2026-11-02T10:00:00Z',
      finishedAt: '2026-11-02T10:05:00Z',
      startedBy: 'Bootstrap admin',
      progress: 24,
      total: 24,
      error: null,
      provider: 'Anthropic',
      model: 'claude-fake-1',
      result: {
        summary: [
          {
            arm: 'masked',
            pairs: 12,
            differing: 0,
            meanAbsDelta: 0,
            maxAbsDelta: 0,
            worst: null,
            noise: 0,
            verdict: 'consistent',
          },
        ],
      },
    },
  ],
  design: {
    templates: [{ key: 'strong', title: 'Senior Network Engineer' }],
    variants: [
      { key: 'base', label: 'Base', change: 'none (English name)' },
      { key: 'az_f', label: 'Azerbaijani female name', change: 'name' },
      { key: 'break', label: 'Career break line', change: 'name plus a free-text career break' },
    ],
  },
};
export const ADMIN_USERS = [
  {
    id: '01K000000000000000000000AB',
    email: 'admin@example.az',
    displayName: 'Admin Person',
    issuer: 'cv-local',
    status: 'active',
    roles: ['ADMIN'],
    lastSeenAt: '2026-11-03T08:00:00Z',
    mustChangePassword: false,
    mfa: false,
  },
];
const AI = {
  active: {
    modelRowId: '01K0000000000000000000MOD1',
    provider: 'Anthropic',
    model: 'claude-fake-1',
  },
  connections: [
    {
      id: '01K0000000000000000000CON1',
      company: 'anthropic',
      name: 'Anthropic',
      settings: {},
      keyHint: 'fake',
      models: [
        {
          id: '01K0000000000000000000MOD1',
          connectionId: '01K0000000000000000000CON1',
          modelId: 'claude-fake-1',
          label: 'claude-fake-1',
          isActive: true,
        },
      ],
    },
  ],
};
const CATALOG = {
  companies: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      keyHelp: 'An API key.',
      dataNote: 'Invented note.',
      extraFields: [],
      knownModels: [{ id: 'claude-fake-1', label: 'claude-fake-1' }],
    },
  ],
};
const ASSISTANT_ADMIN = {
  settings: {
    enabled: true,
    name: 'SenAI',
    modelRowId: null,
    understandModelRowId: null,
    features: {
      challenge: true,
      compare: true,
      interview: true,
      challengeRecruiter: true,
      understand: true,
      rediscovery: true,
      linkReview: true,
    },
    unavailableMessage: '',
    regionAllowed: '',
    dataTerms: 'unknown',
    attestedBy: null,
    attestedAt: null,
    dailyCap: null,
    monthlyCap: null,
    warnPct: 80,
    testedModelKey: null,
    testedAt: null,
    attestedByName: null,
  },
  models: [
    {
      id: '01K0000000000000000000MOD1',
      modelId: 'claude-fake-1',
      label: 'claude-fake-1',
      provider: 'Anthropic',
    },
  ],
  activeModel: {
    modelRowId: '01K0000000000000000000MOD1',
    provider: 'Anthropic',
    model: 'claude-fake-1',
  },
  usage: { today: 0, month: 0 },
  warn: false,
  testFresh: false,
  log: [],
};
const RETENTION = {
  enabled: false,
  days: 180,
  due: 0,
  heldBack: 0,
  cutoff: '2026-05-07T00:00:00Z',
  certificates: [],
  vacancies: [
    {
      id: '01K000000000000000000000V',
      title: 'Network Engineer',
      legalHold: false,
      matter: null,
      since: null,
      by: null,
      documents: 2,
    },
  ],
};

/** Answers for every admin and monitoring page (Users, AI, Assistant, Monitoring, Retention). */
export const ADMIN_ANSWERS: Record<string, unknown> = {
  'GET /admin/users': ADMIN_USERS,
  'GET /admin/ai': AI,
  'GET /admin/ai/catalog': CATALOG,
  'GET /admin/assistant': ASSISTANT_ADMIN,
  'GET /admin/assistant/audit': { turns: [] },
  'GET /admin/assistant/payloads': { allowed: [], calls: [] },
  'GET /admin/assistant/skills': [],
  'GET /admin/retention': RETENTION,
  'GET /admin/fairness': FAIRNESS,
  'GET /admin/eval': EVAL,
};

// ------------------------------------------------------------------ reports, security, vacancies

export const REPORT_ID = '01K0000000000000000000REP1';
export const REPORT_ID2 = '01K0000000000000000000REP2';
export const SHARED_ROWS = [
  {
    id: REPORT_ID,
    title: 'Network Engineer report',
    sharedBy: 'Aysel Mammadova',
    sharedAt: '2026-10-30T09:00:00Z',
    expiresAt: '2026-11-30T09:00:00Z',
  },
  {
    id: REPORT_ID2,
    title: 'Network Engineer report',
    sharedBy: 'Aysel Mammadova',
    sharedAt: '2026-10-31T09:00:00Z',
    expiresAt: '2026-12-01T09:00:00Z',
  },
];
const cand = (n: number) => ({
  rank: n,
  label: `Candidate ${String(n).padStart(2, '0')}`,
  name: null,
  band: 'good',
  score: 75 - n,
  mustFound: 1,
  mustTotal: 2,
  chips: [
    { text: 'Routing', kind: 'found', classification: 'mandatory' },
    { text: 'Kubernetes', kind: 'missing', classification: 'mandatory' },
  ],
  expanded: true,
  summary: `Reason for ${n}.`,
  quotes: [{ requirement: 'Routing', quote: `Designed the BGP peering ${n}` }],
  missing: 'Kubernetes',
});
export const REPORT_OPENED = {
  id: REPORT_ID,
  sharedBy: 'Aysel Mammadova',
  sharedAt: '2026-10-30T09:00:00Z',
  expiresAt: '2026-11-30T09:00:00Z',
  report: {
    version: 1,
    runId: 'ABCD1234',
    title: 'Network Engineer',
    takenAt: '2026-10-30T09:00:00Z',
    createdBy: 'Aysel Mammadova',
    includeNames: false,
    includeQuotes: true,
    counts: { total: 3, read: 3, scored: 2, needLook: 1, stopped: 0, unread: 1 },
    role: { must: ['Routing', 'Kubernetes'], nice: ['Python'], ignored: [] },
    method: {
      criteriaVersion: 1,
      frozenAt: '2026-10-29T09:00:00Z',
      provider: 'anthropic',
      model: 'claude-fake-1',
    },
    bands: { strong: 0, good: 2, partial: 0, limited: 0, human: 1 },
    candidates: [cand(1), cand(2)],
    expandedCount: 15,
    unread: [{ label: 'Candidate 03', reason: 'Scan only: no readable text in the file' }],
    changes: [],
    decisions: [],
  },
};
export const MFA_OFF = { enabled: false, available: true, recoveryCodesLeft: 0 };

/** A row of the vacancy list (VacancyListItem). */
export const vacItem = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `01K00000000000000000VAC${String(i).padStart(3, '0')}`,
  title: `Network Engineer ${i}`,
  department: 'Core network',
  location: 'Bakı',
  status: 'open',
  archived: false,
  owner: { id: ME.userId, name: 'Ayla Karimova' },
  canEdit: true,
  documents: 4,
  analyzed: 4,
  outOfDate: 0,
  strong: 1,
  decisions: { shortlist: 1, maybe: 0, notNow: 0 },
  running: 0,
  stopped: 0,
  version: 1,
  updatedAt: '2026-11-02T09:00:00Z',
  createdAt: '2026-10-01T09:00:00Z',
  ...extra,
});

// ------------------------------------------------------------------ routing helpers

type Answer =
  | unknown
  | { $status: number; $body?: unknown; $delay?: number; $html?: string }
  | ((route: Route, url: URL) => Promise<boolean | void> | boolean | void);

/**
 * An `extra` handler for mockApi from a table: keys 'GET /path', 'POST /path' or '/path' (any
 * method); values are a JSON body (200), `{ $status, $body, $delay }`, or a function that answers.
 */
export function answers(table: Record<string, Answer>) {
  return async (route: Route, url: URL): Promise<boolean> => {
    const m = route.request().method();
    const a = table[`${m} ${url.pathname}`] ?? table[url.pathname];
    if (a === undefined) return false;
    if (typeof a === 'function') {
      const r = await (a as (route: Route, url: URL) => Promise<boolean | void>)(route, url);
      return r !== false;
    }
    if (a && typeof a === 'object' && '$status' in (a as object)) {
      const s = a as { $status: number; $body?: unknown; $delay?: number; $html?: string };
      if (s.$delay) await new Promise((r) => setTimeout(r, s.$delay));
      if (s.$html !== undefined)
        await route.fulfill({ status: s.$status, body: s.$html, contentType: 'text/html' });
      else await route.fulfill({ status: s.$status, json: s.$body ?? {} });
      return true;
    }
    await route.fulfill({ status: 200, json: a });
    return true;
  };
}

export const SENAI = {
  enabled: true,
  name: 'SenAI',
  unavailableMessage: '',
  features: {
    challenge: true,
    compare: true,
    interview: true,
    challengeRecruiter: true,
    understand: true,
    rediscovery: true,
    linkReview: true,
  },
};

let loads = 0;
/** A full page load of `hash` (a new query string, so it is not a same-document hash change). */
export const reloadAt = (page: Page, hash: string) => page.goto(`/?load=${++loads}${hash}`);

/**
 * Opens `hash` with a fresh mock (earlier routes removed) and a full page load, so /me, the SenAI
 * config and the health line are read again.
 */
export async function openWith(
  page: Page,
  hash: string,
  opts: Parameters<typeof mockApi>[1] & { table?: Record<string, Answer> } = {},
): Promise<Seen> {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const { table, ...rest } = opts;
  const t = table ? answers(table) : undefined;
  const seen = await mockApi(page, {
    ...rest,
    extra: async (route, url) => {
      if (t && (await t(route, url))) return true;
      if (rest.extra && (await rest.extra(route, url))) return true;
      return false;
    },
  });
  // A new query string forces a full page load (a hash change alone would not reload the app).
  await page.goto(`/?load=${++loads}${hash}`);
  return seen;
}

/** The bounding box of a locator, or null. */
export const box = async (page: Page, selector: string) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
    };
  }, selector);

/** True when the element's centre is hit by the element itself (nothing paints over it). */
export const hitsItself = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return false;
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (e === hit || e.contains(hit));
  }, selector);

// ------------------------------------------------------------------ a vacancy with a running upload batch (SH-10)

export const RUN_VID = '01K00000000000000000RUNVAC';
export const RUN_BATCH = '01K00000000000000000RUNBAT';
const now = () => new Date().toISOString();
const BYSTATUS0 = {
  not_sent: 0,
  sending: 0,
  waiting_to_send: 0,
  could_not_send: 0,
  rejected: 0,
  duplicate: 0,
  vacancy_full: 0,
  analyzing: 0,
  stopped: 0,
  failed: 0,
  unreadable: 0,
  needs_look: 0,
  analyzed: 0,
  not_analyzed: 0,
  erased: 0,
};
export const RUNNING_VACANCY: Record<string, Answer> = {
  [`GET /vacancies/${RUN_VID}`]: {
    id: RUN_VID,
    title: 'Network Engineer',
    status: 'open',
    archived: false,
    department: 'Network',
    location: 'Bakı',
    experienceRange: 'any',
    openings: null,
    closingDate: null,
    hiringManager: null,
    notes: null,
    description: 'Required: BGP routing',
    sourceType: 'typed',
    sourceFileName: null,
    link: null,
    requirementsVersion: 1,
    version: 3,
    owner: { id: ME.userId, name: 'Ayla Karimova' },
    canEdit: true,
    candidateNoticeConfirmedAt: '2026-11-01T09:00:00Z',
    createdAt: '2026-11-01T09:00:00Z',
    updatedAt: now(),
    updatedBy: null,
    requirements: [
      {
        id: '01K0000000000000000000REQ1',
        text: 'BGP routing',
        classification: 'mandatory',
        weight: 10,
        rule: null,
        confidence: 'high',
      },
    ],
    hasDraft: false,
    hasFrozen: true,
    counts: {
      documents: 6,
      analyzed: 2,
      outOfDate: 0,
      strong: 1,
      running: 4,
      stopped: 0,
      failed: 0,
      needsLook: 0,
    },
  },
  [`GET /vacancies/${RUN_VID}/runs`]: [],
  [`GET /vacancies/${RUN_VID}/history`]: [],
  [`GET /vacancies/${RUN_VID}/skipped`]: [],
  [`GET /vacancies/${RUN_VID}/intake`]: {
    used: 6,
    limit: 500,
    maxFileMb: 10,
    maxZipMb: 100,
    accepts: ['.pdf', '.docx', '.txt', '.zip'],
    latestBatch: {
      id: RUN_BATCH,
      createdAt: now(),
      createdBy: 'Ayla Karimova',
      fileCount: 6,
      mine: true,
    },
  },
  [`GET /vacancies/${RUN_VID}/candidates`]: {
    counts: { total: 0, queued: 4, stopped: 0, failed: 0, manual: 0, undecided: 0 },
    aiActive: true,
    candidates: [],
  },
  [`GET /vacancies/${RUN_VID}/adjustments`]: {
    requirements: [],
    knockouts: [],
    changes: [],
    changeCount: 0,
  },
  [`GET /vacancies/${RUN_VID}/criteria`]: {
    versions: [{ id: '01K0000000000000000000SET1', version: 1, frozenAt: '2026-11-01T09:00:00Z' }],
    current: { id: '01K0000000000000000000SET1', version: 1, frozen: true, requirements: [] },
  },
  [`GET /upload-batches/${RUN_BATCH}`]: {
    batch: {
      id: RUN_BATCH,
      vacancyId: RUN_VID,
      createdAt: now(),
      createdBy: 'Ayla Karimova',
      fileCount: 6,
      mine: true,
    },
    lastReceivedAt: now(),
    counts: {
      upload: { total: 6, received: 6, notReceived: 0, vacancyFull: 0, rejected: 0, duplicate: 0 },
      byStatus: { ...BYSTATUS0, analyzing: 4, analyzed: 2 },
    },
    items: [],
  },
};

// ------------------------------------------------------------------ L2 helpers (full stack)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sign in through the API. Every test signs in from 127.0.0.1, and the API allows 30 sign-ins a
 * minute per address (local-auth.service.ts ipLimiter), shared by all packages running at once:
 * a 429 waits and tries again.
 */
export async function loginR(
  a: Pick<Account, 'email' | 'password'>,
  code?: string,
): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const r = await api().post('/auth/login', {
      email: a.email,
      password: a.password,
      ...(code ? { code } : {}),
    });
    if (r.status === 429) {
      await sleep(7000);
      continue;
    }
    if (r.status !== 200 && r.status !== 201)
      throw new Error(`login ${a.email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.token as string;
  }
  throw new Error(`login ${a.email}: still throttled`);
}

/** A throwaway account (as stack.freshAccount, with the sign-in throttle handled). */
export async function freshAcc(
  role: 'TA_PARTNER' | 'TA_LEAD' | 'GOVERNANCE' | 'ADMIN' | 'NONE' = 'TA_PARTNER',
  opts: { name?: string; keepTemp?: boolean } = {},
): Promise<Account> {
  const acc = accounts();
  const admin = api(await loginR(acc.admin));
  const tag = Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const email = `uat.a${tag}@example.az`;
  const displayName = opts.name ?? `Test ${tag}`;
  const r = await admin.post('/admin/users', { email, displayName, role });
  if (r.status !== 201) throw new Error(`fresh account: ${r.status} ${JSON.stringify(r.body)}`);
  const temp = await tempPasswordFor(email);
  const userId = r.body.user.id as string;
  if (opts.keepTemp) return { key: tag, email, password: temp, displayName, roles: [role], userId };
  const password = `${acc.recruiter.password}x`;
  const t = await loginR({ email, password: temp });
  const c = await api(t).post('/auth/change-password', {
    currentPassword: temp,
    newPassword: password,
  });
  if (c.status >= 300)
    throw new Error(`fresh account password: ${c.status} ${JSON.stringify(c.body)}`);
  return { key: tag, email, password, displayName, roles: [role], userId };
}

/** Open the app signed in (the token in this tab only, once), as stack.openAs. */
export async function openAsR(
  page: Page,
  a: Pick<Account, 'email' | 'password'>,
  hash = '#/',
  token?: string,
) {
  const tk = token ?? (await loginR(a));
  await page.addInitScript((t) => {
    if (!sessionStorage.getItem('uat-token-set')) {
      sessionStorage.setItem('cv.session', t);
      sessionStorage.setItem('uat-token-set', '1');
    }
  }, tk);
  await page.goto(`${BASE}/${hash}`);
  return tk;
}

/** RFC 6238 TOTP (SHA1, 30 s, 6 digits), as an authenticator app computes it. */
export function totp(secret: string, step: number): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const key: number[] = [];
  for (const ch of secret.replace(/[\s=-]/g, '').toUpperCase()) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      key.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', Buffer.from(key)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}
export const stepNow = () => Math.floor(Date.now() / 30_000);
/** A six-digit code that no step around now accepts. */
export function wrongCode(secret: string) {
  const s = stepNow();
  const near = new Set([-2, -1, 0, 1, 2].map((d) => totp(secret, s + d)));
  return ['000000', '111111', '222222', '333333'].find((c) => !near.has(c))!;
}
export { sleep };
