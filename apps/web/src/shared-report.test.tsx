import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedReportSnapshot, SnapshotCandidate } from '@cv/shared';
import { App } from './App';
import { session } from './api';
import { ShareReport } from './pages/ShareReport';
import { SharedReport } from './pages/SharedReport';

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
beforeEach(() => {
  session.set('t');
  window.location.hash = '';
});
afterEach(() => vi.unstubAllGlobals());

const cand = (n: number, extra: Partial<SnapshotCandidate> = {}): SnapshotCandidate => ({
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
  expanded: n <= 15,
  summary: n <= 15 ? `Reason for ${n}.` : null,
  quotes: n <= 15 ? [{ requirement: 'Routing', quote: `Designed the BGP peering ${n}` }] : [],
  missing: n <= 15 ? 'Kubernetes' : null,
  ...extra,
});
const report = (n = 3, extra: Partial<SharedReportSnapshot> = {}): SharedReportSnapshot => ({
  version: 1,
  runId: 'ABCD1234',
  title: 'Backend Engineer',
  takenAt: '2026-10-02T10:00:00Z',
  createdBy: 'Ayla',
  includeNames: false,
  includeQuotes: true,
  counts: { total: n + 1, read: n + 1, scored: n, needLook: 1, stopped: 0, unread: 1 },
  role: { must: ['Routing', 'Kubernetes'], nice: ['Python'], ignored: [] },
  method: {
    criteriaVersion: 2,
    frozenAt: '2026-10-01T09:00:00Z',
    provider: 'google',
    model: 'gemini-x',
  },
  bands: { strong: 0, good: n, partial: 0, limited: 0, human: 1 },
  candidates: Array.from({ length: n }, (_, i) => cand(i + 1)),
  expandedCount: 15,
  unread: [{ label: 'Candidate 09', reason: 'Scan only: no readable text in the file' }],
  changes: [
    { text: 'Kubernetes: must-have to nice-to-have', by: 'Ayla', at: '2026-10-02T09:00:00Z' },
  ],
  decisions: [
    { label: 'Candidate 01', outcome: 'shortlist', by: 'Ayla', at: '2026-10-02T09:30:00Z' },
  ],
  ...extra,
});
const opened = (r: SharedReportSnapshot) => ({
  id: 'R1',
  sharedBy: 'Ayla',
  sharedAt: '2026-10-02T10:00:00Z',
  expiresAt: '2026-11-01T10:00:00Z',
  report: r,
});

