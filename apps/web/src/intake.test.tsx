import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { session } from './api';
import { groupFiles, startIntake } from './intake';
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
afterEach(() => vi.unstubAllGlobals());

describe('intake grouping and sending (spec 6.1.4)', () => {
  it('sends each ZIP on its own and the other files in batches of 50', () => {
    const files = [
      ...Array.from({ length: 120 }, (_, i) => pdf(`cv${i}.pdf`)),
      new File(['PK'], 'batch.zip'),
      new File(['PK'], 'more.ZIP'),
    ];
    const g = groupFiles(files);
    expect(g.map((x) => x.length)).toEqual([50, 50, 20, 1, 1]);
    expect(g.slice(3).every(([f]) => /\.zip$/i.test(f!.name))).toBe(true);
  });

  it('puts the first group up before returning, and keeps sending the rest in the background', async () => {
    const calls = mockFetch(() => ({ body: { results: [] } }));
    const files = Array.from({ length: 130 }, (_, i) => pdf(`cv${i}.pdf`));
    await startIntake('VBG', files);
    // Only the first batch is guaranteed; the rest follow without being awaited.
    expect(
      calls.filter((c) => c.url.endsWith('/vacancies/VBG/documents')).length,
    ).toBeGreaterThanOrEqual(1);
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/vacancies/VBG/documents'))).toHaveLength(3),
    );
  });
});

describe('Home: folders, ZIPs, long lists and the vacancy link', () => {
  const home = async () => {
    mockFetch((url) => (url.endsWith('/me') ? { body: recruiter } : { body: [] }));
    render(<App check={up} />);
    await screen.findByLabelText('Position');
  };

  it('takes a whole folder, ignores operating-system litter, and folds a long list into one line', async () => {
    await home();
    const folder = [
      ...Array.from({ length: 12 }, (_, i) => pdf(`cv${i}.pdf`, `batch/cv${i}.pdf`)),
      pdf('.DS_Store', 'batch/.DS_Store'),
    ];
    await userEvent.upload(screen.getByLabelText('Choose a folder of resumes'), folder, {
      applyAccept: false,
    });
    expect(screen.getByText(/12 resumes added/)).toBeInTheDocument();
    expect(screen.queryByText('batch/cv3.pdf')).toBeNull(); // folded
    expect(screen.queryByText(/skipped/)).toBeNull(); // litter is never a line
    await userEvent.click(screen.getByRole('button', { name: 'Show the list' }));
    expect(screen.getByText('batch/cv3.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hide the list' }));
    expect(screen.queryByText('batch/cv3.pdf')).toBeNull();
  });

  it('accepts a ZIP, and says "N skipped, see which" instead of dropping files silently', async () => {
    await home();
    const zip = new File(['PK'], 'resumes.zip', { type: 'application/zip' });
    const junk = ['a.png', 'b.jpg', 'c.xlsx', 'd.pptx'].map((n) => new File(['x'], n));
    await userEvent.upload(screen.getByLabelText('Choose resume files'), [zip, ...junk], {
      applyAccept: false,
    });
    expect(
      screen.getByText(/1 resume added \(a ZIP is unpacked when you start\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/4 skipped,/)).toBeInTheDocument();
    expect(screen.queryByText(/a\.png: only/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'see which' }));
    expect(screen.getByText(/a\.png: only PDF, DOCX and TXT/)).toBeInTheDocument();
    expect(screen.getByText(/d\.pptx: only PDF, DOCX and TXT/)).toBeInTheDocument();
    // The same file added twice is reported too.
    await userEvent.upload(screen.getByLabelText('Choose resume files'), zip, {
      applyAccept: false,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('resumes.zip: added twice.');
  });

  it('reads a vacancy link into the requirements box and shows where it was read from', async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith('/me')) return { body: recruiter };
      if (url.endsWith('/vacancies/read-link'))
        return {
          body: {
            host: 'jobs.example.com',
            title: 'Engineer',
            text: 'Needs Python and SQL daily.',
            words: 5,
            truncated: false,
          },
        };
      return { body: [] };
    });
    render(<App check={up} />);
    await screen.findByLabelText('Position');
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
    mockFetch((url) =>
      url.endsWith('/me')
        ? { body: recruiter }
        : url.endsWith('/vacancies/read-link')
          ? {
              status: 400,
              body: {
                message: "Couldn't read that page. Paste the text instead.",
                code: 'LINK_UNREADABLE',
              },
            }
          : { body: [] },
    );
    render(<App check={up} />);
    await screen.findByLabelText('Position');
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

  it('says files are still being sent while the first results are open', async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/vacancies/VZ/candidates'))
        return {
          body: {
            counts: { total: 1, queued: 0, failed: 0, manual: 0, undecided: 1 },
            aiActive: true,
            candidates: [doc(1, 'completed', 70)],
          },
        };
      if (url.endsWith('/vacancies/VZ/documents') && init?.method === 'POST')
        return { body: { results: [] } };
      if (url.includes('/screenings/')) return { body: { summary: null, assessments: [] } };
      return { body: {} };
    });
    // 120 files: the first batch of 50 is in, 70 more are on their way.
    const files = Array.from({ length: 120 }, (_, i) => pdf(`cv${i}.pdf`));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (u: string, i?: RequestInit) => {
      if (String(u).endsWith('/vacancies/VZ/documents') && gate) await gate;
      return original(u, i);
    });
    const first = startIntake('VZ', files.slice(0, 50)).then(() => undefined);
    release();
    await first;
    render(<Results vacancyId="VZ" onTable={() => undefined} />);
    await screen.findByText(/1 read, 1 scored/);
    expect(screen.queryByText(/Sending/)).toBeNull(); // 50 of 50 sent
  });
});
