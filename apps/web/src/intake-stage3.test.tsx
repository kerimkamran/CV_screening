import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, session } from './api';
import {
  announceSlice,
  cancelRun,
  checkFiles,
  DEFAULT_LIMITS,
  getRun,
  resetIntakeForTests,
  startBatch,
  watchBatch,
  type Checked,
} from './intake';

/** Stage 3 bulk-upload hardening in the tab (S3-UP-01, 03, 05, 06). */

const file = (name: string, size = 10) => {
  const f = new File(['x'.repeat(size)], name);
  return f;
};
const rows = (names: string[]): Checked[] =>
  checkFiles(
    names.map((n, i) => file(n, 10 + i)),
    DEFAULT_LIMITS,
  ).added;
const named = (n: number, prefix = 'cv', ext = 'pdf') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}.${ext}`);
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  resetIntakeForTests();
  session.set('t');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetIntakeForTests();
});

describe('the announce slice (S3-UP-01)', () => {
  it('room 500 and 501 loose files: 500 announced, the last one beyond the room', () => {
    const s = announceSlice(rows(named(501)), 500);
    expect(s.announced).toHaveLength(500);
    expect(s.beyondRoom.map((r) => r.name)).toEqual(['cv500.pdf']);
    expect(s.beyondLimit).toEqual([]);
  });

  it('room 20, 1 ZIP and 30 loose: 21 announced, 10 beyond the room, list order kept', () => {
    const s = announceSlice(rows(['all.zip', ...named(30)]), 20);
    expect(s.announced).toHaveLength(21);
    expect(s.announced[0]!.name).toBe('all.zip');
    expect(s.beyondRoom).toHaveLength(10);
  });

  it('room 500, 2 ZIPs and 600 loose: 2 ZIPs + 498 loose; 102 named before the click', () => {
    const s = announceSlice(rows(['a.zip', ...named(600), 'b.zip']), 500);
    expect(s.announced).toHaveLength(500);
    expect(s.announced.filter((r) => r.name.endsWith('.zip'))).toHaveLength(2);
    expect(s.beyondLimit.length + s.beyondRoom.length).toBe(102);
    expect(s.beyondLimit.map((r) => r.name)).toEqual(['cv498.pdf', 'cv499.pdf']);
  });

  it('without the intake numbers only the 500 cap applies', () => {
    const s = announceSlice(rows(named(510)), null);
    expect(s.announced).toHaveLength(500);
    expect(s.beyondLimit).toHaveLength(10);
  });
});

describe('sending (S3-UP-01, 03, 05, 06)', () => {
  const made = (n: number) => ({
    batchId: 'B1',
    items: Array.from({ length: n }, (_, i) => ({ itemId: `I${i}`, position: i })),
  });

  it('a folder of 501 files sends one announce with the first 500 names and no 4xx', async () => {
    const posts: { files: { name: string }[] }[] = [];
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      if (String(u).endsWith('/upload-batches') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        return json(made(body.files.length));
      }
      return json({ results: [] });
    });
    const r = await startBatch('VID', rows(named(501)), 500);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.files).toHaveLength(500);
    expect(posts[0]!.files[499]!.name).toBe('cv499.pdf');
    expect(r).toEqual({ batchId: 'B1', sent: 500, leftOut: 1 });
  });

  it('a 413 TOO_MANY_FILES answer throws the server sentence and starts nothing', async () => {
    vi.stubGlobal('fetch', async () =>
      json({ code: 'TOO_MANY_FILES', message: 'Up to 500 files per upload.' }, 413),
    );
    const err = await startBatch('VID', rows(named(3)), 500).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 413, code: 'TOO_MANY_FILES' });
    expect(err.message).toBe('Up to 500 files per upload.');
    expect(getRun('VID')).toBeNull();
  });

  it('a server_error answer is sent again once after 2 s; a second one shows "Could not send"', async () => {
    const hits: Record<string, number> = {};
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.endsWith('/upload-batches') && init?.method === 'POST') return json(made(2));
      const m = /item=(\w+)/.exec(url);
      if (m) {
        hits[m[1]!] = (hits[m[1]!] ?? 0) + 1;
        return json({
          results: [
            m[1] === 'I1' ? { status: 'skipped', code: 'server_error' } : { status: 'queued' },
          ],
        });
      }
      return json({});
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startBatch('VID', rows(named(2)));
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() =>
      expect(getRun('VID')!.items.map((i) => i.client)).toEqual(['sent', 'failed']),
    );
    expect(hits).toEqual({ I0: 1, I1: 2 });
    const failed = getRun('VID')!.items[1]!;
    expect(failed.error).toBe('The server could not process this file');
    expect(failed.file).not.toBeNull(); // the tab still holds the file for Retry
  });

  it('a 2xx answer without results counts as sent (the L1 mock answers { ok: true })', async () => {
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) =>
      String(u).endsWith('/upload-batches') && init?.method === 'POST'
        ? json(made(1))
        : json({ ok: true }),
    );
    await startBatch('VID', rows(named(1)));
    await waitFor(() => expect(getRun('VID')!.items[0]!.client).toBe('sent'));
  });

  it('"Stop sending files": aborts in flight, one cancel call, no retry after 2 s, rows stopped', async () => {
    const cancels: string[] = [];
    let uploads = 0;
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.endsWith('/upload-batches') && init?.method === 'POST') return json(made(6));
      if (url.endsWith('/cancel')) {
        cancels.push(url);
        return json({ cancelled: 5 });
      }
      if (url.includes('item=')) {
        uploads++;
        // Never answers by itself: only the abort ends it.
        return new Promise<Response>((_res, rej) =>
          init?.signal?.addEventListener('abort', () =>
            rej(new DOMException('Aborted', 'AbortError')),
          ),
        );
      }
      return json({});
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startBatch('VID', rows(named(6)));
    await waitFor(() => expect(uploads).toBe(3));
    await cancelRun('VID');
    await vi.advanceTimersByTimeAsync(3000);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]).toMatch(/\/upload-batches\/B1\/cancel$/);
    expect(uploads).toBe(3); // nothing more was sent, and nothing was retried
    const run = getRun('VID')!;
    expect(run.items.every((i) => i.client === 'stopped' && i.file === null)).toBe(true);
    expect(run.stop).toEqual({ state: 'done', sent: 0, notSent: 6 });
  });

  it('when the cancel call fails the stop says so and the files are still not sent', async () => {
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.endsWith('/upload-batches') && init?.method === 'POST') return json(made(2));
      if (url.endsWith('/cancel')) return json({ message: 'down' }, 503);
      return new Promise<Response>(() => undefined);
    });
    await startBatch('VID', rows(named(2)));
    await cancelRun('VID');
    expect(getRun('VID')!.stop?.state).toBe('failed');
    expect(getRun('VID')!.items.every((i) => i.client === 'stopped')).toBe(true);
  });

  it('a batch cancelled on another device stops this tab within one poll', async () => {
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.endsWith('/upload-batches') && init?.method === 'POST') return json(made(4));
      if (url.includes('/upload-batches/B1?'))
        return json({
          batch: { id: 'B1', vacancyId: 'VID', cancelledAt: '2026-11-21T10:00:00Z' },
          lastReceivedAt: null,
          counts: { upload: { total: 4, received: 0, notReceived: 0 }, byStatus: { analyzing: 0 } },
        });
      return new Promise<Response>(() => undefined);
    });
    await startBatch('VID', rows(named(4)));
    const stop = watchBatch('B1');
    await waitFor(() => expect(getRun('VID')!.stop?.state).toBe('done'));
    stop();
    expect(getRun('VID')!.items.every((i) => i.client === 'stopped')).toBe(true);
  });

  it('three ZIPs chosen together: never more than 1 ZIP in flight, never more than 3 requests', async () => {
    let live = 0;
    let zips = 0;
    let peak = 0;
    let zipPeak = 0;
    let done = 0;
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.endsWith('/upload-batches') && init?.method === 'POST') return json(made(7));
      if (url.includes('item=')) {
        const f = (init!.body as FormData).get('files') as File;
        const zip = f.name.endsWith('.zip');
        live++;
        if (zip) zips++;
        peak = Math.max(peak, live);
        zipPeak = Math.max(zipPeak, zips);
        await new Promise((r) => setTimeout(r, zip ? 30 : 5));
        live--;
        if (zip) zips--;
        done++;
        return json({ results: [] });
      }
      return json({});
    });
    await startBatch('VID', rows(['a.zip', 'b.zip', 'c.zip', ...named(4)]));
    await waitFor(() => expect(done).toBe(7));
    expect(zipPeak).toBe(1);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
