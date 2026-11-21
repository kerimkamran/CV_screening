import type { Page, Route } from '@playwright/test';
import { ME, type Seen } from './api';
import { ulidOf } from './files';
import { esc, onBackgrounds, reqs, T, vacApi, vview } from './pkg-c';

/**
 * Package D of the UAT (batch panel and coffeebay, Results and star map, Requirements drawer,
 * Criteria tab, Report and sharing, Runs tab): mocks for layer L1. Every person here is invented.
 */
export { esc, onBackgrounds, reqs, T };

export const DVID = ulidOf('DVA', 1);
export const AYSEL = { userId: '01K000000000000000000000AY', displayName: 'Aysel Mammadova' };
export const docOf = (i: number) => ulidOf('DOC', i);
export const scrOf = (i: number) => ulidOf('SCR', i);
const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

// ------------------------------------------------------------------ requirements

export const REQS = [
  { id: ulidOf('REQ', 1), text: 'BGP routing', classification: 'mandatory', weight: 10 },
  { id: ulidOf('REQ', 2), text: 'OSPF', classification: 'mandatory', weight: 10 },
  { id: ulidOf('REQ', 3), text: 'CCIE certification', classification: 'mandatory', weight: 10 },
  { id: ulidOf('REQ', 4), text: '5G transport experience', classification: 'preferred', weight: 5 },
  { id: ulidOf('REQ', 5), text: 'Python scripting', classification: 'preferred', weight: 5 },
] as const;
type Status = 'met' | 'partially_met' | 'not_found' | 'not_met';
/** Default statuses: BGP and OSPF met, CCIE not found, 5G partly, Python met. */
export const STATUSES: Status[] = ['met', 'met', 'not_found', 'partially_met', 'met'];

export function breakdown(statuses: Status[] = STATUSES, gaps?: number) {
  const items = REQS.map((r, i) => {
    const s = statuses[i] ?? 'not_found';
    const pts = r.weight;
    return {
      requirementId: r.id,
      text: r.text,
      classification: r.classification,
      weight: r.weight,
      status: s,
      points: pts,
      earned: s === 'met' ? pts : s === 'partially_met' ? pts / 2 : 0,
    };
  });
  const mandatoryGaps =
    gaps ??
    items.filter(
      (i) => i.classification === 'mandatory' && i.status !== 'met' && i.status !== 'partially_met',
    ).length;
  return { formula: 'weighted', earned: 30, possible: 40, mandatoryGaps, items };
}

export interface RowOpts {
  score?: number | null;
  state?: string;
  name?: string;
  statuses?: Status[];
  gaps?: number;
  decision?: {
    outcome: 'shortlist' | 'hold' | 'reject';
    reason: string;
    decidedAt?: string;
    decidedBy?: string;
  } | null;
  knockout?: boolean;
  parseStatus?: string;
  error?: string | null;
  band?: string | null;
  filename?: string;
}
/** A row of GET /vacancies/<id>/candidates (CandidateRow). */
export function crow(i: number, o: RowOpts = {}) {
  const score = o.score === undefined ? 90 - i : o.score;
  const state = o.state ?? (score === null ? 'manual' : 'completed');
  return {
    screeningId: state === 'queued' || state === 'stopped' ? null : scrOf(i),
    documentId: docOf(i),
    filename: o.filename ?? `cv-${String(i).padStart(3, '0')}.pdf`,
    uploadedAt: new Date(Date.UTC(2026, 10, 1, 9, 0, i)).toISOString(),
    parseStatus: o.parseStatus ?? 'ok',
    erased: false,
    state,
    candidateName: o.name ?? `Person ${String(i).padStart(2, '0')}`,
    band:
      o.band !== undefined
        ? o.band
        : score === null
          ? 'needs_review'
          : score >= 80
            ? 'strong_match'
            : score >= 50
              ? 'possible_match'
              : 'weak_match',
    score:
      score === null || state !== 'completed'
        ? null
        : { value: score, breakdown: breakdown(o.statuses, o.gaps) },
    knockoutTriggered: o.knockout ?? false,
    injectionSuspected: false,
    error: o.error ?? null,
    decision: o.decision
      ? { decidedAt: iso(60), decidedBy: 'Aysel Mammadova', ...o.decision }
      : null,
    ordinal: i,
  };
}
export type CRow = ReturnType<typeof crow>;

