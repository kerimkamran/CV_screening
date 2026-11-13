import type { Page, Route } from '@playwright/test';
import { AZ } from '../../apps/web/src/i18n/az';
import { DID, DID2, DID3, DOCS, MID, MID2, mockApi, VID, type Seen } from './api';
import type { Meta } from '../ux/test';

/**
 * Mocks and helpers for UAT package E (candidate pool CP, review sprint SP, candidate links LK).
 * Every person and company here is invented. The shared fixture's rows use the band 'possible'
 * (SD-64), which is not a band; these rows use the real bands.
 */

/** The app's own wording in the run's language (English key → Azerbaijani, as the app does). */
export function words(meta: Pick<Meta, 'lang'>) {
  return (en: string, vars?: Record<string, string | number>) => {
    const s = meta.lang === 'az' ? (AZ[en] ?? en) : en;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}

export const DID4 = '01K0000000000000000000000G';
export const MID3 = '01K0000000000000000000000P';
export const MID4 = '01K0000000000000000000000Q';
export const VID2 = '01K0000000000000000000000W';

const pad = (n: number) => String(n).padStart(4, '0');
/** A 26-character id in Crockford-ish upper case, for generated rows. */
export const docId = (n: number) => `01KD000000000000000000${pad(n)}`;
export const matchId = (n: number) => `01KM000000000000000000${pad(n)}`;

export type Band = 'strong' | 'good' | 'partial' | 'limited';
export const bandOf = (score: number): Band =>
  score >= 75 ? 'strong' : score >= 65 ? 'good' : score >= 50 ? 'partial' : 'limited';

export interface Row {
  documentId: string;
  vacancyId: string;
  vacancyTitle: string;
  vacancyStatus: string;
  vacancyArchived: boolean;
  pseudonym: string;
  label: string;
  name: string | null;
  ordinal: number;
  matchId: string | null;
  score: number | null;
  band: Band | null;
  mustFound: number;
  mustTotal: number;
  decision: string;
  decisionNote: string | null;
  decisionVersion: number;
  decidedAt: string | null;
  decidedBy: string | null;
  outOfDate: boolean;
  scoredAgainst: null;
  reanalyzing: boolean;
  analyzedAt: string | null;
  updatedAt: string;
  status?: string;
  screeningId?: string | null;
  filename?: string;
  uploadedAt?: string;
}

const now = () => new Date(Date.now() - 5 * 60_000).toISOString();

export function prow(
  documentId: string,
  mid: string | null,
  label: string,
  score: number | null,
  ordinal: number,
  more: Partial<Row> = {},
): Row {
  return {
    documentId,
    vacancyId: VID,
    vacancyTitle: 'Network Engineer',
    vacancyStatus: 'open',
    vacancyArchived: false,
    pseudonym: `Candidate ${String(ordinal).padStart(2, '0')}`,
    label,
    name: label,
    ordinal,
    matchId: mid,
    score,
    band: score === null ? null : bandOf(score),
    mustFound: 3,
    mustTotal: 4,
    decision: 'new',
    decisionNote: null,
    decisionVersion: 0,
    decidedAt: null,
    decidedBy: null,
    outOfDate: false,
    scoredAgainst: null,
    reanalyzing: false,
    analyzedAt: score === null ? null : now(),
    updatedAt: now(),
    ...more,
  };
}

/** A row without a result (Show: a status). */
export const statusRow = (n: number, label: string, status: string) =>
  prow(docId(900 + n), null, label, null, 900 + n, {
    status,
    screeningId: null,
    filename: `${label.toLowerCase().replace(/\W+/g, '-')}.pdf`,
    uploadedAt: now(),
    mustFound: 0,
    mustTotal: 4,
  });

/** The plan's four-row pool for CP-01. */
export const FOUR = () => [
  prow(DID, MID, 'Aysel Məmmədova', 88, 1),
  prow(DID2, MID2, 'Rauf Əliyev', 71, 2),
  prow(DID3, MID3, 'Leyla Hüseynova', 64, 3, {
    band: 'partial',
    vacancyId: VID2,
    vacancyTitle: 'Radio Planner',
    vacancyStatus: 'closed',
    outOfDate: true,
  }),
  prow(DID4, MID4, 'Kamal Rzayev', 58, 4, { band: 'limited', outOfDate: true, reanalyzing: true }),
];

const FIRST = [
  'Aysel',
  'Rauf',
  'Leyla',
  'Kamal',
  'Nigar',
  'Tural',
  'Günel',
  'Orxan',
  'Səbinə',
  'Elvin',
];
const LAST = [
  'Məmmədova',
  'Əliyev',
  'Hüseynova',
  'Rzayev',
  'Quliyeva',
  'Həsənov',
  'İsmayılova',
  'Babayev',
];
/** n ranked rows, best first; row i (1-based) is "<First> <Last> i". */
export function manyRows(n: number): Row[] {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    const score = Math.max(20, 96 - Math.floor((k * 70) / Math.max(1, n)));
    return prow(
      docId(i),
      matchId(i),
      `${FIRST[k % FIRST.length]} ${LAST[k % LAST.length]} ${i}`,
      score,
      i,
    );
  });
}

