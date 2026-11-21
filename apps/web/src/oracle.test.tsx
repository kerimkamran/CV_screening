import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IMPORT_RUN_CODES } from '@cv/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from './api';
import { applyLang, tr } from './i18n';
import { countRows, runSentence, useOracle, type OracleState, type RunView } from './oracle';
import { OracleLink } from './pages/OracleLink';
import { OracleStrip } from './pages/OracleStrip';
import type { VacancyView } from './pool';
import { resetIntakeForTests } from './intake';

// Stage 3, S3-INT-14b: the recruiter's Oracle field, dialog and strip (checks B1-B22, the unit ones).
const VID = '0'.repeat(25) + 'V';
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const vacancy = {
  id: VID,
  canEdit: true,
  archived: false,
  hasDraft: false,
} as unknown as VacancyView;

const run = (over: Partial<RunView> = {}): RunView => ({
  runId: 'R1',
  mode: 'import',
  state: 'running',
  phase: 'listing',
  batchId: null,
  listed: 0,
  estimate: 120,
  counts: {},
  waitReason: null,
  errorCode: null,
  confirmReason: null,
  pauseEndsAt: null,
  startedBy: 'Aysel',
  createdAt: '2026-11-21T10:00:00Z',
  finishedAt: null,
  cancelRequested: false,
  ...over,
});
const state = (over: Partial<OracleState> = {}): OracleState => ({
  available: true,
  link: null,
  run: null,
  lastRun: null,
  goneCount: 0,
  staleDays: null,
  linkPolicy: 'open',
  room: 500,
  ...over,
});
const LINK = {
  ref: 'REQ-1',
  state: 'approved' as const,
  linkedBy: 'Aysel',
  linkedAt: '2026-11-21T10:00:00Z',
  canUnlink: true,
};

let calls: { method: string; url: string; body: unknown }[] = [];
function serve(answers: Record<string, (body: unknown) => Response>) {
  calls = [];
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const url = String(u);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    for (const [k, f] of Object.entries(answers))
      if (`${method} ${url}`.includes(k)) return f(init?.body);
    return json({});
  });
}

