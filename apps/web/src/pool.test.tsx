import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { session } from './api';
import { rememberUser, resetAssistantConfigCache, setAssistantOpen } from './assistant';
import { resetReviewCacheForTests } from './pages/CvReview';

type Reply = { status?: number; body: unknown };
type Handler = (url: string, init?: RequestInit) => Reply | undefined;
function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = handler(url, init) ?? { body: [] };
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}
const isGet = (init?: RequestInit) => !init?.method || init.method === 'GET';
const up = async () => ({ state: 'up' as const });
const ME = { userId: 'u', displayName: 'Ayla Karimova', email: 'a@x.az', roles: ['TA_PARTNER'] };
const VID = '0'.repeat(25) + 'V';
const MID = '0'.repeat(25) + 'M';
const MID2 = '0'.repeat(25) + 'N';
const DID = '0'.repeat(25) + 'D';
const DID2 = '0'.repeat(25) + 'E';
/** What GET /documents/:id answers for a CV that is a plain text file (no pages to load in a test). */
const reviewDoc = (analysis: Record<string, unknown> | null, over: object = {}) => ({
  documentId: DID,
  vacancy: { id: VID, title: 'Network Engineer', status: 'open', archived: false },
  filename: 'aysel.txt',
  kind: 'txt',
  sizeBytes: 1200,
  uploadedAt: '2026-10-08T09:00:00Z',
  name: 'Aysel Mammadova',
  pseudonym: 'Candidate 01',
  pseudonymNo: 1,
  status: analysis ? 'analyzed' : 'unreadable',
  statusDetail: { retryable: false },
  screeningId: MID,
  matchId: analysis ? MID : null,
  original: { available: true, view: 'none' },
  text: { available: true },
  decision: (analysis?.decision as object) ?? {
    mark: 'new',
    note: null,
    version: 0,
    decidedAt: null,
    decidedBy: null,
  },
  analysis,
  ...over,
});
const SENAI = {
  enabled: true,
  name: 'SenAI',
  features: { challenge: true, compare: true, interview: true, challengeRecruiter: true },
  unavailableMessage: 'SenAI is unavailable.',
};

const listItem = (over: object = {}) => ({
  id: VID,
  title: 'Network Engineer',
  department: 'IT',
  location: 'Baku',
  status: 'open',
  archived: false,
  owner: { id: 'u', name: 'Ayla Karimova' },
  canEdit: true,
  documents: 4,
  analyzed: 4,
  outOfDate: 0,
  strong: 2,
  decisions: { shortlist: 1, maybe: 1, notNow: 0 },
  running: 0,
  stopped: 0,
  version: 3,
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  ...over,
});
const view = (over: object = {}) => ({
  id: VID,
  title: 'Network Engineer',
  status: 'open',
  archived: false,
  department: null,
  location: null,
  experienceRange: 'any',
  openings: null,
  closingDate: null,
  hiringManager: null,
  notes: null,
  description: 'We need BGP and Kubernetes.',
  sourceType: 'typed',
  sourceFileName: null,
  link: null,
  requirementsVersion: 1,
  version: 3,
  owner: { id: 'u', name: 'Ayla Karimova' },
  canEdit: true,
  candidateNoticeConfirmedAt: null,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  updatedBy: 'Ayla Karimova',
  requirements: [
    { id: 'R1', text: 'BGP routing', classification: 'mandatory', weight: 10 },
    { id: 'R2', text: 'Python', classification: 'preferred', weight: 5 },
  ],
  hasDraft: true,
  hasFrozen: false,
  counts: {
    documents: 0,
    analyzed: 0,
    outOfDate: 0,
    strong: 0,
    running: 0,
    stopped: 0,
    failed: 0,
    needsLook: 0,
  },
  ...over,
});
const poolRow = (n: number, over: object = {}) => ({
  documentId: n === 1 ? DID : DID2,
  vacancyId: VID,
  vacancyTitle: 'Network Engineer',
  vacancyStatus: 'open',
  vacancyArchived: false,
  pseudonym: `Candidate 0${n}`,
  label: n === 1 ? 'Aysel Mammadova' : 'Rashad Aliyev',
  name: n === 1 ? 'Aysel Mammadova' : 'Rashad Aliyev',
  ordinal: n,
  matchId: n === 1 ? MID : MID2,
  score: n === 1 ? 88 : 61,
  band: n === 1 ? 'strong' : 'good',
  mustFound: n === 1 ? 2 : 1,
  mustTotal: 2,
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
  ...over,
});
const page = (rows: object[], over: object = {}) => ({
  rows,
  total: rows.length,
  counts: {
    byMark: { new: rows.length, shortlist: 0, maybe: 0, not_now: 0 },
    outOfDate: 0,
    strong: 1,
  },
  nextCursor: null,
  asOf: '2026-10-08T09:00:00Z',
  ...over,
});

beforeEach(() => {
  session.set('t');
  window.location.hash = '';
  localStorage.clear();
  sessionStorage.clear();
  resetReviewCacheForTests();
  resetAssistantConfigCache();
  rememberUser('U1');
  setAssistantOpen(false);
});
afterEach(() => vi.unstubAllGlobals());

const base =
  (extra: Handler): Handler =>
  (url, init) => {
    const e = extra(url, init);
    if (e) return e;
    if (url.endsWith('/me')) return { body: ME };
    if (url.endsWith('/assistant/config')) return { body: { enabled: false } };
    return undefined;
  };