describe('Shared report (spec 6.5)', () => {
  it('shows the snapshot with its date, who shared it, pseudonyms, reasons, quotes and what was not read', async () => {
    mockFetch(() => ({ body: opened(report()) }));
    render(<SharedReport id="R1" />);
    expect(await screen.findByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument();
    expect(screen.getByText(/Snapshot of/)).toBeInTheDocument();
    expect(screen.getByText(/Shared by Ayla/)).toBeInTheDocument();
    expect(screen.getByText('Showing all 3 scored')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /1\. Candidate 01/ })).toBeInTheDocument();
    expect(screen.getByText('Reason for 1.')).toBeInTheDocument();
    expect(screen.getByText(/Designed the BGP peering 1/)).toBeInTheDocument();
    expect(screen.getByText(/Candidate 09: Scan only/)).toBeInTheDocument();
    expect(screen.getByText(/Recruiter decision, separate from the AI match/)).toBeInTheDocument();
    expect(screen.getByText(/Kubernetes: must-have to nice-to-have/)).toBeInTheDocument();
    expect(screen.getByText(/Candidates appear as numbers/)).toBeInTheDocument();
    // The snapshot has no way to change anything.
    expect(screen.queryByRole('button', { name: /reveal|shortlist|stop/i })).toBeNull();
  });

  it('shows a real name only when the snapshot carries one, and says quotes were left out', async () => {
    mockFetch(() => ({
      body: opened(
        report(2, {
          includeNames: true,
          includeQuotes: false,
          candidates: [cand(1, { name: 'Alice Full', quotes: [] }), cand(2, { quotes: [] })],
        }),
      ),
    }));
    render(<SharedReport id="R1" />);
    expect(await screen.findByText(/Alice Full/)).toBeInTheDocument();
    expect(screen.getByText(/Real names are shown only for candidates/)).toBeInTheDocument();
    expect(screen.getByText(/Quotes from CVs were left out/)).toBeInTheDocument();
    expect(screen.queryByText(/Designed the BGP/)).toBeNull();
  });

  it('keeps the top 15 expanded and says how many are shown', async () => {
    mockFetch(() => ({ body: opened(report(20)) }));
    render(<SharedReport id="R1" />);
    expect(await screen.findByText('Showing 15 of 20 scored')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 20' }));
    expect(screen.getByText('Showing all 20 scored')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Show details' })).toHaveLength(5);
  });

  it('says plainly when the link has expired or was revoked', async () => {
    mockFetch(() => ({ status: 410, body: { message: 'gone', code: 'REPORT_GONE' } }));
    render(<SharedReport id="R1" />);
    expect(
      await screen.findByText(
        'This report is no longer available. Ask the recruiter for a new link.',
      ),
    ).toBeInTheDocument();
  });

  it('says plainly when the person is not on the list', async () => {
    mockFetch(() => ({ status: 403, body: { message: 'no', code: 'REPORT_DENIED' } }));
    render(<SharedReport id="R1" />);
    expect(
      await screen.findByText("You don't have access to this report. Ask the recruiter."),
    ).toBeInTheDocument();
  });

  it('offers a retry when the report cannot be opened', async () => {
    mockFetch(() => ({ status: 500, body: { message: 'boom' } }));
    render(<SharedReport id="R1" />);
    expect(await screen.findByText(/could not be opened/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a person with no role lands on the reports shared with them and can open one', async () => {
    window.location.hash = '#/';
    mockFetch((url) => {
      if (url.endsWith('/me'))
        return { body: { userId: 'U', email: 'm@x.az', displayName: 'Manager', roles: [] } };
      if (url.endsWith('/reports/mine'))
        return {
          body: {
            reports: [
              {
                id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
                title: 'Backend Engineer',
                sharedBy: 'Ayla',
                sharedAt: '2026-10-02T10:00:00Z',
                expiresAt: '2026-11-01T10:00:00Z',
              },
            ],
          },
        };
      return { body: opened(report()) };
    });
    render(<App check={async () => ({ state: 'up' as const })} />);
    expect(
      await screen.findByRole('heading', { name: 'Reports shared with me' }),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Backend Engineer' });
    expect(link).toHaveAttribute('href', '#/reports/01ARZ3NDEKTSV4RRFFQ69G5FAV');
    // No recruiter navigation for a person with no role.
    expect(screen.queryByRole('link', { name: 'New screening' })).toBeNull();
    window.location.hash = '#/reports/01ARZ3NDEKTSV4RRFFQ69G5FAV';
    expect(await screen.findByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument();
  });
});

describe('Share panel (spec 6.5)', () => {
  const share = (extra: Record<string, unknown> = {}) => ({
    id: 'SH1',
    createdAt: '2026-10-02T10:00:00Z',
    expiresAt: '2026-11-01T10:00:00Z',
    revokedAt: null,
    state: 'active',
    sharedBy: 'Ayla',
    includeNames: false,
    includeQuotes: true,
    viewers: [{ id: 'P1', name: 'Manager', email: 'm@x.az' }],
    openCount: 2,
    opens: [
      { by: 'Manager', at: '2026-10-03T08:00:00Z', outcome: 'ok' },
      { by: 'Intruder', at: '2026-10-03T09:00:00Z', outcome: 'denied' },
    ],
    ...extra,
  });

  it('is not offered while the scan is running, and says why', async () => {
    mockFetch(() => ({ body: { shares: [] } }));
    render(<ShareReport vacancyId="V" blocked="A shared link is offered when the scan is done." />);
    expect(screen.getByText(/offered when the scan is done/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share as a link' })).toBeDisabled();
  });

  it('names the people, warns about names and quotes, creates a link and copies it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const calls = mockFetch((url, init) => {
      if (url.includes('/reports/people'))
        return { body: { people: [{ id: 'P1', displayName: 'Manager', email: 'm@x.az' }] } };
      if (url.endsWith('/vacancies/V/shares') && init?.method === 'POST')
        return { body: { id: 'NEWID', expiresAt: '2026-11-01T10:00:00Z' } };
      if (url.endsWith('/vacancies/V/shares')) return { body: { shares: [] } };
      return { body: {} };
    });
    render(<ShareReport vacancyId="V" blocked={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share as a link' }));
    expect(screen.getByRole('button', { name: 'Create link' })).toBeDisabled();
    expect(
      screen.getByText(/Quotes are text from resumes and count as personal data/),
    ).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Manager/ }));
    expect(screen.queryByText(/Real names will be visible/)).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: /Include real names/ }));
    expect(
      screen.getByText('Real names will be visible to the people you choose.'),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Link works for'), '14');
    await userEvent.click(screen.getByRole('checkbox', { name: /Include quotes/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByText(/The link is ready/)).toBeInTheDocument();
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init!.body))).toEqual({
      viewerIds: ['P1'],
      expiresInDays: 14,
      includeNames: true,
      includeQuotes: false,
    });
    expect((screen.getByLabelText('Report link') as HTMLInputElement).value).toMatch(
      /#\/reports\/NEWID$/,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#\/reports\/NEWID$/));
  });

  it('lists what was shared, who opened it, and revokes a link', async () => {
    let revoked = false;
    const calls = mockFetch((url, init) => {
      if (url.endsWith('/shares/SH1/revoke') && init?.method === 'POST') {
        revoked = true;
        return { body: { revoked: true } };
      }
      if (url.endsWith('/vacancies/V/shares'))
        return {
          body: {
            shares: [share(revoked ? { state: 'revoked', revokedAt: '2026-10-04T00:00:00Z' } : {})],
          },
        };
      return { body: {} };
    });
    render(<ShareReport vacancyId="V" blocked={null} />);
    const item = (await screen.findByText(/Snapshot of/)).closest('li')!;
    expect(within(item).getByText(/works until/)).toBeInTheDocument();
    expect(
      within(item).getByText(/For Manager\. Pseudonyms only\. Quotes included\./),
    ).toBeInTheDocument();
    await userEvent.click(within(item).getByText(/Opened 2 times/));
    expect(within(item).getByText(/Intruder tried to open, not on the list/)).toBeInTheDocument();
    await userEvent.click(within(item).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/shares/SH1/revoke'))).toBe(true));
    expect(await screen.findByText(/· revoked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });
});
