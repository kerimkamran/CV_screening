import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { session } from './api';
import {
  checkFiles,
  DEFAULT_LIMITS,
  matchOpenItems,
  resetIntakeForTests,
  startBatch,
  watchBatch,
  getRun,
  type Checked,
} from './intake';
import { Results } from './pages/Results';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };
function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = handler(url, init);
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}
const up = async () => ({ state: 'up' as const });
const recruiter = { userId: 'u', displayName: 'Ayla', email: 'a@x.az', roles: ['TA_PARTNER'] };
const pdf = (n: string, path?: string) => {
  const f = new File(['%PDF-1.7 cv'], n, { type: 'application/pdf' });
  if (path) Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
};

beforeEach(() => {
  session.set('t');
  window.location.hash = '';
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetIntakeForTests();
});

const file = (name: string, size = 100, path?: string) => {
  const f = new File([new Uint8Array(size)], name);
  if (path) Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
};

describe('the check before sending (S2-FE7)', () => {
  it('flags a wrong type, an old Word file, an empty file and a file over the limit, each with its reason', () => {
    const r = checkFiles(
      [
        file('cv.pdf'),
        file('notes.png'),
        file('old.doc'),
        file('empty.pdf', 0),
        file('huge.pdf', 11 * 1024 * 1024),
      ],
      DEFAULT_LIMITS,
    );
    const by = Object.fromEntries(r.added.map((x) => [x.name, x.problem?.code ?? 'ok']));
    expect(by).toEqual({
      'cv.pdf': 'ok',
      'notes.png': 'wrong_type',
      'old.doc': 'old_word_format',
      'empty.pdf': 'empty',
      'huge.pdf': 'too_large',
    });
  });

  it('allows a bigger ZIP than a CV, ignores system files, and leaves exact repeats out', () => {
    const zip = file('all.zip', 50 * 1024 * 1024);
    const a = file('cv.pdf', 10, 'a/cv.pdf');
    const r = checkFiles([zip, file('.DS_Store'), file('~$tmp.docx'), a], DEFAULT_LIMITS);
    expect(r.added.map((x) => x.problem)).toEqual([undefined, undefined]);
    expect(r.ignored).toBe(2);
    const again = checkFiles([a], DEFAULT_LIMITS, new Set(r.added.map((x) => x.key)));
    expect(again.repeated).toBe(1);
    expect(again.added).toHaveLength(0);
  });

  it('keeps same-name files from different folders, with their folder paths', () => {
    const r = checkFiles(
      [file('cv.pdf', 10, 'new/cv.pdf'), file('cv.pdf', 10, 'old/cv.pdf')],
      DEFAULT_LIMITS,
    );
    expect(r.added.map((x) => x.path)).toEqual(['new/cv.pdf', 'old/cv.pdf']);
  });

  it('matches chosen files to open items on name and size, one file per item', () => {
    const open = [
      { itemId: 'I1', filename: 'a.pdf', size: 10, position: 0 },
      { itemId: 'I2', filename: 'a.pdf', size: 10, position: 1 },
      { itemId: 'I3', filename: 'b.pdf', size: 20, position: 2 },
    ];
    const { matched, unmatched } = matchOpenItems(open, [
      file('a.pdf', 10),
      file('a.pdf', 10),
      file('a.pdf', 10),
      file('b.pdf', 21),
    ]);
    expect(matched.map((m) => m.itemId)).toEqual(['I1', 'I2']);
    expect(unmatched).toHaveLength(2);
  });
});

