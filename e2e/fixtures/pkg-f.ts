import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { AZ } from '../../apps/web/src/i18n/az';
import {
  analysis,
  decision,
  DID,
  DID2,
  DOCS,
  MID,
  MID2,
  mockApi,
  PDF,
  TEXT,
  vacancy,
  type Seen,
} from './api';
import { FILES } from './files';

/**
 * Package F of the UAT (plan 7.17 CV review, 7.18 CV pane and full screen, 7.19 evidence map):
 * mocks and probes only these areas need. Every person and company here is invented.
 */

// ------------------------------------------------------------------ language

/** The app's own lookup (i18n/index.ts tr): English sentence → Azerbaijani, with {vars}. */
export function T(lang: string) {
  return (en: string, vars?: Record<string, string | number>) => {
    const s = lang === 'az' ? (AZ[en] ?? en) : en;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}
/** True when the sentence has an Azerbaijani entry (an AZ screen can then never show the English). */
export const hasAz = (en: string) => !!AZ[en] && AZ[en] !== en;
/** A regex that matches a text exactly (for getByRole names). */
export const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

// ------------------------------------------------------------------ ids and data

/** ULID-shaped ids for the extra CVs of this package. */
export const fid = (n: number | string) => `01K0000000000000000000F${String(n).padStart(3, '0')}`;
export const DID4 = fid(4); // leyla.docx, pages pending then ready
export const DID5 = fid(5); // being analyzed
export const DID6 = fid(6); // analysis failed
export const DID7 = fid(7); // unreadable (scanned)
export const DID8 = fid(8); // needs a human look
export const DID9 = fid(9); // stopped
export const DID10 = fid(10); // not analyzed
export const DID11 = fid(11); // erased
export const DID12 = fid(12); // dense skills PDF
export const DID13 = fid(13); // password-protected PDF
export const DID14 = fid(14); // broken PDF
export const DID15 = fid(15); // docx without pages
export const DID16 = fid(16); // /view 404
export const DID17 = fid(17); // /view 409
export const DID18 = fid(18); // docx, no text
export const DIDX = fid(901); // slow
export const DIDY = fid(902); // 404
export const DIDZ = fid(903); // 500 once
export const MIDX = fid(904); // unknown screening
export const S6 = fid(906);

export const BASE_DOC = DOCS[DID] as Record<string, any>;
export const BASE_DOC2 = DOCS[DID2] as Record<string, any>;
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** One requirement in the shape of the review data. */
export function req(
  id: string,
  text: string,
  o: {
    kind?: 'must' | 'nice' | 'other';
    state?: 'matched' | 'partly' | 'missing';
    unclear?: boolean;
    notFound?: boolean;
    page?: number | null;
    quotes?: string[];
    start?: number;
    end?: number;
    rationale?: string;
  } = {},
) {
  const state = o.state ?? 'matched';
  const quotes = o.quotes ?? [];
  return {
    requirementId: id,
    text,
    kind: o.kind ?? 'must',
    state,
    unclear: o.unclear ?? false,
    notFound: o.notFound ?? false,
    confidence: 'high',
    rationale: o.rationale ?? 'Stated in the work history with dates.',
    anchors: quotes.map((quote) => ({
      start: o.start ?? 0,
      end: o.end ?? 10,
      quote,
      page: o.page ?? null,
      block: 0,
    })),
  };
}

/** A copy of Aysel's review data with a changed analysis. */
export function aysel(patch: Record<string, any> = {}, aPatch: Record<string, any> = {}) {
  const d = clone(BASE_DOC);
  return { ...d, ...patch, analysis: d.analysis ? { ...d.analysis, ...aPatch } : null };
}

/** A document in any state (no analysis), for the status panels. */
export function stateDoc(id: string, status: string, patch: Record<string, any> = {}) {
  return {
    ...clone(BASE_DOC),
    documentId: id,
    filename: 'cv.pdf',
    status,
    statusDetail: { retryable: false },
    analysis: null,
    ...patch,
  };
}

/** The Word CV (leyla.docx): analysed; its pages come from the rendition (cv.pdf). */
export function leyla(view: 'pending' | 'pdf' | 'none', id = DID4) {
  return {
    ...clone(BASE_DOC),
    documentId: id,
    filename: 'leyla.docx',
    kind: 'docx',
    name: 'Leyla Həsənova',
    original: { available: true, view, ...(view === 'pdf' ? { source: 'rendition' } : {}) },
    analysis: { ...analysis(id, MID, 'Leyla Həsənova', 82), filename: 'leyla.docx' },
  };
}

/** Rauf's text CV where the 'OSPF' anchor really points at 'OSPF areas' (CV-10 step 4). */
export function raufReal() {
  const d = clone(BASE_DOC2);
  const at = TEXT.text.indexOf('OSPF areas');
  const bgp = TEXT.text.indexOf('BGP route reflectors');
  const g5 = TEXT.text.indexOf('5G transport rollout');
  for (const r of d.analysis.requirements as any[]) {
    const a = r.anchors[0];
    if (!a) continue;
    const s = r.text === 'OSPF' ? at : r.text === 'BGP routing' ? bgp : g5;
    a.start = s;
    a.end = s + a.quote.length;
    a.page = null;
  }
  return d;
}

/** A CV text of about 12,000 characters with three pages and the quotes spread through it. */
export function longText() {
  const filler = (n: number, tag: string) =>
    Array.from(
      { length: n },
      (_, i) =>
        `${tag} ${i + 1}: maintained routers, wrote change plans and reviewed designs with the team.\n`,
    ).join('');
  const parts = [
    'Aysel Məmmədova\nSenior Network Engineer, Bakı\n\n',
    filler(10, 'Early work'),
    'Redesigned the IP core with BGP route reflectors and OSPF areas.\n',
    filler(40, 'Operations'),
    'OSPF areas were split per region for faster convergence.\n',
    filler(45, 'Projects'),
    'Led the 5G transport rollout across three regions.\n',
    filler(40, 'Later work'),
  ];
  let text = parts.join('');
  text = text.padEnd(12_000, ' Training and certificates kept current.');
  text = text.slice(0, 12_000);
  const pageStarts = [0, 4_000, 8_000];
  const pos = (q: string, from = 0) => text.indexOf(q, from);
  const bgp = pos('BGP route reflectors');
  const ospf = pos('OSPF areas were split');
  const g5 = pos('5G transport rollout');
  return {
    text: { text, truncated: false, pageStarts, blocks: [] },
    spots: { bgp: bgp / text.length, ospf: ospf / text.length, g5: g5 / text.length },
    requirements: [
      req('R1', 'BGP routing', {
        quotes: ['BGP route reflectors'],
        start: bgp,
        end: bgp + 20,
        page: 1,
      }),
      req('R2', 'OSPF', {
        quotes: ['OSPF areas were split'],
        start: ospf,
        end: ospf + 21,
        page: 2,
      }),
      req('R3', '5G transport experience', {
        quotes: ['5G transport rollout'],
        start: g5,
        end: g5 + 20,
        page: 2,
      }),
      req('R4', 'CCIE certification', { state: 'missing', notFound: true }),
    ],
  };
}

/** Aysel's CV text with two pages (FS-20). */
export const AYSEL_TEXT = (() => {
  const p1 =
    'Aysel Məmmədova\nSenior Network Engineer · IP Core & Transport\n\nTen years designing and running carrier IP networks. Led the BGP and OSPF redesign of a national mobile backbone and the 5G transport rollout across three regions.\n\nRedesigned the IP core with BGP route reflectors and OSPF areas.\n';
  const p2 =
    'Projects\n5G transport rollout, Program lead, 2021 – 2023.\nBackbone BGP redesign, Architect.\n';
  return { text: p1 + p2, truncated: false, pageStarts: [0, p1.length], blocks: [] };
})();

/** The dense-skills CV (DID12): eight requirements quoting the eight lines 2 pt apart. */
export const DENSE_LINES = [
  'BGP routing',
  'OSPF areas',
  'Kubernetes clusters',
  'Python scripting',
  'MPLS core',
  'Segment routing',
  'Ansible automation',
  'IS-IS design',
];
export function denseDoc() {
  const reqs = DENSE_LINES.map((s, i) =>
    req(`D${i + 1}`, s, {
      state: i % 3 === 1 ? 'partly' : 'matched',
      quotes: [`${s} in production since 2018.`],
      page: 1,
    }),
  );
  return {
    ...clone(BASE_DOC),
    documentId: DID12,
    filename: 'dense-skills.pdf',
    name: 'Dense Skills Person',
    analysis: {
      ...analysis(DID12, MID, 'Dense Skills Person', 90),
      requirements: reqs,
      mustFound: 8,
      mustTotal: 8,
    },
  };
}

/** A PDF problem CV (DID13 locked, DID14 broken): text available. */
export function problemDoc(id: string, filename: string) {
  return {
    ...clone(BASE_DOC),
    documentId: id,
    filename,
    analysis: { ...clone(BASE_DOC.analysis), documentId: id },
  };
}

// ------------------------------------------------------------------ the mock

type Answer = object | ((n: number) => object | Promise<object>);
export interface FOpts {
  /** Review data by document id (replaces or adds to DOCS); a function gets the call count (1, 2…). */
  docs?: Record<string, Answer | { status: number; json: object; delay?: number }>;
  /** /documents/:id/text answers. */
  text?: Record<string, object | { status: number; json: object; delay?: number }>;
  /** /documents/:id/view answers: a PDF buffer, or an error. */
  view?: Record<string, Buffer | { status: number; json?: object; delay?: number; body?: Buffer }>;
  /** /documents/:id/file answers. */
  file?: Record<
    string,
    { body: Buffer; type: string; delay?: number } | { status: number; json: object }
  >;
  /** The PUT decision answer (default: the mock's own). */
  put?: (body: any, n: number) => { status: number; json: object } | null;
  assistant?: Record<string, unknown>;
  me?: Record<string, unknown>;
  total?: number;
  extra?: (route: Route, url: URL) => Promise<boolean> | boolean;
  /**
   * A decision store like the server's: PUT /candidates/:mid/decision checks expectedVersion (409
   * STALE_VERSION when it differs), adds a history entry, and GET /documents/:id shows the result.
   */
  live?: boolean;
  /** The view answer's delay (ms) for DID's pages. */
  viewDelay?: number;
}

export interface LiveDecision {
  mark: string;
  note: string | null;
  version: number;
  decidedAt: string | null;
  decidedBy: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** mockApi plus the documents, files and answers of this package. */
export async function mockF(
  page: Page,
  o: FOpts = {},
): Promise<
  Seen & {
    calls: Record<string, number>;
    store: Map<string, LiveDecision>;
    history: Map<string, any[]>;
  }
> {
  const calls: Record<string, number> = {};
  const store = new Map<string, LiveDecision>();
  const history = new Map<string, any[]>();
  const withLive = (doc: any) => {
    if (!o.live || !doc || typeof doc !== 'object' || !doc.matchId) return doc;
    const d = clone(doc);
    const cur = store.get(d.matchId);
    if (cur) {
      d.decision = { ...cur };
      if (d.analysis) d.analysis.decision = { ...cur };
    }
    if (d.analysis && history.has(d.matchId))
      d.analysis.history = [...history.get(d.matchId)!, ...(d.analysis.history ?? [])];
    return d;
  };
  const views: Record<
    string,
    Buffer | { status: number; json?: object; delay?: number; body?: Buffer }
  > = {
    [DID4]: PDF,
    [DID12]: FILES.densePdf(),
    [DID13]: FILES.protectedPdf(),
    [DID14]: FILES.brokenPdf(),
    [DID16]: { status: 404, json: { message: 'The original file is no longer available.' } },
    [DID17]: { status: 409, json: { message: 'The original cannot be shown as pages.' } },
    ...(o.view ?? {}),
  };
  const files: NonNullable<FOpts['file']> = {
    [DID]: { body: PDF, type: 'application/pdf' },
    [DID4]: {
      body: FILES.docx(),
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    [DID15]: {
      body: FILES.docx(),
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    ...(o.file ?? {}),
  };
  let puts = 0;
  const seen = await mockApi(page, {
    assistant: o.assistant,
    me: o.me as never,
    total: o.total,
    extra: async (route, url) => {
      if (o.extra && (await o.extra(route, url))) return true;
      const p = url.pathname;
      const method = route.request().method();
      const key = `${method} ${p}`;
      calls[key] = (calls[key] ?? 0) + 1;
      const n = calls[key]!;
      if (o.put && method === 'PUT' && /^\/candidates\/\w{26}\/decision$/.test(p)) {
        const r = o.put(route.request().postDataJSON(), ++puts);
        if (r) {
          await route.fulfill({ status: r.status, json: r.json });
          return true;
        }
        if (!o.live) return false;
      }
      const putM = /^\/candidates\/(\w{26})\/decision$/.exec(p);
      if (o.live && putM && method === 'PUT') {
        const mid = putM[1]!;
        const body = route.request().postDataJSON() as {
          mark: string;
          note: string | null;
          expectedVersion: number;
        };
        const cur = store.get(mid) ?? {
          mark: 'new',
          note: null,
          version: 0,
          decidedAt: null,
          decidedBy: null,
        };
        if (body.expectedVersion !== cur.version) {
          await route.fulfill({
            status: 409,
            json: {
              message: 'Someone else changed this decision. The latest is shown.',
              code: 'STALE_VERSION',
            },
          });
          return true;
        }
        const next = {
          mark: body.mark,
          note: body.note ?? null,
          version: cur.version + 1,
          decidedAt: new Date().toISOString(),
          decidedBy: 'Ayla Karimova',
        };
        store.set(mid, next);
        history.set(mid, [
          { mark: next.mark, by: next.decidedBy, at: next.decidedAt, note: next.note },
          ...(history.get(mid) ?? []),
        ]);
        await route.fulfill({
          json: {
            mark: next.mark,
            note: next.note,
            version: next.version,
            previous: { mark: cur.mark, note: cur.note, version: cur.version },
          },
        });
        return true;
      }
      const m = /^\/documents\/(\w{26})(?:\/(view|text|file))?$/.exec(p);
      if (!m || method !== 'GET') return false;
      const [, id, part] = m as unknown as [string, string, string | undefined];
      if (!part && o.docs?.[id] !== undefined) {
        const a = o.docs[id]!;
        const v = typeof a === 'function' ? await (a as (n: number) => object)(n) : a;
        if (
          v &&
          typeof v === 'object' &&
          'status' in v &&
          'json' in v &&
          typeof (v as any).status === 'number'
        ) {
          const e = v as { status: number; json: object; delay?: number };
          if (e.delay) await sleep(e.delay);
          await route.fulfill({ status: e.status, json: e.json });
        } else await route.fulfill({ json: withLive(v) });
        return true;
      }
      if (!part && o.live && DOCS[id]) {
        await route.fulfill({ json: withLive(DOCS[id]) });
        return true;
      }
      if (part === 'view' && id === DID && o.viewDelay) {
        await sleep(o.viewDelay);
        await route.fulfill({ body: PDF, contentType: 'application/pdf' });
        return true;
      }
      if (part === 'text' && o.text?.[id]) {
        const v = o.text[id] as any;
        if (typeof v.status === 'number' && v.json) {
          if (v.delay) await sleep(v.delay);
          await route.fulfill({ status: v.status, json: v.json });
        } else await route.fulfill({ json: v });
        return true;
      }
      if (part === 'view' && views[id]) {
        const v = views[id]!;
        if (Buffer.isBuffer(v)) await route.fulfill({ body: v, contentType: 'application/pdf' });
        else {
          if (v.delay) await sleep(v.delay);
          if (v.body)
            await route.fulfill({ status: v.status, body: v.body, contentType: 'application/pdf' });
          else await route.fulfill({ status: v.status, json: v.json ?? {} });
        }
        return true;
      }
      if (part === 'file' && files[id]) {
        const f = files[id]! as any;
        if (f.body) {
          if (f.delay) await sleep(f.delay);
          await route.fulfill({ body: f.body, contentType: f.type });
        } else await route.fulfill({ status: f.status, json: f.json });
        return true;
      }
      return false;
    },
  });
  return Object.assign(seen, { calls, store, history });
}

/** The review list of the two CVs, stored before the page loads (like openReview, without goto). */
export async function storeList(
  page: Page,
  ids = [DID, DID2],
  back = '/candidates',
  label = 'Candidates',
) {
  await page.addInitScript(
    ([a, b, l]) =>
      sessionStorage.setItem(
        'cv-review-lists',
        JSON.stringify([{ id: 'e2e-list', ids: a, back: b, label: l, savedAt: Date.now() }]),
      ),
    [ids, back, label] as const,
  );
}

// ------------------------------------------------------------------ waiting

/**
 * Number of dark, opaque pixels sampled from a canvas (more than 50 means the page is drawn). A blank
 * canvas is transparent black (0,0,0,0), so only opaque pixels count: pdf.js paints a white page.
 */
export async function ink(c: Locator): Promise<number> {
  return c.evaluate((el: HTMLCanvasElement) => {
    if (!el.width || !el.height) return 0;
    const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3]! > 200 && d[i]! < 200) n++;
    return n;
  });
}

/**
 * Wait until the review has loaded and (for a PDF) the pages are there and page 1 is drawn. Pages are
 * drawn when they come into view of the box that scrolls them (PdfPages.tsx:129-140), so a page below
 * the fold of the pane is not waited for.
 */
export async function ready(page: Page, pages = 2, minInk = 50) {
  await page.locator('h1').first().waitFor();
  if (!pages) return;
  await page.locator(`[data-page="${pages}"]`).waitFor({ state: 'attached', timeout: 15_000 });
  const c = page.locator('[data-page="1"] canvas');
  await expectPoll(
    () => ink(c),
    (v) => v > minInk,
    15_000,
    'page 1 drawn',
  );
}

/** Non-ignored nodes of Chromium's own accessibility tree with this name (role optional). */
export async function axCount(page: Page, name: string | RegExp, role?: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored: boolean; name?: { value?: string }; role?: { value?: string } }[];
    };
    return nodes.filter((n) => {
      if (n.ignored) return false;
      const v = String(n.name?.value ?? '');
      const ok = typeof name === 'string' ? v === name : name.test(v);
      return ok && (!role || n.role?.value === role);
    }).length;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** Wait until no finite animation is still running (infinite sheens are ignored). */
export async function settle(page: Page, timeout = 5_000) {
  await expectPoll(
    () =>
      page.evaluate(
        () =>
          document.getAnimations().filter((a) => {
            const end = a.effect?.getComputedTiming().endTime;
            return a.playState === 'running' && end !== Infinity;
          }).length,
      ),
    (v) => v === 0,
    timeout,
    'animations finished',
  );
}

async function expectPoll<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeout: number,
  what: string,
) {
  const end = Date.now() + timeout;
  let last: T | undefined;
  while (Date.now() < end) {
    last = await fn();
    if (ok(last)) return last;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what} (last value ${JSON.stringify(last)})`);
}
export const poll = expectPoll;

/** On narrow screens: press the 'Analysis' tab of the 'View' control when it is shown. */
export async function toAnalysis(page: Page, t: ReturnType<typeof T>) {
  const tab = page
    .getByRole('tablist', { name: t('View'), exact: true })
    .getByRole('tab', { name: t('Analysis') });
  if (await tab.isVisible()) await tab.click();
}
export async function isTabs(page: Page, t: ReturnType<typeof T>) {
  return page.getByRole('tablist', { name: t('View'), exact: true }).isVisible();
}
/** Press 'Show in CV' on a requirement card (switching to Analysis first on narrow screens). */
export async function showReq(page: Page, t: ReturnType<typeof T>, text: string) {
  await toAnalysis(page, t);
  const card = page
    .locator('[data-testid=analysis-pane] li')
    .filter({ has: page.getByText(text, { exact: true }) });
  await card.getByRole('button', { name: t('Show in CV') }).click();
}
export const card = (page: Page, text: string) =>
  page
    .locator('[data-testid=analysis-pane] li')
    .filter({ has: page.getByText(text, { exact: true }) });

// ------------------------------------------------------------------ probes

/**
 * The full-screen viewer: since the rewrite the CV pane is a <dialog> (role region 'CV' in the page);
 * full screen opens that same element with showModal() (implicit role dialog, aria-modal, top layer).
 */
export const FULL = 'dialog[aria-modal="true"]';

export interface Hit {
  x: number;
  y: number;
  inside: boolean;
  /** What took the point: dialog, analysis-li, app-header, review-bar, rail, assistant, phone-nav, other. */
  what: string;
  tag: string;
}

/**
 * elementFromPoint at the given points (default: the centres of a cols×rows grid over the window),
 * each classified against the full-screen dialog and the layers that are known to cover it.
 */
export async function probe(
  page: Page,
  o: { cols?: number; rows?: number; points?: { x: number; y: number }[] } = {},
) {
  return page.evaluate(
    ({ cols, rows, points, full }) => {
      const dlg = document.querySelector(full);
      const header = [...document.querySelectorAll('header')].find(
        (h) => (h as HTMLElement).style.viewTransitionName === 'app-header',
      );
      const rail = [...document.querySelectorAll('nav')].find(
        (n) => (n as HTMLElement).style.viewTransitionName === 'app-rail',
      );
      const bar = document.querySelector('nav')?.ownerDocument.querySelector('div.md\\:sticky');
      // The phone bars: nav 'Main' (fixed at the bottom) and the review's 'Previous and next' bar
      // (fixed above it, bottom: var(--bottombar-h)).
      const phoneBars = [...document.querySelectorAll('nav')]
        .map((n) => n.closest('div.fixed, nav.fixed'))
        .filter((x): x is Element => !!x);
      const assistant = document.querySelector('aside');
      const pts =
        points ??
        Array.from({ length: cols * rows }, (_, k) => ({
          x: ((k % cols) + 0.5) * (innerWidth / cols),
          y: (Math.floor(k / cols) + 0.5) * (innerHeight / rows),
        }));
      return pts.map(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const inside = !!(dlg && el && dlg.contains(el));
        let what = 'other';
        if (inside) what = 'dialog';
        else if (el?.closest('[data-testid=analysis-pane] li')) what = 'analysis-li';
        else if (el?.closest('[data-testid=analysis-pane]')) what = 'analysis-pane';
        else if (header && el && header.contains(el)) what = 'app-header';
        else if (bar && el && bar.contains(el)) what = 'review-bar';
        else if (rail && el && rail.contains(el)) what = 'rail';
        else if (assistant && el && assistant.contains(el)) what = 'assistant';
        else if (el && phoneBars.some((b) => b.contains(el))) what = 'phone-bar';
        else if (el?.closest('main')) what = 'page-behind';
        return {
          x: Math.round(x),
          y: Math.round(y),
          inside,
          what,
          tag: el ? el.tagName.toLowerCase() : 'none',
        };
      });
    },
    { cols: o.cols ?? 12, rows: o.rows ?? 8, points: o.points ?? null, full: FULL },
  );
}
export const summary = (hits: Hit[]) =>
  hits.reduce<Record<string, number>>((m, h) => ((m[h.what] = (m[h.what] ?? 0) + 1), m), {});

/** The full-screen dialog's box against the window. */
export async function dialogBox(page: Page) {
  return page.evaluate((full) => {
    const d = document.querySelector(full);
    const r = d?.getBoundingClientRect();
    return {
      found: !!d,
      modal: d?.getAttribute('aria-modal') ?? null,
      left: r?.left ?? -1,
      top: r?.top ?? -1,
      width: r?.width ?? -1,
      height: r?.height ?? -1,
      innerWidth,
      innerHeight,
    };
  }, FULL);
}

/** Is the element at a locator's centre the locator itself (or inside it)? */
export async function topAt(l: Locator) {
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      ok: !!hit && (el === hit || el.contains(hit)),
      hit: hit
        ? `${hit.tagName.toLowerCase()} "${(hit.textContent ?? '').trim().slice(0, 40)}"`
        : 'none',
      box: {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      },
      inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    };
  });
}

/** Overlap area of two boxes as a share of the first one. */
export function overlapShare(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / (a.width * a.height) : 0;
}

/** Boxes of the pdf.js text items that hold a quote on a page (for "the mark is on the line"). */
export async function lineBoxes(page: Page, pageNo: number, words: string) {
  // The canvas is drawn from the same text layer the marks are computed from; the marks are
  // compared with the quote's position worked out independently from the page's own geometry.
  return page.evaluate(
    ({ pageNo, words }) => {
      const box = document.querySelector(`[data-page="${pageNo}"]`)!.getBoundingClientRect();
      const marks = [
        ...document.querySelectorAll(`[data-page="${pageNo}"] [data-testid=pdf-mark]`),
      ].map((m) => {
        const r = m.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      });
      return {
        page: { x: box.left, y: box.top, width: box.width, height: box.height },
        marks,
        words,
      };
    },
    { pageNo, words },
  );
}

// ------------------------------------------------------------------ evidence map boxes (FS-10, EM-05)

/** Boxes of the evidence strip, its dots, cv-body (with its scrollbar) and page 1. */
export async function mapBoxes(page: Page) {
  return page.evaluate(() => {
    const r = (e: Element | null) => {
      const b = e?.getBoundingClientRect();
      return b
        ? {
            left: b.left,
            right: b.right,
            top: b.top,
            bottom: b.bottom,
            width: b.width,
            height: b.height,
          }
        : null;
    };
    const nav = document.querySelector('[data-testid=evidence-map]');
    const body = document.querySelector<HTMLElement>('[data-testid=cv-body]');
    const dots = [...(nav?.querySelectorAll('button') ?? [])].map((b) => {
      const box = r(b)!;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        name: b.getAttribute('aria-label') ?? '',
        box,
        own: !!hit && (hit === b || b.contains(hit)),
        text: b.textContent?.trim() ?? '',
      };
    });
    const bb = r(body);
    const scrollbar =
      body && bb
        ? {
            left: bb.left + body.clientWidth,
            right: bb.left + body.offsetWidth,
            width: body.offsetWidth - body.clientWidth,
          }
        : null;
    return {
      nav: r(nav),
      body: bb,
      scrollbar,
      page1: r(document.querySelector('[data-page="1"]')),
      divider: r(document.querySelector('[role=separator]')),
      analysis: r(document.querySelector('[data-testid=analysis-pane]')),
      dots,
      innerWidth,
      innerHeight,
    };
  });
}
type Boxes = Awaited<ReturnType<typeof mapBoxes>>;
type B = NonNullable<Boxes['nav']>;
const overlaps = (
  a: B | null,
  b: { left: number; right: number; top?: number; bottom?: number } | null,
  tol = 0,
) =>
  !!a &&
  !!b &&
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > tol &&
  (b.top === undefined || Math.min(a.bottom, b.bottom!) - Math.max(a.top, b.top) > tol);

/** The dense-dot checks shared by FS-10 (full screen) and EM-05 (normal pane). */
export async function denseChecks(
  page: Page,
  info: any,
  label: string,
  o: { viewport: boolean; pane: boolean },
) {
  const m = await mapBoxes(page);
  await info.attach(`${label}: strip, dots and boxes`, {
    body: JSON.stringify(m, null, 1),
    contentType: 'application/json',
  });
  expect(m.nav, 'the evidence map shows').not.toBeNull();
  const nav = m.nav!;
  for (const d of m.dots) {
    expect
      .soft(d.box.left, `${label}: '${d.name}' left ≥ strip left − 1`)
      .toBeGreaterThanOrEqual(nav.left - 1);
    expect
      .soft(d.box.right, `${label}: '${d.name}' right ≤ strip right + 1`)
      .toBeLessThanOrEqual(nav.right + 1);
    if (o.viewport) {
      expect
        .soft(
          d.box.left >= 0 && d.box.right <= m.innerWidth,
          `${label}: '${d.name}' inside the viewport`,
        )
        .toBe(true);
    }
    expect.soft(overlaps(d.box, m.page1), `${label}: '${d.name}' overlaps the page`).toBe(false);
    if (m.scrollbar && m.scrollbar.width > 0)
      expect
        .soft(
          overlaps(d.box, {
            left: m.scrollbar.left,
            right: m.scrollbar.right,
            top: m.body!.top,
            bottom: m.body!.bottom,
          }),
          `${label}: '${d.name}' overlaps the cv-body scrollbar`,
        )
        .toBe(false);
    if (o.pane) {
      expect.soft(overlaps(d.box, m.body), `${label}: '${d.name}' overlaps cv-body`).toBe(false);
      expect
        .soft(overlaps(d.box, m.divider), `${label}: '${d.name}' overlaps the divider`)
        .toBe(false);
      expect
        .soft(overlaps(d.box, m.analysis), `${label}: '${d.name}' overlaps the analysis pane`)
        .toBe(false);
    }
    expect.soft(d.own, `${label}: elementFromPoint at '${d.name}' returns its own dot`).toBe(true);
  }
  // A cluster: either the dots overlap each other by at most 2 px, or one marker carries the count.
  const merged = m.dots.length === 1 && /8/.test(m.dots[0]!.text + m.dots[0]!.name);
  if (!merged) {
    let worst = 0;
    for (let i = 0; i < m.dots.length; i++)
      for (let j = i + 1; j < m.dots.length; j++) {
        const a = m.dots[i]!.box;
        const b = m.dots[j]!.box;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 0 && h > 0) worst = Math.max(worst, Math.min(w, h));
      }
    expect
      .soft(worst, `${label}: dots of the cluster overlap each other by at most 2 px`)
      .toBeLessThanOrEqual(2);
  }
  // All 8 requirements reachable by keyboard.
  const names = m.dots.map((d) => d.name).join(' | ');
  for (const s of DENSE_LINES)
    expect.soft(names, `${label}: '${s}' is reachable in the map`).toContain(s);
  const first = page.getByTestId('evidence-map').getByRole('button').first();
  await first.focus();
  const reached = new Set<string>();
  for (let i = 0; i < m.dots.length; i++) {
    reached.add(
      await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''),
    );
    await page.keyboard.press('Tab');
  }
  for (const s of DENSE_LINES)
    expect
      .soft(
        [...reached].some((r) => r.includes(s)),
        `${label}: '${s}' is reached with Tab`,
      )
      .toBe(true);
  return m;
}