/** Scores per band: Strong 80+, Good 70-79, Partial 50-69, Limited under 50. */
export function bandRows(
  n: { strong?: number; good?: number; partial?: number; limited?: number; human?: number },
  start = 1,
) {
  const out: CRow[] = [];
  let i = start;
  const add = (k: number, from: number, step: number) => {
    for (let j = 0; j < k; j++) out.push(crow(i++, { score: Math.max(1, from - j * step) }));
  };
  add(n.strong ?? 0, 98, 3);
  add(n.good ?? 0, 79, 1);
  add(n.partial ?? 0, 68, 2);
  add(n.limited ?? 0, 45, 4);
  for (let j = 0; j < (n.human ?? 0); j++)
    out.push(
      crow(i++, {
        score: null,
        state: 'manual',
        knockout: j === 1,
        parseStatus: j === 2 ? 'empty' : 'ok',
      }),
    );
  return out;
}

/** GET /screenings/<id>: the reasons and quotes. */
export function detail(i: number, statuses: Status[] = STATUSES) {
  return {
    summary: `Person ${String(i).padStart(2, '0')} ran a carrier BGP and OSPF backbone for six years.`,
    aiProvider: 'Fake AI',
    aiModel: 'fake-1',
    assessments: REQS.map((r, k) => {
      const s = statuses[k] ?? 'not_found';
      return {
        requirementId: r.id,
        text: r.text,
        status: s,
        rationale: s === 'met' ? 'Stated in the work history with dates.' : null,
        evidence: s === 'met' ? [{ quote: `Quote for ${r.text}`, page: k === 0 ? 1 : 2 }] : [],
      };
    }),
  };
}

export function adjustments(
  o: { current?: Record<string, string>; knockouts?: string[]; changes?: unknown[] } = {},
) {
  const requirements = REQS.map((r) => ({
    id: r.id,
    text: r.text,
    original: r.classification,
    current: o.current?.[r.text] ?? r.classification,
  }));
  const changes = (o.changes ?? []) as unknown[];
  return {
    requirements,
    knockouts: o.knockouts ?? ['No work permit'],
    changes,
    changeCount: changes.length,
  };
}

export function criteria(
  o: {
    versions?: { version: number; frozenAt: string | null }[];
    current?: number;
    frozen?: boolean;
    rows?: unknown[];
  } = {},
) {
  const versions = (o.versions ?? [{ version: 1, frozenAt: iso(60 * 24 * 3) }]).map((v) => ({
    id: ulidOf('SET', v.version),
    ...v,
  }));
  const cur = o.current ?? versions[versions.length - 1]!.version;
  return {
    versions,
    current: {
      id: ulidOf('SET', cur),
      version: cur,
      frozen: o.frozen ?? true,
      requirements: o.rows ?? REQS.map((r) => ({ ...r, rule: null, confidence: 'high' })),
    },
  };
}

export const listingOf = (rows: CRow[], o: { aiActive?: boolean; total?: number } = {}) => ({
  counts: {
    total: o.total ?? rows.length,
    queued: rows.filter((r) => r.state === 'queued' || r.state === 'processing').length,
    stopped: rows.filter((r) => r.state === 'stopped').length,
    failed: rows.filter((r) => r.state === 'failed').length,
    manual: rows.filter((r) => r.state === 'manual').length,
    undecided: rows.filter((r) => !r.decision).length,
  },
  aiActive: o.aiActive ?? true,
  candidates: rows,
});

type Answer = unknown | ((route: Route, url: URL, method: string, body: any) => unknown);
export interface ResultsOpts {
  rows?: CRow[] | (() => CRow[]);
  me?: Record<string, unknown>;
  assistant?: Record<string, unknown>;
  aiActive?: boolean;
  adj?: unknown;
  criteria?: unknown;
  runs?: unknown;
  shares?: unknown;
  people?: unknown;
  skipped?: unknown;
  view?: Record<string, unknown>;
  /** GET /screenings/<id>: delay in ms (per screening id) or status. */
  detail?: (sid: string) => { delay?: number; status?: number; body?: unknown } | undefined;
  /** Answered first: 'METHOD /path' → JSON or a function (return undefined to fall through). */
  answers?: Record<string, Answer>;
}