describe('Vacancy pool', () => {
  it('shows the empty state with the first-vacancy prompt', async () => {
    mockFetch(base((url) => (url.includes('/vacancies?') ? { body: [] } : undefined)));
    render(<App check={up} />);
    expect(await screen.findByText('No vacancies yet. Add the first one.')).toBeInTheDocument();
  });

  it('filters by status chip and archives with a ten-second Undo', async () => {
    let archived = false;
    const calls = mockFetch(
      base((url, init) => {
        if (url.includes('/vacancies?')) return { body: archived ? [] : [listItem()] };
        if (url.endsWith(`/vacancies/${VID}/archive`)) return ((archived = true), { body: {} });
        if (url.endsWith(`/vacancies/${VID}/restore`)) return ((archived = false), { body: {} });
        void init;
        return undefined;
      }),
    );
    render(<App check={up} />);
    expect(await screen.findByRole('link', { name: 'Network Engineer' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'On hold' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('status=on_hold'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.click(screen.getByLabelText('Actions for Network Engineer'));
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/Archived “Network Engineer”/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(archived).toBe(false));
  });

  it('asks to use a similar vacancy before creating a new one', async () => {
    window.location.hash = '/vacancies/new';
    const calls = mockFetch(
      base((url, init) => {
        if (url.includes('/vacancies/similar'))
          return {
            body: [
              {
                id: VID,
                title: 'Network Engineer',
                status: 'open',
                ownerName: 'Ayla',
                documents: 4,
              },
            ],
          };
        if (url.endsWith('/vacancies') && init?.method === 'POST') return { body: { id: VID } };
        if (url.endsWith(`/vacancies/${VID}`) && isGet(init)) return { body: view({ version: 1 }) };
        return undefined;
      }),
    );
    render(<App check={up} />);
    await userEvent.type(await screen.findByLabelText('Position'), 'Network engineer');
    await userEvent.click(screen.getByRole('button', { name: 'Create vacancy' }));
    const prompt = await screen.findByText(/already in the system/);
    expect(prompt).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Network Engineer' })).toHaveAttribute(
      'href',
      `#/vacancies/${VID}`,
    );
    expect(calls.some((c) => c.init?.method === 'POST' && c.url.endsWith('/vacancies'))).toBe(
      false,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create a new one anyway' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create vacancy' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/vacancies/${VID}`));
    const post = calls.find((c) => c.init?.method === 'POST' && c.url.endsWith('/vacancies'))!;
    expect(post.body).toEqual({ title: 'Network engineer' });
  });
});

describe('Role card', () => {
  const open = (extra: Handler) => {
    window.location.hash = `/vacancies/${VID}/runs`;
    return mockFetch(
      base((url, init) => {
        const e = extra(url, init);
        if (e) return e;
        if (url.endsWith(`/vacancies/${VID}`) && isGet(init)) return { body: view() };
        if (url.endsWith(`/vacancies/${VID}/runs`)) return { body: [] };
        return undefined;
      }),
    );
  };

  it('saves only what changed, with the version it was read at', async () => {
    const calls = open((url, init) =>
      init?.method === 'PATCH'
        ? { body: view({ version: 4, title: 'Network Engineer II' }) }
        : undefined,
    );
    render(<App check={up} />);
    const title = await screen.findByLabelText('Position');
    await userEvent.clear(title);
    await userEvent.type(title, 'Network Engineer II');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.init?.method === 'PATCH')!;
    expect(patch.body).toEqual({ expectedVersion: 3, title: 'Network Engineer II' });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it("shows the assistant's wording suggestions after a save, and they can be dismissed", async () => {
    open((url, init) => {
      if (init?.method === 'PATCH')
        return { body: view({ version: 4, title: 'Network Engineer II' }) };
      if (url.includes('/assistant/jd-coach/'))
        return {
          body: {
            headline: 'Network Engineer II: 1 thing to look at. Nothing was changed.',
            tips: ['"young" can keep some people from applying.'],
          },
        };
      return undefined;
    });
    render(<App check={up} />);
    const title = await screen.findByLabelText('Position');
    await userEvent.clear(title);
    await userEvent.type(title, 'Network Engineer II');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const box = await screen.findByRole('region', { name: 'Suggestions about the wording' });
    expect(within(box).getByText(/can keep some people from applying/)).toBeInTheDocument();
    await userEvent.click(within(box).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Suggestions about the wording' })).toBeNull();
  });

  it('says who changed the vacancy first when the version is old, and keeps the typing as a draft', async () => {
    open((url, init) =>
      init?.method === 'PATCH'
        ? {
            status: 409,
            body: {
              message: 'Changed by Rashad at 09:41. Reload to see their version.',
              code: 'STALE_VERSION',
            },
          }
        : undefined,
    );
    render(<App check={up} />);
    const title = await screen.findByLabelText('Position');
    await userEvent.type(title, ' II');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Changed by Rashad at 09:41/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reload their version' }));
    const saved = JSON.parse(localStorage.getItem(`cv-vacancy-draft:${VID}`) ?? '{}') as {
      form?: { title: string };
    };
    expect(saved.form?.title).toBe('Network Engineer II');
  });

  it('offers an unsaved draft from this browser and can restore it', async () => {
    localStorage.setItem(
      `cv-vacancy-draft:${VID}`,
      JSON.stringify({
        at: new Date().toISOString(),
        form: {
          title: 'Network Engineer (draft)',
          status: 'open',
          experience: 'any',
          text: 'We need BGP and Kubernetes.',
          department: '',
          location: '',
          openings: '',
          closingDate: '',
          hiringManager: '',
          notes: '',
          reqs: view().requirements,
          sourceType: 'typed',
          sourceFileName: '',
          linkUrl: '',
          linkHash: '',
        },
      }),
    );
    open(() => undefined);
    render(<App check={up} />);
    expect(await screen.findByText(/You have unsaved changes from/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore them' }));
    expect(screen.getByLabelText('Position')).toHaveValue('Network Engineer (draft)');
  });

  it('keeps the Resumes card closed to starting until the role is saved and has a skill', async () => {
    open(() => undefined);
    render(<App check={up} />);
    await screen.findByLabelText('Position');
    const title = screen.getByLabelText('Position');
    await userEvent.type(title, 'x');
    await userEvent.click(screen.getByRole('button', { name: /Find the best fit/ }));
    expect(await screen.findByText('Save the role first.')).toBeInTheDocument();
  });

  it('does not call a role unsaved because of a trailing space or blank line, so the scan can start', async () => {
    open(() => undefined);
    render(<App check={up} />);
    const text = await screen.findByRole('textbox', { name: /Requirements/ });
    await userEvent.type(text, '{Enter}  ');
    const title = screen.getByLabelText('Position');
    await userEvent.type(title, '  ');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.queryByText('Save the role first.')).toBeNull();
  });

  it('shows the saved text as saved after Save, even when it was typed with extra blank space', async () => {
    const calls = open((url, init) =>
      init?.method === 'PATCH'
        ? { body: view({ version: 4, description: 'We need BGP, OSPF and Kubernetes.' }) }
        : undefined,
    );
    render(<App check={up} />);
    const text = await screen.findByRole('textbox', { name: /Requirements/ });
    await userEvent.clear(text);
    await userEvent.type(text, 'We need BGP, OSPF and Kubernetes.{Enter}{Enter}  ');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('lets a person add a skill by hand when none were read', async () => {
    open((url, init) =>
      url.endsWith(`/vacancies/${VID}`) && isGet(init)
        ? { body: view({ requirements: [] }) }
        : undefined,
    );
    render(<App check={up} />);
    expect(await screen.findByText(/No skills yet/)).toBeInTheDocument();
    const add = screen.getByLabelText('Add another skill');
    await userEvent.type(add, 'English{Enter}');
    expect(await screen.findByRole('button', { name: /English, must-have/ })).toBeInTheDocument();
  });

  it('shows a read-only role to someone who is not the owner', async () => {
    open((url, init) =>
      url.endsWith(`/vacancies/${VID}`) && isGet(init)
        ? { body: view({ canEdit: false, owner: { id: 'x', name: 'Rashad' } }) }
        : undefined,
    );
    render(<App check={up} />);
    expect(
      await screen.findByText(/Only Rashad or a team lead can change this role/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Position')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('Candidate pool', () => {
  const open = (extra: Handler) => {
    window.location.hash = '/candidates';
    return mockFetch(
      base((url, init) => {
        const e = extra(url, init);
        if (e) return e;
        if (url.includes('/candidates?')) return { body: page([poolRow(1), poolRow(2)]) };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        return undefined;
      }),
    );
  };

  it('lists everyone with names, the match, must-haves and a decision pill', async () => {
    open(() => undefined);
    render(<App check={up} />);
    expect(await screen.findByRole('link', { name: 'Aysel Mammadova' })).toBeInTheDocument();
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Decision for Aysel Mammadova')).toHaveValue('new');
    expect(screen.getByText(/As of/)).toBeInTheDocument();
  });

  it('marks a candidate with the version it saw, and Undo puts the old mark back', async () => {
    const calls = open((url, init) =>
      init?.method === 'PUT'
        ? {
            body: {
              mark: String(init.body).includes('shortlist') ? 'shortlist' : 'new',
              note: null,
              version: String(init.body).includes('shortlist') ? 1 : 2,
              previous: { mark: 'new', note: null, version: 0 },
            },
          }
        : undefined,
    );
    render(<App check={up} />);
    await userEvent.selectOptions(
      await screen.findByLabelText('Decision for Aysel Mammadova'),
      'shortlist',
    );
    const first = await waitFor(() => {
      const c = calls.find((x) => x.init?.method === 'PUT');
      expect(c).toBeTruthy();
      return c!;
    });
    expect(first.url).toContain(`/candidates/${MID}/decision`);
    expect(first.body).toEqual({ mark: 'shortlist', expectedVersion: 0 });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(2));
    expect(calls.filter((c) => c.init?.method === 'PUT')[1]!.body).toMatchObject({
      mark: 'new',
      expectedVersion: 1,
    });
  });

  it('marks several at once and reports the ones that could not change', async () => {
    const calls = open((url) =>
      url.endsWith('/candidates/decisions')
        ? {
            body: {
              changed: 1,
              results: [
                {
                  matchId: MID,
                  ok: true,
                  version: 1,
                  previous: { mark: 'new', note: null, version: 0 },
                },
                {
                  matchId: MID2,
                  ok: false,
                  error: 'This vacancy is archived. Restore it to change marks.',
                },
              ],
            },
          }
        : undefined,
    );
    render(<App check={up} />);
    await userEvent.click(await screen.findByLabelText('Select Aysel Mammadova'));
    await userEvent.click(screen.getByLabelText('Select Rashad Aliyev'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Mark selected as'), 'maybe');
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/candidates/decisions'))).toBe(true),
    );
    expect(calls.find((c) => c.url.endsWith('/candidates/decisions'))!.body).toEqual({
      matchIds: [MID, MID2],
      mark: 'maybe',
    });
    expect(await screen.findByText(/1 could not be changed/)).toBeInTheDocument();
  });

  it('shows 50 at a time, and says plainly when the list was opened too long ago', async () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      poolRow(1, { documentId: `D${i}`, matchId: `M${i}`, label: `Person ${i}` }),
    );
    open((url) => {
      if (url.includes('cursor='))
        return {
          status: 410,
          body: { message: 'This list was opened a while ago. Reload it to continue.' },
        };
      if (url.includes('/candidates?'))
        return { body: page(rows, { total: 120, nextCursor: 'abc' }) };
      return undefined;
    });
    render(<App check={up} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show 50 more' }));
    expect(await screen.findByText(/opened a while ago/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
  });

  it('remembers the filters for this tab', async () => {
    const calls = open(() => undefined);
    const { unmount } = render(<App check={up} />);
    await userEvent.click(await screen.findByRole('button', { name: /^Strong$/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('band=strong'))).toBe(true));
    unmount();
    render(<App check={up} />);
    expect(await screen.findByRole('button', { name: /^Strong$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('offers the Excel export, and the Shortlist summary only once a vacancy is chosen', async () => {
    open((url) =>
      url.includes('/candidates/shortlist-summary')
        ? {
            body: {
              vacancy: { id: VID, title: 'Network Engineer' },
              count: 1,
              subject: 'Shortlist for Network Engineer (2026-10-08)',
              body: '1. Aysel Mammadova: 88%',
            },
          }
        : undefined,
    );
    render(<App check={up} />);
    await screen.findByRole('link', { name: 'Aysel Mammadova' });
    expect(screen.getByRole('button', { name: 'Shortlist summary' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText('Vacancy'), VID);
    await userEvent.click(await screen.findByRole('button', { name: 'Shortlist summary' }));
    expect(await screen.findByDisplayValue(/Aysel Mammadova: 88%/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent from here/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in e-mail' }).getAttribute('href')).toMatch(
      /^mailto:/,
    );
  });
});

describe('Candidate report', () => {
  const RESUME =
    'Aysel Mammadova\nNetwork engineer.\nDesigned BGP routing for a carrier core.\nUsed Python daily.';
  const start = RESUME.indexOf('Designed BGP');
  const report = {
    matchId: MID,
    documentId: DID,
    label: 'Aysel Mammadova',
    name: 'Aysel Mammadova',
    pseudonym: 'Candidate 01',
    email: 'aysel@example.com',
    filename: 'aysel.pdf',
    vacancy: { id: VID, title: 'Network Engineer', status: 'open', archived: false },
    score: 88,
    band: 'strong',
    mustFound: 2,
    mustTotal: 2,
    summary: 'Strong carrier-core background.',
    analyzedAt: new Date().toISOString(),
    outOfDate: null,
    reanalyzing: false,
    decision: { mark: 'new', note: null, version: 0, decidedAt: null, decidedBy: null },
    history: [],
    requirements: [
      {
        requirementId: 'R1',
        text: 'BGP routing',
        kind: 'must',
        state: 'matched',
        unclear: false,
        notFound: false,
        confidence: 'high',
        rationale: 'Designed BGP routing.',
        anchors: [
          {
            start,
            end: start + 25,
            os: start,
            oe: start + 25,
            quote: 'Designed BGP routing',
            page: 1,
            block: 2,
          },
        ],
      },
      {
        requirementId: 'R2',
        text: 'Kubernetes',
        kind: 'must',
        state: 'missing',
        unclear: false,
        notFound: true,
        confidence: 'high',
        rationale: 'Not in the resume.',
        anchors: [],
      },
    ],
  };
  const open = (extra?: Handler) => {
    window.location.hash = `/cv/${DID}?l=LIST1`;
    sessionStorage.setItem(
      'cv-review-lists',
      JSON.stringify([
        { id: 'LIST1', label: 'Candidates', back: '/candidates', ids: [DID, DID2], savedAt: 1 },
      ]),
    );
    return mockFetch(
      base((url, init) => {
        const e = extra?.(url, init);
        if (e) return e;
        if (url.endsWith(`/documents/${DID}`)) return { body: reviewDoc(report) };
        if (url.endsWith(`/documents/${DID2}`)) return { status: 404, body: { message: 'No.' } };
        if (url.includes(`/documents/${DID}/text`))
          return {
            body: { text: RESUME, truncated: false, pageStarts: [0], blocks: [] },
          };
        if (url.includes('/candidates?')) return { body: page([poolRow(1), poolRow(2)]) };
        return undefined;
      }),
    );
  };

  it('shows the match and the resume side by side, and highlights where a skill was found', async () => {
    open();
    render(<App check={up} />);
    expect(await screen.findByRole('heading', { name: 'Aysel Mammadova' })).toBeInTheDocument();
    const resume = await screen.findByLabelText('CV text', { selector: 'div' });
    expect(resume).toHaveTextContent('Designed BGP routing');
    expect(resume.querySelector('mark')).toBeNull();
    const bgp = screen.getByText('BGP routing').closest('li')!;
    await userEvent.click(within(bgp).getByRole('button', { name: 'Show in CV' }));
    await waitFor(() => expect(resume.querySelector('mark')).not.toBeNull());
    expect(resume.querySelector('mark')!.textContent).toContain('Designed BGP routing');
    expect(screen.getByText('Nothing to show in the CV.')).toBeInTheDocument();
  });

  it('shows links the candidate gave only when link review is on: consent first, then a button per page', async () => {
    let state: Record<string, unknown> = {
      enabled: true,
      consent: null,
      links: [
        { url: 'https://example.org/aysel', host: 'example.org', blocked: false },
        { url: 'https://www.linkedin.com/in/aysel', host: 'www.linkedin.com', blocked: true },
      ],
      reviews: [],
    };
    const calls = open((url, init) => {
      if (url.endsWith('/assistant/config'))
        return { body: { ...SENAI, features: { ...SENAI.features, linkReview: true } } };
      if (url.endsWith(`/assistant/candidates/${MID}/links`)) return { body: state };
      if (url.endsWith('/links/consent') && init?.method === 'POST') {
        state = {
          ...state,
          consent: {
            source: 'application_form',
            evidence: 'Form 77',
            recordedBy: 'Me',
            recordedAt: new Date().toISOString(),
          },
        };
        return { body: state };
      }
      if (url.endsWith('/links/review') && init?.method === 'POST') {
        state = {
          ...state,
          reviews: [
            {
              id: 'R1',
              url: 'https://example.org/aysel',
              host: 'example.org',
              text: 'Built network automation tools.',
              words: 4,
              flagged: false,
              fetchedAt: new Date().toISOString(),
            },
          ],
        };
        return { body: state };
      }
      return undefined;
    });
    render(<App check={up} />);
    const card = await screen
      .findByRole('region', { name: 'Links the candidate gave' })
      .catch(() => null);
    const root = card ?? (await screen.findByText('Links the candidate gave')).closest('section')!;
    // No consent yet: the page button is off, the social network is never offered.
    expect(within(root).getByRole('button', { name: 'Read example.org' })).toBeDisabled();
    expect(within(root).getByText('Social networks are never read')).toBeInTheDocument();
    await userEvent.type(within(root).getByLabelText(/Reference/), 'Form 77');
    await userEvent.click(within(root).getByRole('button', { name: /Record the candidate/ }));
    const btn = await within(root).findByRole('button', { name: 'Read example.org' });
    await waitFor(() => expect(btn).toBeEnabled());
    expect(calls.some((c) => c.url.endsWith('/links/review'))).toBe(false);
    await userEvent.click(btn);
    expect(await within(root).findByText('Built network automation tools.')).toBeInTheDocument();
    expect(within(root).getByText(/Candidate-provided link · example.org/)).toBeInTheDocument();
  });

  it('moves the divider with the arrow keys, Home and End', async () => {
    open();
    render(<App check={up} />);
    const sep = await screen.findByRole('separator');
    const start0 = Number(sep.getAttribute('aria-valuenow'));
    sep.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(Number(sep.getAttribute('aria-valuenow'))).toBe(start0 + 2);
    await userEvent.keyboard('{Home}');
    expect(sep).toHaveAttribute('aria-valuenow', '28');
    await userEvent.keyboard('{End}');
    expect(sep).toHaveAttribute('aria-valuenow', '72');
  });

  it('follows the list the person came from with Previous and Next, and Back returns to it', async () => {
    open();
    render(<App check={up} />);
    await screen.findByRole('heading', { name: 'Aysel Mammadova' });
    expect(screen.getAllByText('CV 1 of 2').length).toBeGreaterThan(0);
    for (const next of screen.getAllByRole('link', { name: 'Next CV ›' }))
      expect(next).toHaveAttribute('href', `#/cv/${DID2}?l=LIST1`);
    for (const prev of screen.getAllByRole('link', { name: '‹ Previous CV' }))
      expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('link', { name: '← Back to Candidates' })).toHaveAttribute(
      'href',
      '#/candidates',
    );
  });

  it('records a mark with the version, and a note keeps the mark', async () => {
    const calls = open((url, init) =>
      init?.method === 'PUT'
        ? {
            body: {
              mark: 'shortlist',
              note: null,
              version: 1,
              previous: { mark: 'new', note: null, version: 0 },
            },
          }
        : undefined,
    );
    render(<App check={up} />);
    await userEvent.selectOptions(
      await screen.findByLabelText('Decision for Aysel Mammadova'),
      'shortlist',
    );
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.init?.method === 'PUT')!.body).toEqual({
      mark: 'shortlist',
      note: null,
      expectedVersion: 0,
    });
  });

  it('shows an out-of-date banner that says what changed', async () => {
    open((url) =>
      url.endsWith(`/documents/${DID}`)
        ? {
            body: reviewDoc({
              ...report,
              outOfDate: {
                scoredAgainst: null,
                changes: [
                  {
                    version: 2,
                    at: '2026-10-07T08:00:00Z',
                    by: 'Ayla',
                    description: 'Python became a must-have',
                  },
                ],
              },
            }),
          }
        : undefined,
    );
    render(<App check={up} />);
    expect(
      await screen.findByText(/Out of date: this match was scored against earlier requirements/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Python became a must-have/)).toBeInTheDocument();
  });

  it('shows the real name and the resume as written, with no Reveal or Hide buttons', async () => {
    open((url) => {
      if (url.includes(`/documents/${DID}/text`))
        return {
          body: {
            text: 'Aysel Mammadova. Network engineer.',
            truncated: false,
            pageStarts: null,
            blocks: [],
          },
        };
      return undefined;
    });
    render(<App check={up} />);
    expect(await screen.findByText(/Aysel Mammadova\. Network engineer\./)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Reveal name|Hide name|Show original/ }),
    ).toBeNull();
  });
});