beforeEach(() => {
  session.set('t');
  applyLang('en');
  resetIntakeForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Oracle field and dialog (B2-B6)', () => {
  it('lists what is missing and sends nothing when pressed too early (B3)', async () => {
    serve({});
    render(
      <OracleLink
        vacancy={vacancy}
        oracle={state()}
        needs={['Save the role first.']}
        noticeTickedNow={false}
        userId="U1"
        onStarted={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import CVs from Oracle' }));
    expect(screen.getByText('Save the role first.')).toBeInTheDocument();
    expect(screen.getByText('Type the Oracle vacancy ID.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('one lookup; found: false shows one line tied to the field, no dialog (B4)', async () => {
    serve({ 'POST /api/vacancies': () => json({ found: false }) });
    render(
      <OracleLink
        vacancy={vacancy}
        oracle={state()}
        needs={[]}
        noticeTickedNow={false}
        userId="U1"
        onStarted={() => undefined}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Oracle vacancy ID/ }), 'NOPE');
    await userEvent.click(screen.getByRole('button', { name: 'Import CVs from Oracle' }));
    const line = await screen.findByText(
      'No Oracle vacancy has this ID. Check the number and try again.',
    );
    const field = screen.getByRole('textbox', { name: /Oracle vacancy ID/ });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toBe(line.id);
    expect(calls.filter((c) => c.url.endsWith('/oracle/lookup'))).toHaveLength(1);
    expect(screen.queryByTestId('oracle-dialog')).toBeNull();
  });

  it('a refusal shows its sentence, never its code (B4)', async () => {
    serve({
      'POST /api/vacancies': () =>
        json(
          {
            message: "Today's limit of calls to Oracle is used up. Try again tomorrow.",
            code: 'ORACLE_BUDGET',
          },
          429,
        ),
    });
    render(
      <OracleLink
        vacancy={vacancy}
        oracle={state()}
        needs={[]}
        noticeTickedNow={false}
        userId="U1"
        onStarted={() => undefined}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Oracle vacancy ID/ }), 'REQ-1');
    await userEvent.click(screen.getByRole('button', { name: 'Import CVs from Oracle' }));
    expect(
      await screen.findByText("Today's limit of calls to Oracle is used up. Try again tomorrow."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ORACLE_BUDGET');
    expect(document.body.textContent).not.toContain('429');
  });

  it('the dialog shows title, state, estimate and room; Start freezes a draft, then sends 1 import and never /start (B5, B6)', async () => {
    serve({
      '/oracle/lookup': () =>
        json({
          found: true,
          number: 'REQ-1',
          title: 'Network Engineer',
          state: 'Open',
          estimate: 120,
          room: 80,
        }),
      '/oracle/imports': () => json({ runId: 'R1' }, 202),
      '/criteria/freeze': () => json({}),
      '/notice-confirm': () => json({}),
    });
    const started = vi.fn();
    render(
      <OracleLink
        vacancy={{ ...vacancy, hasDraft: true } as VacancyView}
        oracle={state()}
        needs={[]}
        noticeTickedNow
        userId="U1"
        onStarted={started}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Oracle vacancy ID/ }), 'REQ-1');
    await userEvent.click(screen.getByRole('button', { name: 'Import CVs from Oracle' }));
    const dlg = await screen.findByTestId('oracle-dialog');
    expect(dlg).toHaveTextContent('Network Engineer · Open');
    expect(dlg).toHaveTextContent(
      'About 120 applications. Their CVs will be copied and analyzed by AI. Room for 80.',
    );
    expect(dlg).toHaveTextContent('More applications than fit: the oldest come first.');
    expect(dlg.querySelectorAll('button')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(started).toHaveBeenCalled());
    const posts = calls
      .filter((c) => c.method === 'POST')
      .map((c) => c.url.replace(/^.*\/api/, ''));
    expect(posts).toEqual([
      `/vacancies/${VID}/oracle/lookup`,
      `/vacancies/${VID}/notice-confirm`,
      `/vacancies/${VID}/criteria/freeze`,
      `/vacancies/${VID}/oracle/imports`,
    ]);
    expect(calls.find((c) => c.url.endsWith('/oracle/imports'))!.body).toEqual({
      ref: 'REQ-1',
      estimate: 120,
    });
  });

  it('Cancel closes the dialog with no request and focus back on the button (B5)', async () => {
    serve({
      '/oracle/lookup': () =>
        json({ found: true, number: 'REQ-1', title: 'T', state: 'Open', estimate: 3, room: 500 }),
    });
    render(
      <OracleLink
        vacancy={vacancy}
        oracle={state()}
        needs={[]}
        noticeTickedNow={false}
        userId="U1"
        onStarted={() => undefined}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Oracle vacancy ID/ }), 'REQ-1');
    const btn = screen.getByRole('button', { name: 'Import CVs from Oracle' });
    await userEvent.click(btn);
    await screen.findByTestId('oracle-dialog');
    const n = calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('oracle-dialog')).toBeNull();
    expect(calls.length).toBe(n);
    expect(btn).toHaveFocus();
  });

  it('linked: the ID as text and Unlink only when allowed (B17)', async () => {
    serve({ 'DELETE /api/vacancies': () => json({ unlinked: true }) });
    const done = vi.fn();
    const { rerender } = render(
      <OracleLink
        vacancy={vacancy}
        oracle={state({ link: LINK })}
        needs={[]}
        noticeTickedNow={false}
        userId="U1"
        onStarted={done}
      />,
    );
    expect(screen.getByText('Oracle vacancy ID REQ-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Unlink' })[0]!);
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    rerender(
      <OracleLink
        vacancy={vacancy}
        oracle={state({ link: { ...LINK, canUnlink: false } })}
        needs={[]}
        noticeTickedNow={false}
        userId="U1"
        onStarted={done}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
  });
});

