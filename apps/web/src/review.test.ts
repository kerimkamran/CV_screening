import { beforeEach, describe, expect, it } from 'vitest';
import {
  getReviewList,
  KEEP_LISTS,
  neighbours,
  openCv,
  parseReviewRoute,
  reviewHref,
  saveReviewList,
  updateReviewList,
} from './review';

const A = '0'.repeat(25) + 'A';
const B = '0'.repeat(25) + 'B';
const C = '0'.repeat(25) + 'C';

beforeEach(() => sessionStorage.clear());

describe('review list store', () => {
  it('keeps the order of a list under a short id and finds it again', () => {
    const id = saveReviewList({ label: 'Network Engineer', back: '/vacancies/x', ids: [A, B, C] });
    expect(id).toMatch(/^[\w-]{3,32}$/);
    expect(getReviewList(id)).toMatchObject({ label: 'Network Engineer', ids: [A, B, C] });
    expect(getReviewList('nope')).toBeNull();
    expect(getReviewList(null)).toBeNull();
  });

  it('reuses one entry for the same order and way back, and keeps only the latest five', () => {
    const a = saveReviewList({ label: 'x', back: '/a', ids: [A, B] });
    expect(saveReviewList({ label: 'x', back: '/a', ids: [A, B] })).toBe(a);
    for (let i = 0; i < KEEP_LISTS + 2; i++)
      saveReviewList({ label: 'x', back: `/b${i}`, ids: [A, B, C] });
    expect(getReviewList(a)).toBeNull();
    const all = JSON.parse(sessionStorage.getItem('cv-review-lists')!) as unknown[];
    expect(all).toHaveLength(KEEP_LISTS);
  });

  it('says where a CV is in its list, and has no neighbours outside it', () => {
    const id = saveReviewList({ label: 'x', back: '/a', ids: [A, B, C] });
    const list = getReviewList(id);
    expect(neighbours(list, A)).toEqual({ at: 0, total: 3, prev: undefined, next: B });
    expect(neighbours(list, B)).toEqual({ at: 1, total: 3, prev: A, next: C });
    expect(neighbours(list, C)).toEqual({ at: 2, total: 3, prev: B, next: undefined });
    expect(neighbours(list, '0'.repeat(26))).toMatchObject({ at: -1, prev: undefined });
    expect(neighbours(null, A).at).toBe(-1);
  });

  it('can change a stored list (a CV left it)', () => {
    const id = saveReviewList({ label: 'x', back: '/a', ids: [A, B, C] });
    updateReviewList(id, { ids: [A, C] });
    expect(getReviewList(id)?.ids).toEqual([A, C]);
  });

  it('survives blocked or broken storage', () => {
    sessionStorage.setItem('cv-review-lists', '{not json');
    expect(getReviewList('x')).toBeNull();
    expect(() => saveReviewList({ label: 'x', back: '/a', ids: [A] })).not.toThrow();
  });
});

describe('review route', () => {
  it('writes and reads #/cv/<id>?l=<list>', () => {
    expect(reviewHref(A)).toBe(`#/cv/${A}`);
    expect(reviewHref(A, 'abc123')).toBe(`#/cv/${A}?l=abc123`);
    expect(parseReviewRoute(`/cv/${A}?l=abc123`)).toEqual({ documentId: A, listId: 'abc123' });
    expect(parseReviewRoute(`/cv/${A}`)).toEqual({ documentId: A, listId: null });
  });
  it('ignores anything that is not a CV id or a safe list id', () => {
    expect(parseReviewRoute('/cv/short')).toBeNull();
    expect(parseReviewRoute(`/candidates/${A}`)).toBeNull();
    expect(parseReviewRoute(`/cv/${A}?l=<script>`)).toEqual({ documentId: A, listId: null });
  });
  it('opens a CV from a list: stores the list, then goes', () => {
    const went: string[] = [];
    openCv(B, { label: 'x', back: '/a', ids: [A, B] }, (r) => went.push(r));
    const m = parseReviewRoute(went[0]!)!;
    expect(m.documentId).toBe(B);
    expect(getReviewList(m.listId)?.ids).toEqual([A, B]);
    openCv(C, null, (r) => went.push(r));
    expect(went[1]).toBe(`/cv/${C}`);
  });
});