describe('SenAI Ask bar', () => {
  it('carries the slogan, and a typed question opens the panel and goes to the pool assistant', async () => {
    const calls = mockFetch(
      base((url, init) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        if (url.endsWith('/assistant/ask') && init?.method === 'POST')
          return {
            body: {
              conversationId: 'C1',
              messageId: 'A1',
              answer: {
                kind: 'pool',
                headline: 'Here are the best matches for Network Engineer.',
                notes: [],
                vacancy: { id: VID, title: 'Network Engineer', status: 'open' },
                options: [],
                counts: { total: 4, analyzed: 4, shortlist: 1, outOfDate: 0 },
                rows: [
                  {
                    matchId: MID,
                    documentId: DID,
                    label: 'Aysel Mammadova',
                    score: 88,
                    band: 'strong',
                    mustFound: 2,
                    mustTotal: 2,
                    decision: 'new',
                    decisionLabel: 'New',
                    outOfDate: false,
                    strengths: ['BGP routing'],
                    missing: [],
                  },
                ],
                more: 3,
                asOf: '2026-10-08T09:00:00Z',
                suggestions: [],
                flags: [],
                language: 'en',
              },
            },
          };
        return undefined;
      }),
    );
    render(<App check={up} />);
    const bar = await screen.findByPlaceholderText(/Sən istə, Senai tapsın/);
    await userEvent.type(bar, 'Find the right candidate for Network Engineer{Enter}');
    const panel = await screen.findByRole('complementary', { name: 'SenAI' });
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/assistant/ask'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/assistant/ask'))!.body).toMatchObject({
      message: 'Find the right candidate for Network Engineer',
    });
    expect(await within(panel).findByRole('link', { name: /Aysel Mammadova/ })).toHaveAttribute(
      'href',
      `#/cv/${DID}`,
    );
    expect(within(panel).getByRole('button', { name: /Show all \(3 more\)/ })).toBeInTheDocument();
    expect(within(panel).getByText(/As of/)).toBeInTheDocument();
  });

  it('keeps the panel pinned top to bottom so a long result list scrolls inside it', async () => {
    mockFetch(
      base((url, init) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        if (url.endsWith('/assistant/ask') && init?.method === 'POST')
          return {
            body: {
              conversationId: 'C1',
              messageId: 'A1',
              answer: {
                kind: 'pool',
                headline: 'Many matches.',
                notes: [],
                vacancy: null,
                options: [],
                counts: null,
                rows: Array.from({ length: 30 }, (_, i) => ({
                  matchId: `m${i}`,
                  label: `Candidate ${i}`,
                  score: 50,
                  band: 'partial',
                  mustFound: 1,
                  mustTotal: 2,
                  decision: 'new',
                  decisionLabel: 'New',
                  outOfDate: false,
                  strengths: [],
                  missing: [],
                })),
                more: 0,
                asOf: '2026-10-08T09:00:00Z',
                suggestions: [],
                flags: [],
                language: 'en',
              },
            },
          };
        return undefined;
      }),
    );
    render(<App check={up} />);
    const bar = await screen.findByPlaceholderText(/Sən istə, Senai tapsın/);
    await userEvent.type(bar, 'show many{Enter}');
    const panel = await screen.findByRole('complementary', { name: 'SenAI' });
    await within(panel).findByRole('link', { name: 'Candidate 29' });
    // Regression: "sm:bottom-auto" dropped the bottom edge, so the panel grew past the screen and never scrolled.
    expect(panel.className).not.toMatch(/bottom-auto/);
    expect(panel.className).toMatch(/sm:inset-y-0/);
    expect(panel.className).toMatch(/sm:h-dvh/);
    const list = within(panel).getByLabelText('Conversation');
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(list.className).toMatch(/min-h-0/);
  });

  it('shows what a skill search found: the vacancy and how often the skill is written', async () => {
    mockFetch(
      base((url, init) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        if (url.endsWith('/assistant/ask') && init?.method === 'POST')
          return {
            body: {
              conversationId: 'C1',
              messageId: 'A1',
              answer: {
                kind: 'pool',
                headline: 'Candidates whose resume mentions Excel: 1 (all vacancies).',
                notes: [],
                vacancy: null,
                options: [],
                counts: null,
                skills: ['Excel'],
                rows: [
                  {
                    matchId: MID,
                    label: 'Aysel Mammadova',
                    score: 61,
                    band: 'partial',
                    mustFound: 1,
                    mustTotal: 2,
                    decision: 'new',
                    decisionLabel: 'New',
                    outOfDate: false,
                    strengths: [],
                    missing: [],
                    vacancyTitle: 'Finance Analyst',
                    skillHits: [{ skill: 'Excel', count: 3 }],
                  },
                ],
                more: 0,
                asOf: '2026-10-08T09:00:00Z',
                suggestions: [],
                flags: ['skill_search'],
                language: 'en',
              },
            },
          };
        return undefined;
      }),
    );
    render(<App check={up} />);
    const bar = await screen.findByPlaceholderText(/Sən istə, Senai tapsın/);
    await userEvent.type(bar, 'Who knows Excel?{Enter}');
    const panel = await screen.findByRole('complementary', { name: 'SenAI' });
    expect(await within(panel).findByText(/Excel ×3/)).toBeInTheDocument();
    expect(within(panel).getByText(/Finance Analyst/)).toBeInTheDocument();
  });

  it('offers to suggest a word the dictionary does not know, once', async () => {
    const calls = mockFetch(
      base((url, init) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        if (url.endsWith('/assistant/skills/suggest'))
          return { body: { id: 'S1', status: 'proposed' } };
        if (url.endsWith('/assistant/ask') && init?.method === 'POST')
          return {
            body: {
              conversationId: 'C1',
              messageId: 'A1',
              answer: {
                kind: 'pool',
                headline: 'Candidates whose resume mentions Zorblax: 0 (all vacancies).',
                notes: [],
                vacancy: null,
                options: [],
                counts: null,
                skills: ['Zorblax'],
                unknownSkills: ['Zorblax'],
                rows: [],
                more: 0,
                asOf: '2026-10-08T09:00:00Z',
                suggestions: [],
                flags: ['skill_search'],
                language: 'en',
              },
            },
          };
        return undefined;
      }),
    );
    render(<App check={up} />);
    const bar = await screen.findByPlaceholderText(/Sən istə, Senai tapsın/);
    await userEvent.type(bar, 'Who knows Zorblax?{Enter}');
    const panel = await screen.findByRole('complementary', { name: 'SenAI' });
    await userEvent.click(
      await within(panel).findByRole('button', { name: /Suggest Zorblax to the administrator/ }),
    );
    expect(await within(panel).findByText(/An administrator will review it/)).toBeInTheDocument();
    const sent = calls.filter((c) => c.url.endsWith('/assistant/skills/suggest'));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init?.body))).toMatchObject({ label: 'Zorblax' });
  });

  it('offers "Analyze for this vacancy" only as a button, and says when it was added', async () => {
    const calls = mockFetch(
      base((url, init) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        if (url.endsWith('/assistant/rediscovery/analyze'))
          return { body: { documentId: 'D2', vacancyId: VID, queued: true } };
        if (url.endsWith('/assistant/ask') && init?.method === 'POST')
          return {
            body: {
              conversationId: 'C1',
              messageId: 'A1',
              answer: {
                kind: 'pool',
                headline: '1 resume from other vacancies may fit Network Engineer.',
                notes: [],
                vacancy: { id: VID, title: 'Network Engineer', status: 'open' },
                options: [],
                counts: null,
                rows: [],
                analyze: [{ matchId: MID, vacancyId: VID, label: 'Aysel Mammadova' }],
                more: 0,
                asOf: '2026-10-08T09:00:00Z',
                suggestions: [],
                flags: ['rediscovery'],
                language: 'en',
              },
            },
          };
        return undefined;
      }),
    );
    render(<App check={up} />);
    const bar = await screen.findByPlaceholderText(/Sən istə, Senai tapsın/);
    await userEvent.type(bar, 'rediscover candidates for Network Engineer{Enter}');
    const panel = await screen.findByRole('complementary', { name: 'SenAI' });
    const btn = await within(panel).findByRole('button', {
      name: 'Analyze Aysel Mammadova for Network Engineer',
    });
    expect(calls.some((c) => c.url.endsWith('/assistant/rediscovery/analyze'))).toBe(false);
    await userEvent.click(btn);
    expect(await within(panel).findByText(/was added to Network Engineer/)).toBeInTheDocument();
    const sent = calls.filter((c) => c.url.endsWith('/assistant/rediscovery/analyze'));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0]!.init?.body))).toEqual({ matchId: MID, vacancyId: VID });
  });

  it('shows the proof line, the chips, the receipt and a table; a chip can be taken off', async () => {
    const calls = mockFetch(
      base((url, init) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        if (url.endsWith('/assistant/ask') && init?.method === 'POST')
          return {
            body: {
              conversationId: 'C1',
              messageId: 'A1',
              answer: {
                kind: 'pool',
                headline: 'Candidates whose resume mentions Excel: 1 (all vacancies).',
                notes: [],
                vacancy: null,
                options: [],
                counts: null,
                used: [
                  { kind: 'everywhere', text: 'All vacancies' },
                  { kind: 'skill', text: 'Excel' },
                  { kind: 'band', text: 'Strong' },
                ],
                rows: [
                  {
                    matchId: MID,
                    label: 'Aysel Mammadova',
                    score: 61,
                    band: 'partial',
                    mustFound: 1,
                    mustTotal: 2,
                    decision: 'new',
                    decisionLabel: 'New',
                    outOfDate: false,
                    strengths: [],
                    missing: [],
                    passages: [
                      {
                        skill: 'Excel',
                        text: 'Built reports in Excel pivot tables.',
                        hit: 'Excel',
                      },
                    ],
                  },
                ],
                table: {
                  head: ['Requirement', 'Aysel'],
                  rows: [{ cells: ['Excel', 'Met'], tag: 'must' }],
                },
                receipt: {
                  read: 'skills; skills: Excel',
                  by: 'rules',
                  sources: ['pool analysis'],
                  asOf: '2026-10-08T09:00:00Z',
                },
                more: 0,
                asOf: '2026-10-08T09:00:00Z',
                suggestions: [],
                flags: [],
                language: 'en',
              },
            },
          };
        return undefined;
      }),
    );
    render(<App check={up} />);
    const bar = await screen.findByPlaceholderText(/Sən istə, Senai tapsın/);
    await userEvent.type(bar, 'Who knows Excel?{Enter}');
    const panel = await screen.findByRole('complementary', { name: 'SenAI' });
    expect(await within(panel).findByText(/pivot tables/)).toBeInTheDocument();
    expect(within(panel).getByText('Excel', { selector: 'mark' })).toBeInTheDocument();
    expect(within(panel).getByRole('table')).toBeInTheDocument();
    expect(within(panel).getByText(/How I got this/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: /Remove filter Strong/ }));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/assistant/ask')).pop()!.body).toMatchObject({
        without: { kind: 'band', text: 'Strong' },
      }),
    );
  });
});

