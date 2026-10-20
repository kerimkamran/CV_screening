import { describe, expect, it } from 'vitest';
import {
  crossedMilestone,
  etaMinutes,
  firstNameOf,
  isSlow,
  litStars,
  progressOf,
  ringIcon,
  stableMinutes,
  titleFor,
} from './coffeebay-logic';
import type { BatchStatus } from './intake';

const status = (by: Partial<Record<string, number>>, upload = {}): BatchStatus =>
  ({
    batch: { id: 'B', vacancyId: 'V', createdAt: '', createdBy: 'x', fileCount: 0, mine: true },
    lastReceivedAt: null,
    counts: {
      upload: {
        total: 10,
        received: 10,
        notReceived: 0,
        vacancyFull: 0,
        rejected: 0,
        duplicate: 0,
        ...upload,
      },
      byStatus: by as BatchStatus['counts']['byStatus'],
    },
  }) as BatchStatus;

describe('the first name in the greeting', () => {
  it('uses the first word only when it looks like a name', () => {
    expect(firstNameOf('Aysel Məmmədova')).toBe('Aysel');
    expect(firstNameOf('Əli Quliyev')).toBe('Əli');
    expect(firstNameOf('UAT Recruiter')).toBeNull();
    expect(firstNameOf('Admin')).toBeNull();
    expect(firstNameOf('Məmmədova, Aysel')).toBeNull(); // surname first: never greet the surname
    expect(firstNameOf('a.b@azerconnect.az')).toBeNull();
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});

describe('the progress of a batch', () => {
  it('counts sent, finished and ready from the server statuses', () => {
    const p = progressOf(
      status({ analyzed: 4, needs_look: 1, failed: 1, analyzing: 3, not_sent: 1 }),
      null,
    );
    expect(p).toMatchObject({ total: 10, ready: 5, done: 6, failed: 1, notSent: 1, analyzing: 3 });
    expect(p.phase).toBe('reading');
    expect(p.p).toBeCloseTo(0.6);
  });
  it('is finished when nothing is being read and nothing is held for sending', () => {
    const p = progressOf(status({ analyzed: 9, not_sent: 1 }), null);
    expect(p.phase).toBe('finished');
    expect(p.notSent).toBe(1);
  });
  it('lights the 14 stars in proportion', () => {
    expect(litStars(0)).toBe(0);
    expect(litStars(0.5)).toBe(7);
    expect(litStars(1)).toBe(14);
    expect(litStars(2)).toBe(14);
  });
  it('announces 25, 50 and 75 % once each', () => {
    expect(crossedMilestone(0.2, 0.3)).toBe(25);
    expect(crossedMilestone(0.3, 0.4)).toBeNull();
    expect(crossedMilestone(0.4, 0.8)).toBe(75);
  });
});

describe('the time left', () => {
  const t0 = 1_000_000;
  const at = (s: number, done: number) => ({ t: t0 + s * 1000, done });
  it('is hidden before 45 seconds of samples or fewer than 3 finished CVs', () => {
    expect(etaMinutes([at(0, 0), at(30, 5)], t0 + 30_000, 100)).toBeNull();
    expect(etaMinutes([at(0, 0), at(60, 2)], t0 + 60_000, 100)).toBeNull();
  });
  it('uses the rate of the last two minutes', () => {
    // 10 CVs per minute over the window, 70 left: 7 minutes.
    expect(etaMinutes([at(0, 0), at(60, 10), at(120, 20), at(180, 30)], t0 + 180_000, 100)).toBe(7);
  });
  it('changes the shown minutes only when lower, or at least 2 higher', () => {
    expect(stableMinutes(null, 6)).toBe(6);
    expect(stableMinutes(6, 7)).toBe(6);
    expect(stableMinutes(6, 5)).toBe(5);
    expect(stableMinutes(6, 8)).toBe(8);
    expect(stableMinutes(6, null)).toBe(6);
  });
  it('is slow after 3 minutes without a new result', () => {
    expect(isSlow(0, 179_000)).toBe(false);
    expect(isSlow(0, 181_000)).toBe(true);
  });
});

describe('tab title and icon', () => {
  const same = (s: string) => s;
  it('shows the count, then the ready title', () => {
    expect(titleFor(42, 100, false, same)).toBe('(42/100) parallax');
    expect(titleFor(100, 100, true, same)).toBe('✓ Ready · parallax');
  });
  it('draws a data: ring that the CSP allows, with a check mark when done', () => {
    const run = decodeURIComponent(ringIcon(0.5, false));
    expect(ringIcon(0.5, false)).toMatch(/^data:image\/svg\+xml,/);
    expect(run).toContain('stroke-dasharray');
    expect(decodeURIComponent(ringIcon(1, true))).toContain('M10.5 16.5');
  });
});
