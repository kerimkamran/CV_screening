import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../api';
import { resetIntakeForTests } from '../intake';
import { resetSignalsForTests } from '../done-signals';
import type { VacancyView } from '../pool';
import { BatchPanel } from './BatchPanel';

const VID = '0'.repeat(25) + 'V';
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

const item = (n: number, status: string, extra = {}) => ({
  itemId: `I${n}`,
  parentItemId: null,
  position: n,
  filename: `cv${n}.pdf`,
  clientPath: null,
  size: 1000,
  status,
  code: null,
  message: null,
  documentId: status === 'analyzed' || status === 'failed' ? `D${n}` : null,
  container: false,
  ...extra,
});
const batch = (mine: boolean, by: Record<string, number>, items?: unknown[]) => ({
  batch: {
    id: 'B1',
    vacancyId: VID,
    createdAt: '2026-10-20T10:00:00Z',
    createdBy: 'Aysel',
    fileCount: 6,
    mine,
  },
  lastReceivedAt: null,
  counts: {
    upload: { total: 6, received: 6, notReceived: 0, vacancyFull: 0, rejected: 0, duplicate: 0 },
    byStatus: by,
  },
  ...(items ? { items } : {}),
});
const vacancy = { id: VID, canEdit: true, archived: false } as unknown as VacancyView;
const user = { id: 'U1', displayName: 'Aysel Məmmədova' };

function serve(opts: { mine: boolean; by: Record<string, number>; items?: unknown[] }) {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const url = String(u);
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
      return json({ requeued: 1, resend: [] });
    }
    if (url.endsWith('/intake'))
      return json({
        used: 6,
        limit: 500,
        maxFileMb: 10,
        maxZipMb: 100,
        accepts: [],
        latestBatch: { id: 'B1', createdAt: '', createdBy: 'Aysel', fileCount: 6, mine: opts.mine },
      });
    if (url.includes('/upload-batches/B1'))
      return json(batch(opts.mine, opts.by, url.includes('items=1') ? opts.items : undefined));
    if (url.endsWith('/assistant/config'))
      return json({ enabled: true, name: 'SenAI', features: {}, unavailableMessage: '' });
    return json({});
  });
  return posts;
}
const props = {
  vacancy,
  user,
  justStarted: false,
  onChanged: () => undefined,
  onWatching: () => undefined,
};

describe('the batch panel (S2-FE8, FE12)', () => {
  beforeEach(() => {
    session.set('t');
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetIntakeForTests();
    resetSignalsForTests();
  });

  it('greets the person who started the batch by first name and shows the counts', async () => {
    serve({ mine: true, by: { analyzing: 4, analyzed: 2 } });
    render(<BatchPanel {...props} />);
    expect(
      await screen.findByRole('heading', { name: 'Hey Aysel, go grab a coffee and relax.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/SenAI is reading your 6 CVs for you\./)).toBeInTheDocument();
    expect(screen.getByText(/Sent 6 of 6 · Analyzed 2 of 6/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See results so far' })).toBeInTheDocument();
  });

  it('hides the screen on request and leaves a button to bring it back', async () => {
    serve({ mine: true, by: { analyzing: 4, analyzed: 2 } });
    render(<BatchPanel {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    expect(screen.queryByTestId('coffeebay')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show the waiting screen' }));
    expect(await screen.findByTestId('coffeebay')).toBeInTheDocument();
  });

  it("shows a colleague's batch without the scene, and without Retry or Close", async () => {
    serve({ mine: false, by: { analyzed: 5, failed: 1 } });
    render(<BatchPanel {...props} vacancy={{ ...vacancy, canEdit: false } as VacancyView} />);
    expect(await screen.findByText(/Latest upload/)).toBeInTheDocument();
    expect(screen.queryByTestId('coffeebay')).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry failed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('ends with a plain summary and a Close that removes the panel', async () => {
    serve({ mine: true, by: { analyzed: 4, needs_look: 1, failed: 1 } });
    render(<BatchPanel {...props} />);
    expect(
      await screen.findByRole('heading', { name: '5 of 6 CVs are ready, Aysel.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/4 analyzed · 1 need a human look · 1 analysis failed/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('batch-panel')).toBeNull();
  });

  it('lists the files, filters to "Needs attention", and retries one failed CV on its own', async () => {
    const posts = serve({
      mine: true,
      by: { analyzed: 2, failed: 1 },
      items: [item(0, 'analyzed'), item(1, 'analyzed'), item(2, 'failed')],
    });
    render(<BatchPanel {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    expect(await screen.findByText('cv2.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Needs attention 1/ }));
    expect(screen.queryByText('cv0.pdf')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]!.url).toMatch(/\/vacancies\/.*\/retry-failed$/);
    expect(posts[0]!.body).toEqual({ batchId: 'B1', documentId: 'D2' });
  });

  it('says status only: no score appears on a file row', async () => {
    serve({ mine: true, by: { analyzed: 1 }, items: [item(0, 'analyzed')] });
    render(<BatchPanel {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    expect(await screen.findByText('Analyzed')).toBeInTheDocument();
    expect(screen.queryByText(/%|score/i)).toBeNull();
  });
});