// ---------------------------------------------------------------- accessibility of the new screens

/** A simple accessible name: aria-label, aria-labelledby, a label, the text inside, a title. */
function nameOf(el: HTMLElement): string {
  const by = el
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
  const labels = 'labels' in el ? [...((el as HTMLInputElement).labels ?? [])] : [];
  return (
    el.getAttribute('aria-label') ||
    by ||
    labels.map((l) => l.textContent ?? '').join(' ') ||
    el.textContent ||
    el.getAttribute('title') ||
    ''
  ).trim();
}

/** Every control a person can reach must have a name a screen reader can speak (spec section 9). */
function unnamed(root: HTMLElement): string[] {
  const sel =
    'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=separator], [role=link]';
  return [...root.querySelectorAll<HTMLElement>(sel)]
    .filter((el) => nameOf(el) === '')
    .map(
      (el) =>
        `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).slice(0, 40) : ''}`,
    );
}

describe('Accessibility of the new screens (WP 5.1)', () => {
  const frame = (container: HTMLElement) => {
    // One main landmark, a named navigation, a search landmark, and a single level-one heading.
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getAllByRole('navigation', { name: 'Main' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(unnamed(container)).toEqual([]);
  };

  it('the vacancy list has landmarks, one heading and a name on every control', async () => {
    window.location.hash = '/vacancies';
    mockFetch(
      base((url) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        return url.includes('/vacancies?') ? { body: [listItem()] } : undefined;
      }),
    );
    const { container } = render(<App check={up} />);
    await screen.findByRole('link', { name: 'Network Engineer' });
    frame(container);
  });

  it('the candidate pool names every filter, sort, checkbox and decision control', async () => {
    window.location.hash = '/candidates';
    mockFetch(
      base((url) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        if (url.includes('/candidates?')) return { body: page([poolRow(1), poolRow(2)]) };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        return undefined;
      }),
    );
    const { container } = render(<App check={up} />);
    await screen.findByRole('link', { name: 'Aysel Mammadova' });
    frame(container);
    expect(screen.getByLabelText('Select Aysel Mammadova')).toBeInTheDocument();
    expect(screen.getByLabelText('Decision for Rashad Aliyev')).toBeInTheDocument();
  });

  it('the Ask bar is reached with the slash key and is labelled', async () => {
    window.location.hash = '/vacancies';
    mockFetch(
      base((url) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        return undefined;
      }),
    );
    render(<App check={up} />);
    await screen.findByRole('link', { name: 'Network Engineer' });
    const ask = await screen.findByLabelText('Ask SenAI');
    await userEvent.keyboard('/');
    expect(ask).toHaveFocus();
  });

  it('the report names every control, has a labelled divider with a range, and tabs for phones', async () => {
    window.location.hash = `/cv/${DID}`;
    const resume = 'Aysel Mammadova\nDesigned BGP routing for a carrier core.';
    mockFetch(
      base((url) => {
        if (url.endsWith(`/documents/${DID}`))
          return {
            body: reviewDoc({
              matchId: MID,
              documentId: DID,
              label: 'Aysel Mammadova',
              name: 'Aysel Mammadova',
              pseudonym: 'Candidate 01',
              email: null,
              filename: 'aysel.pdf',
              vacancy: { id: VID, title: 'Network Engineer', status: 'open', archived: false },
              score: 88,
              band: 'strong',
              mustFound: 1,
              mustTotal: 1,
              summary: 'Strong.',
              analyzedAt: new Date().toISOString(),
              outOfDate: null,
              reanalyzing: false,
              decision: { mark: 'new', note: null, version: 0, decidedAt: null, decidedBy: null },
              history: [],
              requirements: [
                {
                  requirementId: 'R1',
                  text: 'BGP routing',
                  kind: 'must',
                  state: 'matched',
                  unclear: false,
                  notFound: false,
                  confidence: 'high',
                  rationale: 'Stated.',
                  anchors: [
                    {
                      start: 17,
                      end: 37,
                      os: 17,
                      oe: 37,
                      quote: 'Designed BGP routing',
                      page: 1,
                      block: 1,
                    },
                  ],
                },
              ],
            }),
          };
        if (url.endsWith(`/documents/${DID}/text`))
          return {
            body: { text: resume, truncated: false, pageStarts: [0], blocks: [] },
          };
        if (url.includes('/candidates?')) return { body: page([poolRow(1)]) };
        return undefined;
      }),
    );
    const { container } = render(<App check={up} />);
    await screen.findByRole('heading', { name: 'Aysel Mammadova' });
    await screen.findByLabelText('CV text', { selector: 'div' });
    expect(unnamed(container)).toEqual([]);
    const sep = screen.getByRole('separator', { name: 'Resize the panes' });
    for (const a of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'])
      expect(sep).toHaveAttribute(a);
    expect(sep).toHaveAttribute('tabindex', '0');
    // Highlighted text is a real <mark>, and the button that shows it says what it does.
    await userEvent.click(screen.getByRole('button', { name: 'Show in CV' }));
    await waitFor(() =>
      expect(
        screen.getByLabelText('CV text', { selector: 'div' }).querySelector('mark'),
      ).not.toBeNull(),
    );
  });

  it('offers the requirements of a similar vacancy in the Role card, and adds them only on a click', async () => {
    sessionStorage.setItem(`cv-copy-reqs:${VID}`, 'OTHER');
    window.location.hash = `/vacancies/${VID}/runs`;
    mockFetch(
      base((url, init) => {
        if (url.endsWith('/vacancies/OTHER'))
          return {
            body: view({
              id: 'OTHER',
              title: 'Backend Engineer',
              requirements: [
                { id: 'X1', text: 'BGP routing', classification: 'mandatory', weight: 10 },
                { id: 'X2', text: 'Docker', classification: 'mandatory', weight: 8 },
              ],
            }),
          };
        if (url.endsWith(`/vacancies/${VID}`) && isGet(init)) return { body: view() };
        if (url.endsWith(`/vacancies/${VID}/runs`)) return { body: [] };
        return undefined;
      }),
    );
    render(<App check={up} />);
    const box = await screen.findByRole('region', { name: 'Requirements from a similar vacancy' });
    expect(within(box).getByText(/Add 1 requirements from “Backend Engineer”/)).toBeInTheDocument();
    expect(within(box).getByText('Docker')).toBeInTheDocument();
    expect(screen.getAllByText('Docker')).toHaveLength(1); // only in the offer
    await userEvent.click(within(box).getByRole('button', { name: 'Add them to the form' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Requirements from a similar vacancy' }),
      ).toBeNull(),
    );
    expect(screen.getAllByText('Docker').length).toBeGreaterThan(0); // now in the form
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(sessionStorage.getItem(`cv-copy-reqs:${VID}`)).toBeNull();
  });

  it('heads skill-search results by vacancy and says they are mentioned, not assessed', async () => {
    mockFetch(
      base((url, init) => {
        if (url.endsWith('/assistant/config')) return { body: SENAI };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        if (url.endsWith('/assistant/ask') && init?.method === 'POST')
          return {
            body: {
              conversationId: 'C1',
              messageId: 'A1',
              answer: {
                kind: 'pool',
                headline:
                  'Candidates whose resume mentions Huawei core network: 2 (all vacancies).',
                notes: [],
                vacancy: null,
                options: [],
                counts: null,
                skills: ['Huawei core network'],
                groups: [{ vacancyId: VID, title: 'Network Engineer', total: 2 }],
                rows: [
                  {
                    ...poolRow(1),
                    strengths: [],
                    missing: [],
                    passages: [
                      {
                        skill: 'Huawei core network',
                        text: 'core network by Huawei',
                        hit: 'Huawei',
                      },
                    ],
                  },
                ],
                more: 1,
                asOf: '2026-10-08T09:00:00Z',
                suggestions: [],
                flags: ['skill_search'],
                language: 'en',
              },
            },
          };
        return undefined;
      }),
    );
    render(<App check={up} />);
    const bar = await screen.findByPlaceholderText(/Sən istə, Senai tapsın/);
    await userEvent.type(bar, 'Huawei core network?{Enter}');
    const panel = await screen.findByRole('complementary', { name: 'SenAI' });
    expect(await within(panel).findByText('2 resumes mention it')).toBeInTheDocument();
    expect(within(panel).getByText('Mentioned in the resume, not assessed')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Show all \(1 more\)/ })).toBeInTheDocument();
  });
});

