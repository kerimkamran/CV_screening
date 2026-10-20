/**
 * The list a CV was opened from (Stage 2, S2-FE2).
 *
 * Opening a CV from a list stores that list's order in this tab's session storage under a short id
 * and puts the id in the address (`#/cv/<documentId>?l=<listId>`). Previous and Next then walk that
 * exact list, Back returns to it as it was left, and a copied link still opens the CV (without the
 * list). Only the five latest lists are kept, so two tabs and old links never crowd each other.
 *
 * No names, no scores, no file names: a list here is only ids, a title and the way back.
 */

export interface ReviewList {
  id: string;
  /** Shown in "← Back to {label}". */
  label: string;
  /** The hash route to return to, e.g. `/vacancies/<id>/candidates`. */
  back: string;
  /** Document ids in the order the person saw them. */
  ids: string[];
  /** Where the list was scrolled and which row was active when the person left. */
  scroll?: number;
  savedAt: number;
}

const KEY = 'cv-review-lists';
export const KEEP_LISTS = 5;
const ULID = '[0-9A-Z]{26}';

function readAll(): ReviewList[] {
  try {
    const j = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter(
      (l): l is ReviewList =>
        !!l &&
        typeof l === 'object' &&
        typeof (l as ReviewList).id === 'string' &&
        Array.isArray((l as ReviewList).ids),
    );
  } catch {
    return [];
  }
}

function writeAll(all: ReviewList[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(all.slice(-KEEP_LISTS)));
  } catch {
    /* storage is blocked: the CV still opens, Previous and Next just have no list */
  }
}

const shortId = () => Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3);

/** Remember a list and return its id. The same order and way back reuse one entry. */
export function saveReviewList(l: {
  label: string;
  back: string;
  ids: string[];
  scroll?: number;
}): string {
  const all = readAll();
  const same = all.find(
    (x) =>
      x.back === l.back && x.ids.length === l.ids.length && x.ids.every((v, i) => v === l.ids[i]),
  );
  const id = same?.id ?? shortId();
  const entry: ReviewList = { ...l, id, savedAt: Date.now() };
  writeAll([...all.filter((x) => x.id !== id), entry]);
  return id;
}

export function getReviewList(id: string | null | undefined): ReviewList | null {
  if (!id) return null;
  return readAll().find((l) => l.id === id) ?? null;
}

/** Change the order of a stored list (a CV left the list, or the page learned the full order). */
export function updateReviewList(id: string, patch: Partial<Pick<ReviewList, 'ids' | 'scroll'>>) {
  const all = readAll();
  const at = all.findIndex((l) => l.id === id);
  if (at < 0) return;
  all[at] = { ...all[at]!, ...patch };
  writeAll(all);
}

export function neighbours(list: ReviewList | null, documentId: string) {
  const at = list ? list.ids.indexOf(documentId) : -1;
  if (!list || at < 0) return { at: -1, total: 0, prev: undefined, next: undefined };
  return {
    at,
    total: list.ids.length,
    prev: at > 0 ? list.ids[at - 1] : undefined,
    next: at < list.ids.length - 1 ? list.ids[at + 1] : undefined,
  };
}

/** `#/cv/<documentId>` with the list id when there is one. */
export const reviewHref = (documentId: string, listId?: string | null) =>
  `#/cv/${documentId}${listId ? `?l=${encodeURIComponent(listId)}` : ''}`;
export const reviewRoute = (documentId: string, listId?: string | null) =>
  reviewHref(documentId, listId).slice(1);

const ROUTE = new RegExp(`^/cv/(${ULID})(?:\\?(.*))?$`);
/** Read `/cv/<documentId>?l=<listId>` (the hash without its #). */
export function parseReviewRoute(
  route: string,
): { documentId: string; listId: string | null } | null {
  const m = ROUTE.exec(route);
  if (!m) return null;
  const l = new URLSearchParams(m[2] ?? '').get('l');
  return { documentId: m[1]!, listId: l && /^[\w-]{3,32}$/.test(l) ? l : null };
}

/**
 * Open a CV from a list: store the list, then go. Used by every surface that links to a CV so they
 * all behave the same (S2-FE5).
 */
export function openCv(
  documentId: string,
  list: { label: string; back: string; ids: string[]; scroll?: number } | null,
  go: (route: string) => void,
) {
  const listId = list ? saveReviewList(list) : null;
  go(reviewRoute(documentId, listId));
}