export const VACANCIES = [
  { id: VID, title: 'Network Engineer', status: 'open', archived: false },
  { id: VID2, title: 'Radio Planner', status: 'closed', archived: false },
];

export interface PoolOpts {
  rows?: Row[];
  /** Rows per page; when set it wins over the request's limit. */
  // (pageSize below)
  /** Answer for one list request (filters applied by the test): return rows or a status. */
  list?: (url: URL) => Row[] | { status: number; body: unknown } | undefined;
  counts?: { byMark?: Record<string, number>; outOfDate?: number; strong?: number };
  delayMs?: (url: URL) => number;
  report?: (mid: string) => { status?: number; body?: unknown; delay?: number } | undefined;
  decision?: (
    route: Route,
    mid: string,
    body: Record<string, unknown>,
  ) => Promise<boolean> | boolean;
  decisions?: (body: { matchIds: string[]; mark: string }) => unknown;
  more?: (route: Route, url: URL) => Promise<boolean> | boolean;
  me?: Record<string, unknown>;
  assistant?: Record<string, unknown>;
  pageSize?: number;
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

/** A report for the preview: summary and 4 requirements (2 must matched, 1 must not found, 1 nice). */
export const report = (mid: string, label: string, opts: { noMust?: boolean } = {}) => ({
  matchId: mid,
  documentId: DID,
  label,
  name: label,
  pseudonym: 'Candidate 01',
  email: null,
  filename: 'aysel.pdf',
  vacancy: { id: VID, title: 'Network Engineer', status: 'open', archived: false },
  score: 88,
  band: 'strong',
  mustFound: 3,
  mustTotal: 4,
  summary: 'Ten years of carrier network design with BGP and OSPF.',
  analyzedAt: now(),
  outOfDate: null,
  reanalyzing: false,
  decision: { mark: 'new', note: null, version: 0, decidedAt: null, decidedBy: null },
  history: [],
  requirements: opts.noMust
    ? [
        {
          requirementId: 'R9',
          text: 'Russian language',
          kind: 'nice',
          state: 'matched',
          unclear: false,
          notFound: false,
          confidence: 'high',
          rationale: 'Stated.',
          anchors: [],
        },
      ]
    : [
        {
          requirementId: 'R1',
          text: 'BGP routing',
          kind: 'must',
          state: 'matched',
          unclear: false,
          notFound: false,
          confidence: 'high',
          rationale: 'Stated.',
          anchors: [],
        },
        {
          requirementId: 'R2',
          text: 'OSPF',
          kind: 'must',
          state: 'matched',
          unclear: false,
          notFound: false,
          confidence: 'high',
          rationale: 'Stated.',
          anchors: [],
        },
        {
          requirementId: 'R4',
          text: 'CCIE certification',
          kind: 'must',
          state: 'missing',
          unclear: false,
          notFound: true,
          confidence: 'high',
          rationale: 'Not in the CV.',
          anchors: [],
        },
        {
          requirementId: 'R5',
          text: 'Russian language',
          kind: 'nice',
          state: 'matched',
          unclear: false,
          notFound: false,
          confidence: 'high',
          rationale: 'Stated.',
          anchors: [],
        },
      ],
});

/** Mocks the candidate pool (paged by cursor), the ids list, vacancies, reports and marks. */
export async function poolApi(page: Page, o: PoolOpts = {}): Promise<Seen & { rows: Row[] }> {
  const rows = o.rows ?? FOUR();
  const size = o.pageSize ?? 50;
  const seen = await mockApi(page, {
    me: o.me,
    assistant: o.assistant,
    extra: async (route, url) => {
      const p = url.pathname;
      const m = route.request().method();
      if (o.more && (await o.more(route, url))) return true;
      if (p === '/vacancies' && m === 'GET') {
        await json(route, VACANCIES);
        return true;
      }
      if (p === '/candidates' && m === 'GET') {
        const wait = o.delayMs?.(url) ?? 0;
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const got = o.list?.(url);
        if (got && !Array.isArray(got)) {
          await json(route, got.body, got.status);
          return true;
        }
        const list = got ?? rows;
        const from = Number(url.searchParams.get('cursor') ?? 0) || 0;
        const lim = o.pageSize ?? (Number(url.searchParams.get('limit') ?? size) || size);
        const slice = list.slice(from, from + lim);
        const counts = {
          byMark: {
            new: list.length,
            shortlist: 0,
            maybe: 0,
            not_now: 0,
            ...(o.counts?.byMark ?? {}),
          },
          outOfDate: o.counts?.outOfDate ?? list.filter((r) => r.outOfDate).length,
          strong: o.counts?.strong ?? list.filter((r) => r.band === 'strong').length,
        };
        await json(route, {
          rows: slice,
          total: list.length,
          counts,
          nextCursor: from + lim < list.length ? String(from + lim) : null,
          asOf: new Date().toISOString(),
        });
        return true;
      }
      if (p === '/candidates/ids' && m === 'GET') {
        const got = o.list?.(url);
        const list = got && Array.isArray(got) ? got : rows;
        await json(route, {
          items: list.map((r) => [r.documentId, r.matchId]),
          total: list.length,
          truncated: false,
        });
        return true;
      }
      const rep = /^\/candidates\/(\w{26})\/report$/.exec(p);
      if (rep) {
        const r = o.report?.(rep[1]!);
        if (r?.delay) await new Promise((res) => setTimeout(res, r.delay));
        const row = rows.find((x) => x.matchId === rep[1]);
        await json(route, r?.body ?? report(rep[1]!, row?.label ?? 'Candidate'), r?.status ?? 200);
        return true;
      }
      const put = /^\/candidates\/(\w{26})\/decision$/.exec(p);
      if (put && m === 'PUT' && o.decision) {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        if (await o.decision(route, put[1]!, body)) return true;
      }
      if (p === '/candidates/decisions' && m === 'POST') {
        const body = route.request().postDataJSON() as { matchIds: string[]; mark: string };
        const ans = o.decisions?.(body) ?? {
          results: body.matchIds.map((id) => ({
            matchId: id,
            ok: true,
            version: 1,
            previous: { mark: 'new', note: null, version: 0 },
          })),
          changed: body.matchIds.length,
        };
        await json(route, ans);
        return true;
      }
      return false;
    },
  });
  return Object.assign(seen, { rows });
}

/** Review documents for a list of rows (the review screen reads /documents/<id>). */
export function docFor(
  r: { documentId: string; matchId: string | null; label: string; score?: number | null },
  mark = 'new',
  version = 0,
) {
  const base = DOCS[DID] as Record<string, any>;
  const decision = { mark, note: null, version, decidedAt: null, decidedBy: null };
  return {
    ...base,
    documentId: r.documentId,
    name: r.label,
    screeningId: r.matchId,
    matchId: r.matchId,
    decision,
    original: { available: true, view: 'none' },
    filename: 'cv.txt',
    kind: 'txt',
    analysis: {
      ...(base.analysis as object),
      matchId: r.matchId,
      documentId: r.documentId,
      label: r.label,
      name: r.label,
      score: r.score ?? 70,
      band: bandOf(r.score ?? 70),
      decision,
    },
  };
}

/** Stores a review list in this tab before the page loads. */
export async function storeList(
  page: Page,
  ids: string[],
  id = 'e2e-list',
  back = '/candidates',
  label = 'Candidates',
) {
  await page.addInitScript(
    ([ids, id, back, label]) => {
      if (sessionStorage.getItem('uat-list-set')) return;
      sessionStorage.setItem('uat-list-set', '1');
      sessionStorage.setItem(
        'cv-review-lists',
        JSON.stringify([{ id, ids, back, label, savedAt: Date.now() }]),
      );
    },
    [ids, id, back, label] as const,
  );
}

/** The decision PUTs the page sent. */
export const puts = (seen: Seen) =>
  seen.requests.filter((r) => r.method === 'PUT' && /\/decision$/.test(r.url));
export const gets = (seen: Seen, re: RegExp) =>
  seen.requests.filter((r) => r.method === 'GET' && re.test(r.url));

/**
 * The review screen over a list of CVs, with marks kept as the server would (version +1 per PUT).
 * `fail(mid, body)` may answer a PUT itself (a 409 and so on).
 */
export async function reviewApi(
  page: Page,
  list: { documentId: string; matchId: string; label: string; score?: number; mark?: string }[],
  o: Omit<PoolOpts, 'decision'> & {
    fail?: (
      mid: string,
      body: Record<string, unknown>,
    ) => { status: number; body: unknown } | undefined;
  } = {},
) {
  const state = new Map(
    list.map((d) => [
      d.matchId,
      {
        mark: d.mark ?? 'new',
        note: null as string | null,
        version: d.mark && d.mark !== 'new' ? 1 : 0,
      },
    ]),
  );
  const seen = await poolApi(page, {
    ...o,
    rows:
      o.rows ??
      list.map((d, i) => prow(d.documentId, d.matchId, d.label, d.score ?? 80 - i, i + 1)),
    more: async (route, url) => {
      if (o.more && (await o.more(route, url))) return true;
      const m = /^\/documents\/(\w{26})$/.exec(url.pathname);
      const d = m && list.find((x) => x.documentId === m[1]);
      if (d) {
        const st = state.get(d.matchId)!;
        const doc = docFor(d, st.mark, st.version) as Record<string, any>;
        if (d.documentId === DID) {
          // Keep the real PDF and requirements of the shared fixture for the first CV.
          const base = DOCS[DID] as Record<string, any>;
          Object.assign(doc, { original: base.original, filename: base.filename, kind: base.kind });
        }
        await route.fulfill({ json: doc });
        return true;
      }
      return false;
    },
    decision: async (route, mid, body) => {
      const f = o.fail?.(mid, body);
      if (f) {
        await route.fulfill({ status: f.status, json: f.body });
        return true;
      }
      const st = state.get(mid) ?? { mark: 'new', note: null, version: 0 };
      const previous = { ...st };
      const next = {
        mark: String(body.mark),
        note: (body.note as string | null) ?? null,
        version: st.version + 1,
      };
      state.set(mid, next);
      await route.fulfill({ json: { ...next, previous } });
      return true;
    },
  });
  return Object.assign(seen, { state });
}

/** The four CVs the sprint cases walk (the first two are the shared fixture's). */
export const SPRINT = [
  { documentId: DID, matchId: MID, label: 'Aysel Məmmədova', score: 88 },
  { documentId: DID2, matchId: MID2, label: 'Rauf Əliyev', score: 71 },
  { documentId: DID3, matchId: MID3, label: 'Leyla Hüseynova', score: 66 },
  { documentId: DID4, matchId: MID4, label: 'Kamal Rzayev', score: 58 },
];
