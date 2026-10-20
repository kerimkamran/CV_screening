import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { session } from './api';
import { rememberUser, resetAssistantConfigCache, setAssistantOpen } from './assistant';
import { resetReviewCacheForTests } from './pages/CvReview';

// pdf.js does not run in a test browser; the pane only needs to know it was asked to show a page.
const goTo = vi.fn();
const find = vi.fn(async (_quote: string) => 3);
vi.mock('./pages/PdfPages', async () => {
  const React = await import('react');
  function PdfPagesMock({
    ref,
    documentId,
  }: {
    ref?: React.Ref<{ goTo: (n: number) => void; find: (q: string) => Promise<number | null> }>;
    documentId: string;
  }) {
    React.useImperativeHandle(ref, () => ({ goTo, find }));
    return <div data-testid="pdf-pages">pages of {documentId}</div>;
  }
  return { default: PdfPagesMock };
});

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
const up = async () => ({ state: 'up' as const });
const ME = { userId: 'u', displayName: 'Ayla Karimova', email: 'a@x.az', roles: ['TA_PARTNER'] };
const VID = '0'.repeat(25) + 'V';
const MID = '0'.repeat(25) + 'M';
const DID = '0'.repeat(25) + 'D';
const DID2 = '0'.repeat(25) + 'E';

