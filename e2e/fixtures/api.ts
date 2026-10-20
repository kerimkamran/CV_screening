import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';

/**
 * A small stand-in for the API, enough for the review screen, the candidate list and downloads.
 * Every person and company here is invented.
 */
export const VID = '01K0000000000000000000000V';
export const DID = '01K0000000000000000000000D';
export const DID2 = '01K0000000000000000000000E';
export const DID3 = '01K0000000000000000000000F';
export const MID = '01K0000000000000000000000M';
export const MID2 = '01K0000000000000000000000N';
export const PDF = readFileSync(new URL('./cv.pdf', import.meta.url));

const ME = {
  userId: '01K000000000000000000000AB',
  displayName: 'Ayla Karimova',
  email: 'ayla@example.az',
  roles: ['TA_PARTNER'],
};
const vacancy = { id: VID, title: 'Network Engineer', status: 'open', archived: false };
const req = (id: string, text: string, state: string, page: number | null, quote: string) => ({
  requirementId: id,
  text,
  kind: 'must',
  state,
  unclear: false,
  notFound: state === 'missing',
  confidence: 'high',
  rationale: 'Stated in the work history with dates.',
  anchors: state === 'missing' ? [] : [{ start: 0, end: 10, quote, page, block: 0 }],
});
const decision = { mark: 'new', note: null, version: 0, decidedAt: null, decidedBy: null };
const analysis = (documentId: string, matchId: string, name: string, score: number) => ({
  matchId,
  documentId,
  label: name,
  name,
  pseudonym: 'Candidate 01',
  email: null,
  filename: 'cv.pdf',
  vacancy,
  score,
  band: score >= 75 ? 'strong' : 'possible',
  mustFound: 3,
  mustTotal: 4,
  summary: 'Ten years of carrier network design.',
  analyzedAt: new Date().toISOString(),
  outOfDate: null,
  reanalyzing: false,
  decision,
  history: [],
  requirements: [
    req('R1', 'BGP routing', 'matched', 1, 'BGP route reflectors'),
    req('R2', 'OSPF', 'matched', 1, 'OSPF areas'),
    req('R3', '5G transport experience', 'matched', 2, '5G transport rollout'),
    req('R4', 'CCIE certification', 'missing', null, ''),
  ],
});
export const DOCS: Record<string, object> = {
  [DID]: {
    documentId: DID,
    vacancy,
    filename: 'aysel.pdf',
    kind: 'pdf',
    sizeBytes: PDF.length,
    uploadedAt: '2026-10-08T09:00:00Z',
    name: 'Aysel Məmmədova',
    pseudonym: 'Candidate 01',
    pseudonymNo: 1,
    status: 'analyzed',
    statusDetail: {},
    screeningId: MID,
    matchId: MID,
    original: { available: true, view: 'pdf' },
    text: { available: true },
    decision,
    analysis: analysis(DID, MID, 'Aysel Məmmədova', 88),
  },
  [DID2]: {
    documentId: DID2,
    vacancy,
    filename: 'rauf.txt',
    kind: 'txt',
    sizeBytes: 400,
    uploadedAt: '2026-10-08T09:01:00Z',
    name: 'Rauf Əliyev',
    pseudonym: 'Candidate 02',
    pseudonymNo: 2,
    status: 'analyzed',
    statusDetail: {},
    screeningId: MID2,
    matchId: MID2,
    original: { available: true, view: 'none' },
    text: { available: true },
    decision,
    analysis: analysis(DID2, MID2, 'Rauf Əliyev', 71),
  },
};
const TEXT = {
  text: 'Rauf Əliyev\nNetwork Engineer, Bakı\n\nBGP route reflectors and OSPF areas across a carrier backbone.\n\n5G transport rollout, 2021 to 2023.',
  truncated: false,
  pageStarts: [0],
  blocks: [],
};
const row = (
  documentId: string,
  matchId: string,
  label: string,
  score: number,
  ordinal: number,
) => ({
  documentId,
  vacancyId: VID,
  vacancyTitle: 'Network Engineer',
  vacancyStatus: 'open',
  vacancyArchived: false,
  pseudonym: `Candidate 0${ordinal}`,
  label,
  name: label,
  ordinal,
  matchId,
  score,
  band: score >= 75 ? 'strong' : 'possible',
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
  analyzedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
export const ROWS = [
  row(DID, MID, 'Aysel Məmmədova', 88, 1),
  row(DID2, MID2, 'Rauf Əliyev', 71, 2),
];

export interface Seen {
  posts: { url: string; body: unknown }[];
}

/** Signs in (the session lives in this tab only) and answers the API. */
export async function mockApi(
  page: Page,
  opts: {
    signedIn?: boolean;
    total?: number;
    extra?: (route: Route, url: URL) => Promise<boolean> | boolean;
  } = {},
): Promise<Seen> {
  const seen: Seen = { posts: [] };
  const signedIn = opts.signedIn ?? true;
  if (signedIn) await page.addInitScript(() => sessionStorage.setItem('cv.session', 'e2e-token'));
  await page.route(
    (u) => !(u.pathname === '/' || u.pathname.startsWith('/assets/') || u.pathname === '/healthz'),
    async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
      if (route.request().method() === 'POST')
        seen.posts.push({ url: p, body: route.request().postDataJSON() as unknown });
      if (opts.extra && (await opts.extra(route, url))) return;
      if (p === '/me') return signedIn ? json(ME) : json({ message: 'Sign in' }, 401);
      if (p === '/readyz') return json({ status: 'ok' });
      if (p === '/assistant/config') return json({ enabled: false });
      if (p === '/vacancies') return json([]);
      if (p === `/documents/${DID}/view`)
        return route.fulfill({ body: PDF, contentType: 'application/pdf' });
      if (p.endsWith('/text')) return json(TEXT);
      const doc = /^\/documents\/(\w{26})$/.exec(p);
      if (doc && DOCS[doc[1]!]) return json(DOCS[doc[1]!]);
      if (p === '/candidates/ids')
        return json({
          items: [
            [DID, MID],
            [DID2, MID2],
            [DID3, null],
          ].slice(0, opts.total ?? 2),
          total: opts.total ?? 2,
          truncated: false,
        });
      if (p === '/candidates')
        return json({
          rows: ROWS,
          total: opts.total ?? 2,
          counts: {
            byMark: { new: 2, shortlist: 0, maybe: 0, not_now: 0 },
            outOfDate: 0,
            strong: 1,
          },
          nextCursor: (opts.total ?? 2) > 2 ? 'next' : null,
          asOf: new Date().toISOString(),
        });
      return json({ message: 'Not answered by the test', path: p }, 404);
    },
  );
  return seen;
}

/** Collects Content-Security-Policy violations and page errors while a test runs. */
export function watchProblems(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text()))
      out.push(m.text());
  });
  page.on('pageerror', (e) => out.push(e.message));
  return out;
}

/** Opens a CV with both test CVs behind Previous and Next. */
export async function openReview(page: Page, documentId = DID) {
  await page.addInitScript(
    ([a, b]) =>
      sessionStorage.setItem(
        'cv-review-lists',
        JSON.stringify([
          {
            id: 'e2e-list',
            ids: [a, b],
            back: '/candidates',
            label: 'Candidates',
            savedAt: Date.now(),
          },
        ]),
      ),
    [DID, DID2],
  );
  await page.goto(`/#/cv/${documentId}?l=e2e-list`);
}

/** On narrow screens the CV and the analysis are two tabs: show the analysis. */
export async function showAnalysis(page: Page) {
  const tab = page.getByRole('tab', { name: 'Analysis' });
  if (await tab.isVisible()) await tab.click();
}
