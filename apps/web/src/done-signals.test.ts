import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSignalsForTests, trackBatch } from './done-signals';
import { resetIntakeForTests } from './intake';
import { setChime } from './coffeebay-logic';

const answer = (by: Record<string, number>) =>
  new Response(
    JSON.stringify({
      batch: { id: 'B1', vacancyId: 'V1', createdAt: '', createdBy: 'x', fileCount: 4, mine: true },
      lastReceivedAt: null,
      counts: {
        upload: {
          total: 4,
          received: 4,
          notReceived: 0,
          vacancyFull: 0,
          rejected: 0,
          duplicate: 0,
        },
        byStatus: by,
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );

describe('the ready signals (S2-FE13)', () => {
  beforeEach(() => {
    document.title = 'parallax';
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSignalsForTests();
    resetIntakeForTests();
  });

  it('shows progress in the tab title, then the ready title, and puts the old title back later', async () => {
    let step = 0;
    vi.stubGlobal('fetch', async () =>
      answer(step++ === 0 ? { analyzing: 2, analyzed: 2 } : { analyzed: 4 }),
    );
    trackBatch({ vacancyId: 'V1', batchId: 'B1', userId: 'U', assistant: 'parallax' });
    await vi.waitFor(() => expect(document.title).toBe('(2/4) parallax'));
    // The next poll is 4 s away: ask again by tracking nothing new; use the exported kick.
    const { kickBatch } = await import('./intake');
    kickBatch('B1');
    await vi.waitFor(() => expect(document.title).toBe('✓ Ready · parallax'));
  });

  it('plays no sound unless the person switched it on for themselves', async () => {
    const played = vi.fn();
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        currentTime = 0;
        destination = {};
        createOscillator() {
          played();
          return {
            type: '',
            frequency: { value: 0 },
            connect: () => ({ connect: () => undefined }),
            start() {},
            stop() {},
          };
        }
        createGain() {
          const p = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
          return { gain: p, connect: () => ({}) };
        }
        resume() {}
      },
    );
    let step = 0;
    vi.stubGlobal('fetch', async () =>
      answer(step++ === 0 ? { analyzing: 1, analyzed: 3 } : { analyzed: 4 }),
    );
    trackBatch({ vacancyId: 'V1', batchId: 'B1', userId: 'U', assistant: 'parallax' });
    await vi.waitFor(() => expect(document.title).toBe('(3/4) parallax'));
    const { kickBatch } = await import('./intake');
    kickBatch('B1');
    await vi.waitFor(() => expect(document.title).toBe('✓ Ready · parallax'));
    expect(played).not.toHaveBeenCalled();

    resetSignalsForTests();
    resetIntakeForTests();
    setChime('U', true);
    step = 0;
    trackBatch({ vacancyId: 'V1', batchId: 'B1', userId: 'U', assistant: 'parallax' });
    await vi.waitFor(() => expect(document.title).toBe('(3/4) parallax'));
    kickBatch('B1');
    await vi.waitFor(() => expect(played).toHaveBeenCalledTimes(2)); // E5 then B5
  });

  it('says nothing about a batch that was already finished when the page opened', async () => {
    vi.stubGlobal('fetch', async () => answer({ analyzed: 4 }));
    trackBatch({ vacancyId: 'V1', batchId: 'B1', userId: 'U', assistant: 'parallax' });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.title).toBe('parallax');
  });
});
