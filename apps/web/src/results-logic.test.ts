import { describe, expect, it } from 'vitest';
import type { CandidateRow } from './api';
import {
  bandMoves,
  hash01,
  layoutStars,
  linkStars,
  matchBand,
  orderCandidates,
  mustHaveTally,
  pseudonyms,
  reportCounts,
  skillChips,
  unreadReason,
} from './results-logic';

const row = (id: string, score: number | null, o: Partial<CandidateRow> = {}): CandidateRow =>
  ({
    screeningId: 's' + id,
    documentId: id,
    filename: id + '.pdf',
    uploadedAt: '2026-10-01T10:00:00Z',
    parseStatus: 'parsed',
    erased: false,
    state: score === null ? 'manual' : 'completed',
    candidateName: null,
    band: score === null ? 'needs_review' : 'strong_match',
    score: score === null ? null : { value: score, breakdown: { items: [] } as never },
    knockoutTriggered: false,
    injectionSuspected: false,
    error: null,
    decision: null,
    ...o,
  }) as CandidateRow;

describe('match bands (spec 6.2.2)', () => {
  it.each([
    [100, 'strong'],
    [80, 'strong'],
    [79, 'good'],
    [70, 'good'],
    [69, 'partial'],
    [50, 'partial'],
    [49, 'limited'],
    [0, 'limited'],
  ])('score %i is %s', (v, band) => expect(matchBand(row('a', v))).toBe(band));
  it('no score, a failed screening or a review flag means a human looks', () => {
    expect(matchBand(row('a', null))).toBe('human');
    expect(matchBand(row('a', 90, { state: 'failed' }))).toBe('human');
    expect(matchBand(row('a', 90, { band: 'needs_review' }))).toBe('human');
  });
});

describe('ordering and names', () => {
  it('orders by score, then more must-haves met, then upload order; unreadable last', () => {
    const items = (n: number) => ({
      items: Array.from({ length: n }, () => ({ classification: 'mandatory', status: 'met' })),
    });
    const a = row('a', 80, { uploadedAt: '2026-10-01T10:00:03Z' });
    const b = row('b', 80, { uploadedAt: '2026-10-01T10:00:02Z' });
    const c = row('c', 80, {
      uploadedAt: '2026-10-01T10:00:04Z',
      score: { value: 80, breakdown: items(2) as never },
    });
    const d = row('d', 91);
    const e = row('e', null);
    expect(orderCandidates([e, a, b, c, d]).map((r) => r.documentId)).toEqual([
      'd',
      'c',
      'b',
      'a',
      'e',
    ]);
  });

  it('names candidates by upload order, so a new score never renames anyone', () => {
    const rows = [
      row('z', 90, { uploadedAt: '2026-10-01T10:00:01Z' }),
      row('y', 10, { uploadedAt: '2026-10-01T10:00:00Z' }),
    ];
    const names = pseudonyms(rows);
    expect(names.get('y')).toBe('Candidate 01');
    expect(names.get('z')).toBe('Candidate 02');
    expect(pseudonyms([...rows].reverse())).toEqual(names);
    const many = Array.from({ length: 120 }, (_, i) =>
      row('x' + i, 50, { uploadedAt: `2026-10-01T10:${String(i % 60).padStart(2, '0')}:00Z` }),
    );
    expect([...pseudonyms(many).values()][0]).toMatch(/^Candidate \d{3}$/);
  });
});

