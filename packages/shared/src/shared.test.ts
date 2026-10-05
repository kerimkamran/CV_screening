import { describe, expect, it } from 'vitest';
import { canTransition, isUlid, newId, REQ_STATUSES } from './index.js';

describe('ids (INTG-01)', () => {
  it('generates valid, sortable, unique ULIDs', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(ids.every(isUlid)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
  it('rejects malformed IDs', () => {
    expect(isUlid('123')).toBe(false);
    expect(isUlid('0000000000000000000000000U')).toBe(false); // U is not Crockford base32
    expect(isUlid(42)).toBe(false);
  });
});

describe('document state machine (DOC-05)', () => {
  it('allows the forward chain', () => {
    expect(canTransition('queued', 'processing')).toBe(true);
    expect(canTransition('processing', 'parsed')).toBe(true);
    expect(canTransition('parsed', 'evaluated')).toBe(true);
    expect(canTransition('evaluated', 'completed')).toBe(true);
  });
  it('allows failure from any non-terminal state', () => {
    for (const s of ['queued', 'processing', 'parsed', 'evaluated'] as const) {
      expect(canTransition(s, 'failed')).toBe(true);
      expect(canTransition(s, 'needs_review')).toBe(true);
    }
  });
  it('rejects skips, regressions and exits from terminal states', () => {
    expect(canTransition('queued', 'parsed')).toBe(false);
    expect(canTransition('parsed', 'processing')).toBe(false);
    expect(canTransition('completed', 'queued')).toBe(false);
    expect(canTransition('failed', 'processing')).toBe(false);
  });
});

describe('taxonomy (MATCH-02)', () => {
  it('keeps not_found distinct from not_met', () => {
    expect(REQ_STATUSES).toContain('not_found');
    expect(REQ_STATUSES).toContain('not_met');
    expect(REQ_STATUSES).toHaveLength(6);
  });
});