/** mockApi + vacApi (package C) with the Results, Report, Runs, Criteria and sharing endpoints. */
export async function resultsApi(page: Page, o: ResultsOpts = {}) {
  const rowsOf = () =>
    typeof o.rows === 'function'
      ? o.rows()
      : (o.rows ?? bandRows({ strong: 2, good: 2, partial: 1 }));
  const r0 = rowsOf();
  const view = vview({
    id: DVID,
    title: 'UAT Results role',
    requirements: REQS.map((r) => ({ ...r, rule: null, confidence: 'high' })),
    hasFrozen: true,
    candidateNoticeConfirmedAt: iso(60 * 24 * 3),
    owner: { id: AYSEL.userId, name: AYSEL.displayName },
    createdAt: '2026-11-01T09:00:00.000Z',
    counts: {
      documents: r0.length,
      analyzed: Math.max(1, r0.filter((r) => r.state === 'completed').length),
    },
    ...(o.view ?? {}),
  });
  const { seen } = await vacApi(page, {
    me: { ...AYSEL, ...(o.me ?? {}) },
    assistant: o.assistant,
    views: [view],
    runs: (o.runs as unknown[]) ?? [],
    extra: async (route, url, method, body) => {
      const p = url.pathname;
      const key = `${method} ${p}`;
      const json = async (b: unknown, status = 200) => {
        await route.fulfill({ status, json: b });
        return true;
      };
      for (const [k, a] of Object.entries(o.answers ?? {})) {
        if (k !== key && !(k.endsWith('*') && key.startsWith(k.slice(0, -1)))) continue;
        const v =
          typeof a === 'function'
            ? await (a as (r: Route, u: URL, m: string, b: any) => unknown)(
                route,
                url,
                method,
                body,
              )
            : a;
        if (v === true) return true; // the function answered itself
        if (v !== undefined) return json(v);
      }
      const base = `/vacancies/${DVID}`;
      if (key === `GET ${base}/candidates`)
        return json(listingOf(rowsOf(), { aiActive: o.aiActive }));
      if (key === `GET ${base}/adjustments`) return json(o.adj ?? adjustments());
      if (key === `GET ${base}/criteria`) return json(o.criteria ?? criteria());
      if (key === `GET ${base}/skipped`) return json(o.skipped ?? { skipped: [] });
      if (key === `GET ${base}/shares`) return json(o.shares ?? { shares: [] });
      if (key === `GET ${base}/intake`)
        return json({
          used: r0.length,
          limit: 500,
          maxFileMb: 10,
          maxZipMb: 100,
          accepts: ['.pdf', '.docx', '.txt', '.zip'],
          latestBatch: null,
        });
      if (key === `GET ${base}/jd`)
        return json({
          body: 'Required: BGP routing, OSPF, CCIE certification\nNice to have: 5G transport experience, Python scripting',
        });
      if (p === '/reports/people') return json(o.people ?? { people: [] });
      const s = /^\/screenings\/(\w{26})$/.exec(p);
      if (s && method === 'GET') {
        const d = o.detail?.(s[1]!);
        if (d?.delay) await new Promise((r) => setTimeout(r, d.delay));
        if (d?.status && d.status >= 400)
          return json({ statusCode: d.status, message: 'Database not reachable' }, d.status);
        const row = rowsOf().find((r) => r.screeningId === s[1]);
        const i = row ? row.ordinal : 1;
        return json(
          d?.body ??
            detail(i, (row?.score?.breakdown.items.map((x) => x.status) as Status[]) ?? STATUSES),
        );
      }
      if (/^\/screenings\/\w{26}\/decision$/.test(p) && method === 'POST')
        return json({ ok: true }, 201);
      return false;
    },
  });
  return { seen, view };
}

export const gets = (seen: Seen, re: RegExp) =>
  seen.requests.filter((r) => r.method === 'GET' && re.test(r.url));
export const posts = (seen: Seen, re: RegExp) =>
  seen.requests.filter((r) => r.method === 'POST' && re.test(r.url));

/** The cards of the ranked list (not the ones inside the Limited group). */
export const cards = (page: Page, lang: 'en' | 'az') =>
  page.locator(`section[aria-label="${T(lang)('Candidates')}"] > article`);
export const starMap = (page: Page) => page.getByTestId('star-map');
export const stars = (page: Page) => starMap(page).locator('button[data-star]');

/** Is any part of the element covered by something else at its centre? */
export async function hitsSelf(page: Page, sel: string, within: string) {
  return page.evaluate(
    ([s, w]) => {
      const root = document.querySelector(w!);
      const out: string[] = [];
      for (const e of root ? Array.from(root.querySelectorAll<HTMLElement>(s!)) : []) {
        const r = e.getBoundingClientRect();
        if (!r.width) continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !root!.contains(hit))
          out.push(
            `${e.tagName} ${(e.textContent ?? '').slice(0, 30)} → ${hit?.tagName ?? 'none'}.${hit?.className?.toString().slice(0, 40) ?? ''}`,
          );
      }
      return out;
    },
    [sel, within],
  );
}

// ------------------------------------------------------------------ the batch panel (coffeebay)

export const BYSTATUS0 = {
  not_sent: 0,
  sending: 0,
  waiting_to_send: 0,
  could_not_send: 0,
  rejected: 0,
  duplicate: 0,
  vacancy_full: 0,
  cancelled: 0,
  analyzing: 0,
  stopped: 0,
  failed: 0,
  unreadable: 0,
  needs_look: 0,
  analyzed: 0,
  not_analyzed: 0,
  erased: 0,
};
export type ByStatus = Partial<typeof BYSTATUS0>;
export interface BatchStep {
  received: number;
  by: ByStatus;
  items?: unknown[];
}
export const BVID = ulidOf('BVA', 1);