describe('star map layout (spec 10.4)', () => {
  const ids = Array.from({ length: 12 }, (_, i) => 'id' + i);
  it('is deterministic, keeps rank 0 at the centre and everything inside the panel', () => {
    const one = layoutStars(ids);
    expect(layoutStars(ids)).toEqual(one);
    expect(one[0]).toMatchObject({ x: 50 });
    for (const s of one) {
      expect(s.x).toBeGreaterThanOrEqual(7);
      expect(s.x).toBeLessThanOrEqual(93);
      expect(s.y).toBeGreaterThanOrEqual(10);
      expect(s.y).toBeLessThanOrEqual(88);
    }
    expect(new Set(one.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`)).size).toBe(12);
  });
  it('seeds jitter from the id only', () => {
    expect(hash01('abc')).toBe(hash01('abc'));
    expect(hash01('abc')).not.toBe(hash01('abd'));
  });
  it('links neighbours by rank with a cap', () => {
    expect(linkStars(1)).toEqual([]);
    const l = linkStars(12);
    expect(l.length).toBeLessThanOrEqual(15);
    expect(l.every(([a, b]) => a < b && b < 12)).toBe(true);
  });
});

describe('skill chips (spec 6.2.3)', () => {
  it('puts must-haves first and never turns not-found into a rejection word', () => {
    const chips = skillChips({
      items: [
        { text: 'SQL', classification: 'preferred', status: 'met' },
        { text: 'BGP', classification: 'mandatory', status: 'not_found' },
        { text: 'K8s', classification: 'mandatory', status: 'partially_met' },
      ],
    } as never);
    expect(chips.map((c) => [c.text, c.kind])).toEqual([
      ['BGP', 'missing'],
      ['K8s', 'partly'],
      ['SQL', 'found'],
    ]);
  });
});

describe('evaluation report logic (spec 6.5)', () => {
  it('gives a plain reason for each unread file and none for files still in progress', () => {
    expect(unreadReason(row('a', null, { parseStatus: 'empty' }))).toMatch(/Scan only/);
    expect(unreadReason(row('b', null, { parseStatus: 'failed' }))).toMatch(/Damaged or locked/);
    expect(unreadReason(row('c', null, { state: 'failed', error: 'x' }))).toMatch(
      /Could not be scored/,
    );
    expect(unreadReason(row('d', 80))).toBeNull();
    expect(unreadReason(row('e', null, { state: 'queued' }))).toBeNull();
  });

  it('counts read, scored and need-a-human-look, ignoring erased files', () => {
    const rows = [
      row('a', 90),
      row('b', 40),
      row('c', null, { parseStatus: 'empty' }),
      row('d', 60, { state: 'queued', score: null, band: null }),
      row('e', 75, { erased: true }),
      row('f', 75, { band: 'needs_review' }),
    ];
    expect(reportCounts(rows)).toEqual({
      total: 5,
      read: 4,
      scored: 2,
      needLook: 2,
      stopped: 0,
      unread: 1,
    });
  });

  it('keeps stopped files apart from unreadable ones and says why they were not read', () => {
    const rows = [row('a', 90), row('b', null, { state: 'stopped', parseStatus: 'parsed' })];
    expect(unreadReason(rows[1]!)).toBe('Stopped before it was read');
    expect(reportCounts(rows)).toMatchObject({
      total: 2,
      read: 1,
      scored: 1,
      stopped: 1,
      needLook: 0,
    });
  });

  it('tallies must-haves found from the breakdown', () => {
    const item = (classification: string, status: string) => ({ classification, status }) as never;
    const b = {
      items: [item('mandatory', 'met'), item('mandatory', 'not_found'), item('preferred', 'met')],
    } as never;
    expect(mustHaveTally(b)).toEqual({ found: 1, total: 2 });
    expect(mustHaveTally(undefined)).toEqual({ found: 0, total: 0 });
  });
});

describe('bandMoves', () => {
  it('says plainly what moved', () => {
    const before = new Map([
      ['a', 'strong'],
      ['b', 'good'],
      ['c', 'good'],
    ] as const);
    const after = new Map([
      ['a', 'good'],
      ['b', 'good'],
      ['c', 'partial'],
    ] as const);
    expect(bandMoves(before, after)).toEqual({
      moved: 2,
      line: '2 candidates changed band: 1 from Strong to Good, 1 from Good to Partial.',
    });
    expect(bandMoves(before, before).moved).toBe(0);
  });
});