describe('sending one file per request, three at a time (S2-FE7)', () => {
  const rows = (n: number): Checked[] =>
    checkFiles(
      Array.from({ length: n }, (_, i) => file(`cv${i}.pdf`, 10 + i)),
      DEFAULT_LIMITS,
    ).added;
  const made = (n: number) => ({
    batchId: 'B1',
    items: Array.from({ length: n }, (_, i) => ({ itemId: `I${i}`, position: i })),
  });

  it('announces the batch, then sends each file alone with its item id, never more than 3 at once', async () => {
    let live = 0;
    let peak = 0;
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.endsWith('/upload-batches') && init?.method === 'POST')
        return new Response(JSON.stringify(made(7)), {
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/documents?item=')) {
        urls.push(url);
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 15));
        live--;
        return new Response(JSON.stringify({ results: [] }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } });
    });
    const id = await startBatch('VID', rows(7));
    expect(id).toBe('B1');
    await waitFor(() => expect(urls).toHaveLength(7));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(urls.map((u) => u.split('item=')[1]).sort()).toEqual([
      'I0',
      'I1',
      'I2',
      'I3',
      'I4',
      'I5',
      'I6',
    ]);
    await waitFor(() => expect(getRun('VID')!.items.every((i) => i.client === 'sent')).toBe(true));
  });

  it('retries a failing file once and, if it still fails, marks only that file', async () => {
    const hits: Record<string, number> = {};
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u);
      const ok = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/upload-batches') && init?.method === 'POST') return ok(made(2));
      const m = /item=(\w+)/.exec(url);
      if (m) {
        hits[m[1]!] = (hits[m[1]!] ?? 0) + 1;
        return m[1] === 'I1' ? ok({ message: 'boom' }, 500) : ok({ results: [] });
      }
      return ok({});
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await startBatch('VID', rows(2));
      await vi.advanceTimersByTimeAsync(2500);
      await waitFor(() =>
        expect(getRun('VID')!.items.map((i) => i.client)).toEqual(['sent', 'failed']),
      );
    } finally {
      vi.useRealTimers();
    }
    expect(hits).toEqual({ I0: 1, I1: 2 });
  });

  it('pauses the queue on a 401 and does not call it a failure', async () => {
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u);
      const ok = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/upload-batches') && init?.method === 'POST') return ok(made(2));
      if (url.includes('item=')) return ok({ message: 'Sign in again' }, 401);
      return ok({});
    });
    await startBatch('VID', rows(2));
    await waitFor(() => expect(getRun('VID')!.paused).toBe(true));
    expect(getRun('VID')!.items.some((i) => i.client === 'failed')).toBe(false);
  });
});