/**
 * A vacancy ready to start (requirements frozen, notice confirmed) whose batch polls answer from
 * `script` (one step per poll; the last one repeats). Uploads are held when `holdUploads` is set.
 */
export async function batchApi(
  page: Page,
  o: {
    files: number;
    script: BatchStep[] | ((poll: number) => BatchStep);
    holdUploads?: boolean;
    me?: Record<string, unknown>;
    latest?: { mine: boolean } | null;
    batchError?: string;
  },
) {
  let polls = 0;
  let batchId = '';
  const view = vview({
    id: BVID,
    title: 'UAT Coffeebay role',
    requirements: REQS.slice(0, 2).map((r) => ({ ...r, rule: null, confidence: 'high' })),
    hasFrozen: true,
    candidateNoticeConfirmedAt: iso(60 * 24),
    owner: { id: AYSEL.userId, name: AYSEL.displayName },
  });
  const held: Route[] = [];
  const LATEST = ulidOf('BAT', 900);
  const status = (id: string, step: BatchStep, items: boolean) => ({
    batch: {
      id,
      vacancyId: BVID,
      createdAt: iso(1),
      createdBy: AYSEL.displayName,
      fileCount: o.files,
      mine: true,
    },
    lastReceivedAt: iso(0),
    counts: {
      upload: {
        total: o.files,
        received: step.received,
        notReceived: o.files - step.received,
        vacancyFull: 0,
        rejected: 0,
        duplicate: 0,
      },
      byStatus: { ...BYSTATUS0, ...step.by },
    },
    ...(items ? { items: step.items ?? [] } : {}),
  });
  const { seen } = await vacApi(page, {
    me: { ...AYSEL, ...(o.me ?? {}) },
    views: [view],
    extra: async (route, url, method) => {
      const p = url.pathname;
      if (p === `/vacancies/${BVID}/documents` && method === 'POST' && o.holdUploads) {
        held.push(route);
        return true;
      }
      if (p === `/vacancies/${BVID}/intake` && o.latest)
        return route
          .fulfill({
            json: {
              used: 0,
              limit: 500,
              maxFileMb: 10,
              maxZipMb: 100,
              accepts: ['.pdf', '.docx', '.txt', '.zip'],
              latestBatch: {
                id: LATEST,
                createdAt: iso(1),
                createdBy: AYSEL.displayName,
                fileCount: o.files,
                mine: o.latest.mine,
              },
            },
          })
          .then(() => true);
      if (p === `/vacancies/${BVID}/upload-batches` && method === 'POST') return false; // vacApi answers
      const b = /^\/upload-batches\/(\w{26})$/.exec(p);
      if (b) {
        batchId = b[1]!;
        if (o.batchError) {
          await route.fulfill({ status: 500, json: { statusCode: 500, message: o.batchError } });
          return true;
        }
        const step =
          typeof o.script === 'function'
            ? o.script(polls)
            : o.script[Math.min(polls, o.script.length - 1)]!;
        polls++;
        await route.fulfill({ json: status(b[1]!, step, url.searchParams.get('items') === '1') });
        return true;
      }
      if (p === `/vacancies/${BVID}/candidates`)
        return route.fulfill({ json: listingOf([]) }).then(() => true);
      if (p === '/candidates')
        return route
          .fulfill({
            json: {
              rows: [],
              total: 0,
              counts: {
                byMark: { new: 0, shortlist: 0, maybe: 0, not_now: 0 },
                outOfDate: 0,
                strong: 0,
              },
              nextCursor: null,
              asOf: iso(0),
            },
          })
          .then(() => true);
      return false;
    },
  });
  return { seen, view, held, polls: () => polls, batchId: () => batchId, LATEST };
}

const cvs = (page: Page, lang: 'en' | 'az') =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: T(lang)('CVs'), exact: true }) });
/** Choose n PDF files on the CVs card, tick the notice when shown and press the start button. */
export async function startBatch(page: Page, lang: 'en' | 'az', n: number) {
  const t = T(lang);
  const c = cvs(page, lang);
  const files = Array.from({ length: n }, (_, i) => ({
    name: `uat-cv-${String(i + 1).padStart(3, '0')}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 0x20)]),
  }));
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    c.getByRole('button', { name: t('Choose files'), exact: true }).click(),
  ]);
  await fc.setFiles(files);
  const box = c.getByRole('checkbox');
  if (await box.count()) await box.first().check();
  await c
    .locator('button')
    .filter({ hasText: new RegExp(`^(${esc(t('Find the best fit →'))}|${esc(t('Re-analyze'))})$`) })
    .click();
}
export const coffeebay = (page: Page) => page.getByTestId('coffeebay');
export { ME };
