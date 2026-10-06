import { describe, expect, it } from 'vitest';
import type { CandidateRow } from './api';
import {
  hash01,
  layoutStars,
  linkStars,
  matchBand,
  orderCandidates,
  pseudonyms,
  skillChips,
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