const doc = (over: Record<string, unknown> = {}) => ({
  documentId: DID,
  vacancy: { id: VID, title: 'Network Engineer', status: 'open', archived: false },
  filename: 'aysel.pdf',
  kind: 'pdf',
  sizeBytes: 1200,
  uploadedAt: '2026-10-08T09:00:00Z',
  name: 'Aysel Mammadova',
  pseudonym: 'Candidate 01',
  pseudonymNo: 1,
  status: 'unreadable',
  statusDetail: { reason: 'No text could be read from this file.', retryable: false },
  screeningId: MID,
  matchId: MID,
  original: { available: true, view: 'pdf' },
  text: { available: false },
  decision: { mark: 'new', note: null, version: 0, decidedAt: null, decidedBy: null },
  analysis: null,
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
  goTo.mockClear();
  find.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const open = (route: string, handler: Handler) => {
  window.location.hash = route;
  return mockFetch((url, init) => {
    const e = handler(url, init);
    if (e) return e;
    if (url.endsWith('/me')) return { body: ME };
    if (url.endsWith('/assistant/config')) return { body: { enabled: false } };
    return undefined;
  });
};

describe('CV review screen', () => {
  it('shows the original pages for a PDF, and asks for the page when "Show in CV" is pressed', async () => {
    const analysis = {
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
          anchors: [{ start: 0, end: 10, quote: 'BGP', page: 2, block: 0 }],
        },
      ],
    };
    open(`/cv/${DID}`, (url) =>
      url.endsWith(`/documents/${DID}`)
        ? { body: doc({ status: 'analyzed', analysis, text: { available: true } }) }
        : url.endsWith(`/documents/${DID}/text`)
          ? { body: { text: 'BGP routing here', truncated: false, pageStarts: [0], blocks: [] } }
          : undefined,
    );
    render(<App check={up} />);
    expect(await screen.findByRole('heading', { name: 'Aysel Mammadova' })).toBeInTheDocument();
    expect(await screen.findByTestId('pdf-pages')).toHaveTextContent(`pages of ${DID}`);
    expect(screen.getByRole('tab', { name: 'Original', selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show in CV' }));
    await waitFor(() => expect(goTo).toHaveBeenCalledWith(2));
    // The same lines are marked in the text.
    await userEvent.click(screen.getByRole('tab', { name: 'Text' }));
    const text = await screen.findByLabelText('CV text', { selector: 'div' });
    await waitFor(() => expect(text.querySelector('mark')).not.toBeNull());
  });

  it('says a CV is being analyzed, and shows the result by itself when it arrives', async () => {
    let n = 0;
    open(`/cv/${DID}`, (url) => {
      if (!url.endsWith(`/documents/${DID}`)) return undefined;
      n++;
      return {
        body:
          n === 1
            ? doc({ status: 'analyzing', matchId: null })
            : doc({
                status: 'failed',
                statusDetail: { error: 'The model timed out.', retryable: true },
              }),
      };
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App check={up} />);
    expect(await screen.findByText('This CV is being analyzed.')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(await screen.findByText('The model timed out.')).toBeInTheDocument();
    // Nothing more is polled once the CV is final.
    const seen = n;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(n).toBe(seen);
  });

  it('retries a failed analysis on its own page', async () => {
    let retried = false;
    const calls = open(`/cv/${DID}`, (url, init) => {
      if (url.endsWith(`/screenings/${MID}/retry`) && init?.method === 'POST') {
        retried = true;
        return { body: { ok: true } };
      }
      if (url.endsWith(`/documents/${DID}`))
        return {
          body: retried
            ? doc({ status: 'analyzing', matchId: null })
            : doc({
                status: 'failed',
                matchId: null,
                statusDetail: { error: 'Provider error.', retryable: true },
              }),
        };
      return undefined;
    });
    render(<App check={up} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry the analysis' }));
    expect(await screen.findByText('This CV is being analyzed.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith(`/screenings/${MID}/retry`))).toBe(true);
  });

  it('lets a person decide on a CV that has no readable text, and says why', async () => {
    const calls = open(`/cv/${DID}`, (url, init) => {
      if (init?.method === 'PUT')
        return {
          body: {
            mark: 'not_now',
            note: null,
            version: 1,
            previous: { mark: 'new', note: null, version: 0 },
          },
        };
      if (url.endsWith(`/documents/${DID}`)) return { body: doc() };
      return undefined;
    });
    render(<App check={up} />);
    expect(
      await screen.findByText('Read the CV on the left and decide yourself.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('No text could be read from this file.').length).toBeGreaterThan(0);
    await userEvent.selectOptions(
      await screen.findByLabelText('Decision for Aysel Mammadova'),
      'not_now',
    );
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.init?.method === 'PUT')!.url).toContain(
      `/candidates/${MID}/decision`,
    );
  });

  it('shows the text of a Word file with a note and a download, and a text file without pages', async () => {
    open(`/cv/${DID}`, (url) =>
      url.endsWith(`/documents/${DID}`)
        ? {
            body: doc({
              filename: 'aysel.docx',
              kind: 'docx',
              status: 'needs_look',
              matchId: null,
              original: { available: true, view: 'unavailable' },
              text: { available: true },
            }),
          }
        : url.endsWith(`/documents/${DID}/text`)
          ? { body: { text: 'Word text', truncated: false, pageStarts: null, blocks: [] } }
          : undefined,
    );
    render(<App check={up} />);
    expect(
      await screen.findByText(/The pages of this Word file are not available/),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('CV text', { selector: 'div' })).toHaveTextContent(
      'Word text',
    );
    expect(screen.queryByTestId('pdf-pages')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Original' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
  });

  it('says plainly that an erased CV is gone', async () => {
    open(`/cv/${DID}`, (url) =>
      url.endsWith(`/documents/${DID}`)
        ? {
            body: doc({
              status: 'erased',
              matchId: null,
              original: { available: false, view: 'unavailable' },
              text: { available: false },
            }),
          }
        : undefined,
    );
    render(<App check={up} />);
    expect(
      (await screen.findAllByText('This CV was erased. Its file and its text are gone.')).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('is "not available" for a CV the person may not see', async () => {
    open(`/cv/${DID}`, (url) =>
      url.endsWith(`/documents/${DID}`)
        ? { status: 404, body: { message: 'Not Found' } }
        : undefined,
    );
    render(<App check={up} />);
    expect(
      await screen.findByText('This CV is not available to you, or it no longer exists.'),
    ).toBeInTheDocument();
  });

  it('walks the list with J and K and keeps the list id in the address', async () => {
    sessionStorage.setItem(
      'cv-review-lists',
      JSON.stringify([
        {
          id: 'LIST1',
          label: 'Network Engineer',
          back: '/vacancies/x',
          ids: [DID, DID2],
          savedAt: 1,
        },
      ]),
    );
    open(`/cv/${DID}?l=LIST1`, (url) =>
      url.endsWith(`/documents/${DID}`)
        ? { body: doc() }
        : url.endsWith(`/documents/${DID2}`)
          ? { body: doc({ documentId: DID2, name: 'Rashad Aliyev' }) }
          : undefined,
    );
    render(<App check={up} />);
    await screen.findByRole('heading', { name: 'Aysel Mammadova' });
    expect(screen.getByRole('link', { name: '← Back to Network Engineer' })).toHaveAttribute(
      'href',
      '#/vacancies/x',
    );
    await userEvent.keyboard('j');
    expect(window.location.hash).toBe(`#/cv/${DID2}?l=LIST1`);
    expect(await screen.findByRole('heading', { name: 'Rashad Aliyev' })).toBeInTheDocument();
    // The announcement for screen readers says where the person is.
    expect(screen.getByText('CV 2 of 2: Rashad Aliyev')).toBeInTheDocument();
    await userEvent.keyboard('k');
    expect(window.location.hash).toBe(`#/cv/${DID}?l=LIST1`);
  });

  it('opens an old report link on the CV it belongs to', async () => {
    open(`/candidates/${MID}`, (url) =>
      url.endsWith(`/screenings/${MID}`)
        ? { body: { id: MID, documentId: DID } }
        : url.endsWith(`/documents/${DID}`)
          ? { body: doc() }
          : undefined,
    );
    render(<App check={up} />);
    await waitFor(() => expect(window.location.hash).toBe(`#/cv/${DID}`));
    expect(await screen.findByRole('heading', { name: 'Aysel Mammadova' })).toBeInTheDocument();
  });
});

describe('Candidate list with CVs that have no result', () => {
  const ranked = {
    documentId: DID,
    vacancyId: VID,
    vacancyTitle: 'Network Engineer',
    vacancyStatus: 'open',
    vacancyArchived: false,
    pseudonym: 'Candidate 01',
    label: 'Aysel Mammadova',
    name: 'Aysel Mammadova',
    ordinal: 1,
    matchId: MID,
    score: 88,
    band: 'strong',
    mustFound: 2,
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
  };
  const plain = {
    ...ranked,
    documentId: DID2,
    pseudonym: 'Candidate 02',
    label: 'Candidate 02',
    name: null,
    ordinal: 2,
    matchId: null,
    score: null,
    band: null,
    analyzedAt: null,
    status: 'unreadable',
    screeningId: null,
    filename: 'scan.pdf',
    uploadedAt: '2026-10-08T09:00:00Z',
    mustFound: 0,
    mustTotal: 0,
  };
  const pageOf = (rows: object[]) => ({
    rows,
    total: rows.length,
    counts: { byMark: { new: 1, shortlist: 0, maybe: 0, not_now: 0 }, outOfDate: 0, strong: 1 },
    nextCursor: null,
    asOf: '2026-10-08T09:00:00Z',
  });

  it('asks for the status rows only when a status is chosen, and shows each with its status', async () => {
    const calls = open('/candidates', (url) => {
      if (url.includes('/candidates/ids'))
        return {
          body: {
            items: [
              [DID, MID],
              [DID2, null],
            ],
          },
        };
      if (url.includes('/candidates?'))
        return { body: pageOf(url.includes('status=') ? [ranked, plain] : [ranked]) };
      if (url.includes('/vacancies?')) return { body: [] };
      return undefined;
    });
    render(<App check={up} />);
    await screen.findByRole('link', { name: 'Aysel Mammadova' });
    expect(
      calls.filter((c) => c.url.includes('/candidates?')).every((c) => !c.url.includes('status=')),
    ).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'all');
    expect(await screen.findByRole('link', { name: 'Candidate 02' })).toBeInTheDocument();
    expect(screen.getByText('No readable text')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('status=all'))).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'attention');
    await waitFor(() =>
      expect(
        calls.some((c) => decodeURIComponent(c.url).includes('status=needs_look,unreadable')),
      ).toBe(true),
    );
  });

  it('opens a CV from the list with the whole ordered list behind Previous and Next', async () => {
    open('/candidates', (url) => {
      if (url.includes('/candidates/ids'))
        return {
          body: {
            items: [
              [DID, MID],
              [DID2, null],
            ],
          },
        };
      if (url.includes('/candidates?')) return { body: pageOf([ranked, plain]) };
      if (url.includes('/vacancies?')) return { body: [] };
      return undefined;
    });
    render(<App check={up} />);
    const link = await screen.findByRole('link', { name: 'Candidate 02' });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Aysel Mammadova' })).toBeInTheDocument(),
    );
    // Let the ordered ids arrive, then open the second CV.
    await new Promise((r) => setTimeout(r, 30));
    await userEvent.click(link);
    const m = /^#\/cv\/(\w{26})\?l=([\w-]+)$/.exec(window.location.hash)!;
    expect(m[1]).toBe(DID2);
    const stored = JSON.parse(sessionStorage.getItem('cv-review-lists')!) as {
      id: string;
      ids: string[];
      back: string;
    }[];
    expect(stored.find((l) => l.id === m[2])).toMatchObject({
      ids: [DID, DID2],
      back: '/candidates',
    });
  });
  it('selects across the whole list, downloads the chosen CVs as one ZIP, and keeps the selection for the tab', async () => {
    const DID3 = '0'.repeat(25) + 'F';
    const calls = open('/candidates', (url, init) => {
      if (url.includes('/candidates/ids'))
        return {
          body: {
            items: [
              [DID, MID],
              [DID2, null],
              [DID3, null],
            ],
          },
        };
      if (url.includes('/candidates?'))
        return { body: { ...pageOf([ranked, plain]), total: 3, nextCursor: 'c1' } };
      if (url.includes('/vacancies?')) return { body: [] };
      if (url.endsWith('/downloads') && init?.method === 'POST')
        return {
          status: 201,
          body: {
            url: '/downloads/' + 'a'.repeat(43),
            files: 2,
            bytes: 2 * 1024 * 1024,
            archiveName: 'CVs - 2026-10-20.zip',
            excluded: [{ documentId: DID3, label: 'Candidate 03', reason: 'erased' }],
          },
        };
      return undefined;
    });
    const { unmount } = render(<App check={up} />);
    await screen.findByRole('link', { name: 'Aysel Mammadova' });
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'all');
    await screen.findByRole('link', { name: 'Candidate 02' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all shown' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Select all 3 in this list' }));
    expect(await screen.findByText('3 selected')).toBeInTheDocument();
    expect(screen.getByText(/All 3 in this list are selected/)).toBeInTheDocument();

    // X unticks the active row (J makes the first row active).
    await userEvent.keyboard('j');
    await userEvent.keyboard('x');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.keyboard('x');
    expect(screen.getByText('3 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Download CVs' }));
    const post = calls.find((c) => c.url.endsWith('/downloads'));
    expect(post?.body).toEqual({ documentIds: [DID, DID2, DID3] });
    expect(
      await screen.findByText(
        'Downloading 2 CVs (2.0 MB) as one ZIP. 1 left out: Candidate 03 (the CV was erased).',
      ),
    ).toBeInTheDocument();

    // Back from a CV (a new mount in the same tab): the selection is still there.
    unmount();
    render(<App check={up} />);
    expect(await screen.findByText('3 selected')).toBeInTheDocument();
  });

  describe('a Word file (its pages are made on the server)', () => {
    const word = (view: string, over: Record<string, unknown> = {}) =>
      doc({
        filename: 'aysel.docx',
        kind: 'docx',
        status: 'needs_look',
        statusDetail: { reason: 'No score could be given.', retryable: false },
        original: { available: true, view, source: 'rendition' },
        text: { available: true },
        ...over,
      });
    const textReply = {
      body: { text: 'BGP routing here', truncated: false, pageStarts: [0], blocks: [] },
    };

    it('shows the text with a notice while the pages are being prepared, then the pages when ready', async () => {
      let ready = false;
      open(`/cv/${DID}`, (url) =>
        url.endsWith(`/documents/${DID}`)
          ? { body: word(ready ? 'pdf' : 'pending') }
          : url.endsWith(`/documents/${DID}/text`)
            ? textReply
            : undefined,
      );
      vi.useFakeTimers({ shouldAdvanceTime: true });
      render(<App check={up} />);
      expect(
        await screen.findByText(/The pages of this Word file are being prepared/),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('pdf-pages')).toBeNull();
      expect(await screen.findByText('BGP routing here')).toBeInTheDocument();
      ready = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(await screen.findByTestId('pdf-pages')).toBeInTheDocument();
      expect(screen.getByText(/These pages were made from the Word file/)).toBeInTheDocument();
    });

    it('says the pages are not available when they could not be made, and keeps the text', async () => {
      open(`/cv/${DID}`, (url) =>
        url.endsWith(`/documents/${DID}`)
          ? { body: word('failed') }
          : url.endsWith(`/documents/${DID}/text`)
            ? textReply
            : undefined,
      );
      render(<App check={up} />);
      expect(
        await screen.findByText(/The pages of this Word file are not available/),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('pdf-pages')).toBeNull();
      expect(await screen.findByText('BGP routing here')).toBeInTheDocument();
    });

    it('finds the quote in the pages when a line has no page number', async () => {
      const analysis = {
        matchId: MID,
        documentId: DID,
        label: 'Aysel Mammadova',
        name: 'Aysel Mammadova',
        pseudonym: 'Candidate 01',
        email: null,
        filename: 'aysel.docx',
        vacancy: { id: VID, title: 'Network Engineer', status: 'open', archived: false },
        score: 80,
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
            anchors: [{ start: 0, end: 3, quote: 'BGP routing', page: null, block: 0 }],
          },
        ],
      };
      open(`/cv/${DID}`, (url) =>
        url.endsWith(`/documents/${DID}`)
          ? { body: word('pdf', { status: 'analyzed', analysis }) }
          : url.endsWith(`/documents/${DID}/text`)
            ? textReply
            : undefined,
      );
      render(<App check={up} />);
      await screen.findByTestId('pdf-pages');
      await userEvent.click(await screen.findByRole('button', { name: 'Show in CV' }));
      await waitFor(() => expect(find).toHaveBeenCalledWith('BGP routing'));
      await waitFor(() => expect(goTo).toHaveBeenCalledWith(3));
    });
  });
});