describe('the strip (B7-B22)', () => {
  const strip = (s: OracleState, v = vacancy) =>
    render(<OracleStrip vacancy={v} oracle={s} reload={async () => undefined} focus={false} />);

  it('listing, then fetching (B7, B8)', () => {
    const { rerender } = strip(state({ link: LINK, run: run({ counts: { seen: 40 } }) }));
    expect(
      screen.getByText('Reading the application list from Oracle… 40 read so far.'),
    ).toBeInTheDocument();
    expect(screen.getByText('You can leave this page. The import continues.')).toBeInTheDocument();
    rerender(
      <OracleStrip
        vacancy={vacancy}
        oracle={state({
          link: LINK,
          run: run({ phase: 'fetching', listed: 120, batchId: 'B1', counts: { fetched: 12 } }),
        })}
        reload={async () => undefined}
        focus={false}
      />,
    );
    expect(screen.getByText('Fetched 12 of 120')).toBeInTheDocument();
  });

  it('paused: cause, count lines that add up, room, deadline, Continue and Cancel import (B10, B11)', async () => {
    serve({ '/confirm': () => json({ confirmed: true }) });
    strip(
      state({
        link: LINK,
        room: 100,
        run: run({
          state: 'awaiting_confirm',
          listed: 130,
          estimate: 120,
          confirmReason: 'above_estimate_and_room',
          pauseEndsAt: '2026-11-21T12:00:00Z',
          counts: {
            seen: 150,
            listed: 130,
            already: 5,
            withheld: 2,
            filtered: 8,
            preNotice: 1,
            noFile: 4,
          },
        }),
      }),
    );
    expect(
      screen.getByText(/more applications than the estimate you confirmed \(about 120\)/),
    ).toBeInTheDocument();
    expect(screen.getByText('150 applications in Oracle')).toBeInTheDocument();
    expect(screen.getByText('130 new CVs')).toBeInTheDocument();
    expect(
      screen.getByText('9 left out: not active, or applied before the AI notice date'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Room for 100. The oldest applications come first; 30 will not fit.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/If nobody answers by/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(calls.filter((c) => c.url.endsWith('/import-runs/R1/confirm'))).toHaveLength(1);
  });

  it('the count lines add up to the first number for 6 sets (B11)', () => {
    const sets = [
      { seen: 10, listed: 10, fetched: 10 },
      { seen: 12, listed: 5, fetched: 3, already: 4, noFile: 3 },
      { seen: 20, filtered: 5, preNotice: 5, withheld: 10 },
      { seen: 7, already: 7 },
      { seen: 9, listed: 9, fetched: 0 },
      {
        seen: 30,
        listed: 10,
        fetched: 8,
        already: 5,
        withheld: 5,
        filtered: 4,
        preNotice: 2,
        noFile: 4,
      },
    ];
    for (const c of sets) {
      for (const phase of ['paused', 'finished'] as const) {
        const r = countRows(c, phase);
        expect(r.total).toBe(c.seen);
        expect(r.lines.every((l) => l.n > 0)).toBe(true);
      }
    }
  });

  it('Cancel import asks once with focus on Keep importing, then sends 1 cancel (B12)', async () => {
    serve({ '/cancel': () => json({ cancelled: true }) });
    strip(state({ link: LINK, run: run({ phase: 'fetching', listed: 10, batchId: 'B1' }) }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(screen.getByRole('button', { name: 'Keep importing' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Keep importing' }));
    expect(calls).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel import' }).at(-1)!);
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/import-runs/R1/cancel'))).toHaveLength(1),
    );
  });

  it('finished: counts, Download report and Refresh; three empty states differ (B13, B14)', () => {
    const done = (counts: RunView['counts'], listed = 0) =>
      state({
        link: LINK,
        lastRun: run({
          state: 'completed',
          listed,
          batchId: listed ? 'B1' : null,
          finishedAt: '2026-11-21T11:00:00Z',
          counts,
        }),
      });
    const { rerender } = strip(done({ seen: 10, listed: 8, fetched: 8, already: 2 }, 8));
    expect(screen.getByText('8 CVs copied of 10 applications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download report' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    const texts = new Set<string>();
    for (const c of [{ seen: 0 }, { seen: 5, noFile: 5 }, { seen: 5, already: 5 }]) {
      rerender(
        <OracleStrip
          vacancy={vacancy}
          oracle={done(c)}
          reload={async () => undefined}
          focus={false}
        />,
      );
      texts.add(screen.getByTestId('oracle-strip').textContent ?? '');
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    }
    expect(texts.size).toBe(3);
  });

  it('every run code shows exactly one sentence, in English and Azerbaijani; an unknown code shows the general one (B15, B22)', () => {
    for (const lang of ['en', 'az'] as const) {
      act(() => applyLang(lang));
      for (const code of IMPORT_RUN_CODES) {
        const failed = runSentence({ state: 'failed', errorCode: code, waitReason: null });
        expect(failed).toBeTruthy();
        const { unmount } = strip(
          state({ link: LINK, lastRun: run({ state: 'failed', errorCode: code }) }),
        );
        expect(screen.getByText(tr(failed!))).toBeInTheDocument();
        if (code.includes('_')) expect(document.body.textContent).not.toContain(code);
        unmount();
      }
      const { unmount } = strip(
        state({ link: LINK, lastRun: run({ state: 'failed', errorCode: 'xyz_new' }) }),
      );
      expect(document.body.textContent).not.toContain('xyz_new');
      unmount();
    }
    act(() => applyLang('en'));
    expect(runSentence({ state: 'failed', errorCode: 'xyz', waitReason: null })).toBe(
      'The import did not finish. Try Refresh, or tell an administrator.',
    );
    expect(runSentence({ state: 'queued', errorCode: null, waitReason: 'oracle_budget' })).toMatch(
      /limit of calls/,
    );
    expect(runSentence({ state: 'queued', errorCode: null, waitReason: 'odd' })).toBe(
      'The import is waiting. It goes on by itself.',
    );
  });

  it('archived or read-only: no button except Download report (B16); reminder and gone lines (B18); no score (B19)', () => {
    strip(
      state({
        link: LINK,
        staleDays: 31,
        goneCount: 2,
        lastRun: run({
          state: 'completed',
          listed: 3,
          batchId: 'B1',
          counts: { seen: 3, listed: 3, fetched: 3 },
          finishedAt: '2026-10-01T10:00:00Z',
        }),
      }),
      { ...vacancy, archived: true } as VacancyView,
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Download report']);
    expect(screen.getByText(/Last refreshed 31 days ago/)).toBeInTheDocument();
    expect(
      screen.getByText('2 imported applicants are no longer active in Oracle.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('oracle-strip').textContent).not.toMatch(/\bscore\b|%/i);
  });

  it('the three stop labels are three different names, in English and Azerbaijani (B20)', () => {
    for (const lang of ['en', 'az'] as const) {
      act(() => applyLang(lang));
      const names = ['Stop sending files', 'Cancel import', 'Stop analysis'].map((s) => tr(s));
      expect(new Set(names).size).toBe(3);
    }
    act(() => applyLang('en'));
  });
});

describe('useOracle (B1, B9)', () => {
  function Probe({ id }: { id: string }) {
    const { state: s } = useOracle(id);
    return <p>{s === undefined ? 'loading' : s ? 'available' : 'hidden'}</p>;
  }

  it('a 404 hides the feature after 1 request and asks no more (B1)', async () => {
    serve({
      '/oracle': () =>
        json({ message: 'Oracle import is not available in this environment.' }, 404),
    });
    render(<Probe id={VID} />);
    expect(await screen.findByText('hidden')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(1);
  });

  it('polls every 4 s while a run is active and stops when it ends (B9)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    serve({
      '/oracle': () => {
        n++;
        return json(
          n < 3
            ? state({ link: LINK, run: run() })
            : state({ link: LINK, lastRun: run({ state: 'completed' }) }),
        );
      },
    });
    render(<Probe id={VID} />);
    await screen.findByText('available');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    expect(n).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(n).toBe(3);
  });
});