describe('the batch watcher (S2-FE8)', () => {
  it('asks once for a finished batch and then stops asking', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async () => {
      n++;
      return new Response(
        JSON.stringify({
          batch: {
            id: 'B9',
            vacancyId: 'V',
            createdAt: '',
            createdBy: 'x',
            fileCount: 1,
            mine: true,
          },
          lastReceivedAt: null,
          counts: {
            upload: {
              total: 1,
              received: 1,
              notReceived: 0,
              vacancyFull: 0,
              rejected: 0,
              duplicate: 0,
            },
            byStatus: { analyzing: 0, analyzed: 1 },
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const seen: number[] = [];
    const stop = watchBatch('B9', (s) => seen.push(s.counts.upload.total));
    await waitFor(() => expect(seen).toEqual([1]));
    await new Promise((r) => setTimeout(r, 60));
    expect(n).toBe(1);
    stop();
  });
});

const VID = '0'.repeat(25) + 'V';
const vacancyView = {
  id: VID,
  title: 'Network Engineer',
  status: 'draft',
  archived: false,
  department: null,
  location: null,
  experienceRange: 'any',
  openings: null,
  closingDate: null,
  hiringManager: null,
  notes: null,
  description: '',
  sourceType: 'typed',
  sourceFileName: null,
  link: null,
  requirementsVersion: 1,
  version: 1,
  owner: { id: 'u', name: 'Ayla' },
  canEdit: true,
  candidateNoticeConfirmedAt: null,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  updatedBy: null,
  requirements: [],
  hasDraft: false,
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
};
const INTAKE = {
  used: 312,
  limit: 500,
  maxFileMb: 10,
  maxZipMb: 100,
  accepts: ['pdf', 'docx', 'txt', 'zip'],
  latestBatch: null,
};
const emptyPool = {
  rows: [],
  total: 0,
  counts: { byMark: { new: 0, shortlist: 0, maybe: 0, not_now: 0 }, outOfDate: 0, strong: 0 },
  nextCursor: null,
  asOf: '2026-10-01T10:00:00Z',
};
/** The answers the vacancy page needs; `extra` answers first for the call under test. */
type Extra = (url: string, init?: RequestInit) => ReturnType<Handler> | undefined;
const vacancyPage =
  (extra?: Extra): Handler =>
  (url, init) => {
    const e = extra?.(url, init);
    if (e) return e;
    if (url.endsWith('/me')) return { body: recruiter };
    if (url.endsWith('/assistant/config')) return { body: { enabled: false } };
    if (url.endsWith(`/vacancies/${VID}/intake`)) return { body: INTAKE };
    if (url.includes('/candidates')) return { body: emptyPool };
    if (url.endsWith(`/vacancies/${VID}`)) return { body: vacancyView };
    return { body: [] };
  };

describe('Vacancy page: the CVs card', () => {
  const open = async (extra?: Extra) => {
    window.location.hash = `/vacancies/${VID}`;
    const calls = mockFetch(vacancyPage(extra));
    render(<App check={up} />);
    await screen.findByLabelText('Position');
    return calls;
  };

  it('shows how many CVs are used, and sums up a folder instead of printing it', async () => {
    await open();
    expect(await screen.findByText(/312 of 500 CVs used in this vacancy/)).toBeInTheDocument();
    const folder = [
      ...Array.from({ length: 12 }, (_, i) => pdf(`cv${i}.pdf`, `batch/cv${i}.pdf`)),
      pdf('.DS_Store', 'batch/.DS_Store'),
    ];
    await userEvent.upload(screen.getByLabelText('Choose a folder of CVs'), folder, {
      applyAccept: false,
    });
    expect(screen.getByTestId('check-summary')).toHaveTextContent('12 files');
    expect(screen.getByTestId('check-summary')).toHaveTextContent('12 ready');
    expect(screen.getByText(/1 system file left out/)).toBeInTheDocument();
    expect(screen.queryByText('batch/cv3.pdf')).toBeNull(); // folded
    await userEvent.click(screen.getByRole('button', { name: 'Show all 12 files' }));
    expect(screen.getByText('batch/cv3.pdf')).toBeInTheDocument();
  });

  it('flags problem files before anything is sent, each with a reason and a Remove', async () => {
    await open();
    const files = [
      new File(['x'], 'notes.png'),
      new File(['x'], 'old.doc'),
      new File([], 'empty.pdf'),
      pdf('good.pdf'),
    ];
    await userEvent.upload(screen.getByLabelText('Choose CV files'), files, { applyAccept: false });
    expect(screen.getByTestId('check-summary')).toHaveTextContent('1 ready');
    expect(screen.getByTestId('check-summary')).toHaveTextContent('3 need attention');
    expect(screen.getByText(/Not a CV file type/)).toBeInTheDocument();
    expect(screen.getByText(/Old Word format: save it as .docx or PDF/)).toBeInTheDocument();
    expect(screen.getByText(/The file is empty/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove all files that need attention' }),
    );
    expect(screen.queryByText(/Not a CV file type/)).toBeNull();
  });

  it('warns above 100 CVs without blocking, and says how many do not fit', async () => {
    await open((url) =>
      url.endsWith(`/vacancies/${VID}/intake`) ? { body: { ...INTAKE, used: 450 } } : undefined,
    );
    await screen.findByText(/450 of 500 CVs used/);
    const many = Array.from({ length: 136 }, (_, i) => pdf(`cv${i}.pdf`));
    await userEvent.upload(screen.getByLabelText('Choose CV files'), many, { applyAccept: false });
    expect(
      screen.getByText(/You chose 136 CVs\. Up to 100 per upload is recommended/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only 50 more CVs fit in this vacancy\. The last 86 will not be sent\./),
    ).toBeInTheDocument();
  });

  it('hides the folder button where folder picking does not work (iPhone)', async () => {
    const ua = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
    try {
      await open();
      await screen.findByText(/CVs used in this vacancy/);
      expect(screen.queryByRole('button', { name: 'Choose a folder' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Add a ZIP' })).toBeInTheDocument();
    } finally {
      ua.mockRestore();
    }
  });

  it('reads a vacancy link into the requirements box and shows where it was read from', async () => {
    const calls = await open((url) =>
      url.endsWith('/vacancies/read-link')
        ? {
            body: {
              host: 'jobs.example.com',
              title: 'Engineer',
              text: 'Needs Python and SQL daily.',
              words: 5,
              truncated: false,
              hash: 'a'.repeat(64),
            },
          }
        : undefined,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a vacancy link' }));
    await userEvent.type(screen.getByLabelText(/^Vacancy link/), 'https://jobs.example.com/1');
    await userEvent.click(screen.getByRole('button', { name: 'Read the page' }));
    expect(await screen.findByText(/Read from jobs\.example\.com · 5 words/)).toBeInTheDocument();
    expect((screen.getByLabelText(/^Requirements/) as HTMLTextAreaElement).value).toBe(
      'Needs Python and SQL daily.',
    );
    const call = calls.find((c) => c.url.endsWith('/vacancies/read-link'))!;
    expect(JSON.parse(String(call.init!.body))).toEqual({ url: 'https://jobs.example.com/1' });
  });

  it('shows one plain line when the page cannot be read, and the paste box is still there', async () => {
    await open((url) =>
      url.endsWith('/vacancies/read-link')
        ? {
            status: 400,
            body: {
              message: "Couldn't read that page. Paste the text instead.",
              code: 'LINK_UNREADABLE',
            },
          }
        : undefined,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a vacancy link' }));
    await userEvent.type(
      screen.getByLabelText(/^Vacancy link/),
      'https://intranet.example/x{Enter}',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't read that page. Paste the text instead.",
    );
    expect(screen.getByLabelText(/^Requirements/)).toBeInTheDocument();
  });
});

describe('Results: one summary line and the skipped list (spec 6.1.4)', () => {
  const doc = (n: number, state: string, score: number | null = null) => ({
    screeningId: `S${n}`,
    documentId: `D${n}`,
    filename: `cv${n}.pdf`,
    uploadedAt: `2026-10-01T10:00:0${n}Z`,
    parseStatus: 'parsed',
    erased: false,
    state,
    candidateName: null,
    band: score === null ? null : 'possible_match',
    score:
      score === null
        ? null
        : {
            value: score,
            breakdown: { formula: 'f', earned: 1, possible: 2, mandatoryGaps: 0, items: [] },
          },
    knockoutTriggered: false,
    injectionSuspected: false,
    error: null,
    decision: null,
  });

  it('says how many are ready, being read and need a look, and lists what was skipped', async () => {
    mockFetch((url) => {
      if (url.endsWith('/vacancies/VS/candidates'))
        return {
          body: {
            counts: { total: 3, queued: 1, failed: 0, manual: 1, undecided: 1 },
            aiActive: true,
            candidates: [
              doc(1, 'completed', 80),
              doc(2, 'queued'),
              { ...doc(3, 'manual'), parseStatus: 'empty' },
            ],
          },
        };
      if (url.endsWith('/vacancies/VS/skipped'))
        return {
          body: {
            skipped: [
              { filename: 'resumes.zip › photo.jpg', reason: 'Only PDF, DOCX and TXT files' },
              { filename: 'old.pdf', reason: 'Already uploaded for this vacancy' },
            ],
          },
        };
      if (url.includes('/screenings/')) return { body: { summary: null, assessments: [] } };
      return { body: {} };
    });
    render(<Results vacancyId="VS" onTable={() => undefined} />);
    expect(await screen.findByText('1 ready, 1 being read, 1 need a look')).toBeInTheDocument();
    expect(await screen.findByText(/2 skipped,/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'see which' }));
    expect(
      screen.getByText(/resumes\.zip › photo\.jpg: Only PDF, DOCX and TXT files/),
    ).toBeInTheDocument();
    expect(screen.getByText(/old\.pdf: Already uploaded for this vacancy/)).toBeInTheDocument();
  });
});