describe('Candidate preview and keys (Oct 2026)', () => {
  const wide = () =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    );
  const preview = {
    matchId: MID,
    documentId: DID,
    label: 'Aysel Mammadova',
    name: 'Aysel Mammadova',
    pseudonym: 'Candidate 01',
    email: null,
    filename: null,
    vacancy: { id: VID, title: 'Network Engineer', status: 'open', archived: false },
    score: 88,
    band: 'strong',
    mustFound: 1,
    mustTotal: 2,
    summary: 'Strong carrier-core background.',
    analyzedAt: new Date().toISOString(),
    outOfDate: null,
    reanalyzing: false,
    decision: { mark: 'new', note: null, version: 0, decidedAt: null, decidedBy: null },
    history: [],
    requirements: [
      {
        requirementId: 'R1',
        text: 'BGP routing',
        kind: 'must',
        state: 'matched',
        unclear: false,
        notFound: false,
        confidence: 'high',
        rationale: null,
        anchors: [],
      },
      {
        requirementId: 'R2',
        text: 'Kubernetes',
        kind: 'must',
        state: 'missing',
        unclear: false,
        notFound: true,
        confidence: 'high',
        rationale: null,
        anchors: [],
      },
    ],
  };
  const open = () => {
    window.location.hash = '/candidates';
    return mockFetch(
      base((url, init) => {
        if (init?.method === 'PUT')
          return {
            body: {
              mark: JSON.parse(String(init.body)).mark,
              note: null,
              version: 1,
              previous: { mark: 'new', note: null, version: 0 },
            },
          };
        if (url.endsWith(`/candidates/${MID}/report`)) return { body: preview };
        if (url.includes(`/candidates/${MID}/resume`))
          return {
            body: {
              view: 'original',
              text: 'Aysel Mammadova',
              truncated: false,
              pageStarts: [0],
              blocks: [],
              hidden: {},
              notice: null,
            },
          };
        if (url.endsWith(`/candidates/${MID2}/report`))
          return { body: { ...preview, matchId: MID2, label: 'Rashad Aliyev', requirements: [] } };
        if (url.includes('/candidates?')) return { body: page([poolRow(1), poolRow(2)]) };
        if (url.includes('/vacancies?')) return { body: [listItem()] };
        return undefined;
      }),
    );
  };

  it('opens a side panel with the must-haves and decides with one tap', async () => {
    wide();
    const calls = open();
    render(<App check={up} />);
    await screen.findByRole('link', { name: 'Aysel Mammadova' });
    await userEvent.click(screen.getAllByText('Network Engineer', { selector: 'span' })[0]!);
    const panel = await screen.findByRole('complementary', { name: 'Preview of Aysel Mammadova' });
    expect(await within(panel).findByText('BGP routing')).toBeInTheDocument();
    expect(within(panel).getByText('Matched')).toBeInTheDocument();
    expect(within(panel).getByText('Not found')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Shortlist' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.init?.method === 'PUT')!.body).toEqual({
      mark: 'shortlist',
      expectedVersion: 0,
    });
    expect(within(panel).getByRole('button', { name: 'Shortlist' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Open the full report' }));
    expect(window.location.hash).toMatch(new RegExp(`^#/cv/${DID}\\?l=`));
  });

  it('moves with J and K, decides with S, closes with Escape, and ignores keys typed in a field', async () => {
    wide();
    const calls = open();
    render(<App check={up} />);
    await screen.findByRole('link', { name: 'Aysel Mammadova' });
    await userEvent.click(screen.getByLabelText('Search candidates'));
    await userEvent.keyboard('sj');
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
    await userEvent.click(document.body);
    await userEvent.keyboard('j');
    expect(
      await screen.findByRole('complementary', { name: 'Preview of Aysel Mammadova' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('j');
    expect(
      await screen.findByRole('complementary', { name: 'Preview of Rashad Aliyev' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('k');
    await userEvent.keyboard('m');
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.init?.method === 'PUT')!.url).toContain(`/candidates/${MID}/`);
    expect(calls.find((c) => c.init?.method === 'PUT')!.body).toMatchObject({ mark: 'maybe' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: /Preview of/ })).toBeNull();
  });

  it('keeps opening the report on a click when the screen is narrow', async () => {
    open();
    render(<App check={up} />);
    await screen.findByRole('link', { name: 'Aysel Mammadova' });
    await userEvent.click(screen.getAllByText('Network Engineer', { selector: 'span' })[0]!);
    expect(window.location.hash).toMatch(new RegExp(`^#/cv/${DID}\\?l=`));
  });
});

describe('Vacancy page with results (Oct 2026)', () => {
  const open = (counts: object) => {
    window.location.hash = `/vacancies/${VID}/candidates`;
    return mockFetch(
      base((url, init) => {
        if (url.endsWith(`/vacancies/${VID}`) && isGet(init))
          return {
            body: view({
              counts: {
                documents: 40,
                analyzed: 38,
                outOfDate: 0,
                strong: 6,
                running: 0,
                stopped: 0,
                failed: 1,
                needsLook: 3,
                ...counts,
              },
            }),
          };
        if (url.endsWith(`/vacancies/${VID}/runs`)) return { body: [] };
        if (url.includes('/candidates?')) return { body: page([poolRow(1), poolRow(2)]) };
        return undefined;
      }),
    );
  };

  it('leads with the numbers and the ranked list, and folds the role and resumes away', async () => {
    open({});
    render(<App check={up} />);
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('38')).toBeInTheDocument();
    expect(within(summary).getByText('Need a look')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Aysel Mammadova' })).toBeInTheDocument();
    const setup = document.getElementById('vacancy-setup')!;
    expect(setup).toHaveAttribute('hidden');
    await userEvent.click(within(summary).getByRole('button', { name: 'Role and resumes' }));
    expect(setup).not.toHaveAttribute('hidden');
    expect(within(summary).getByRole('button', { name: 'Hide role and resumes' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('says results are out of date and opens the role and resumes on request', async () => {
    open({ outOfDate: 5 });
    render(<App check={up} />);
    expect(
      await screen.findByText(/5 results were scored against earlier requirements/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review and re-analyze' }));
    expect(document.getElementById('vacancy-setup')).not.toHaveAttribute('hidden');
  });

  it('shows the role and resumes first while nothing is analyzed yet', async () => {
    open({ documents: 0, analyzed: 0, strong: 0, failed: 0, needsLook: 0 });
    render(<App check={up} />);
    await screen.findByLabelText('Position');
    expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();
    expect(document.getElementById('vacancy-setup')).not.toHaveAttribute('hidden');
  });
});
