import type { Mark } from '@cv/shared';

/**
 * Review sprint (a design addition to Stage 2): deciding through a list of CVs from the keyboard.
 * S, M and N mark the open CV; with "Next CV after deciding" on, the next CV opens by itself, the
 * Undo for the decision comes along, and the end of the list says what was decided. Only the
 * person's key press decides anything; nothing is marked automatically.
 */

const AUTO_KEY = 'cv-review-auto-next';
const TALLY_KEY = (listId: string) => `cv-review-tally:${listId}`;

/** "Next CV after deciding": on unless the person turned it off (remembered on this browser). */
export function autoNext(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function setAutoNext(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  } catch {
    /* a convenience only */
  }
}

/** An Undo that follows the person to the next CV (the review screen mounts anew per CV). */
export interface Carried {
  text: string;
  undo: () => void | Promise<void>;
}
let carried: Carried | null = null;
export function carry(c: Carried) {
  carried = c;
}
export function takeCarried(): Carried | null {
  const c = carried;
  carried = null;
  return c;
}

/** What was decided in this review of this list, by CV (kept for the tab). */
export function recordDecision(listId: string, documentId: string, mark: Mark) {
  try {
    const all = readTally(listId);
    if (mark === 'new') delete all[documentId];
    else all[documentId] = mark;
    sessionStorage.setItem(TALLY_KEY(listId), JSON.stringify(all));
  } catch {
    /* a convenience only */
  }
}
function readTally(listId: string): Record<string, Mark> {
  try {
    const j = JSON.parse(sessionStorage.getItem(TALLY_KEY(listId)) ?? '{}') as unknown;
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    return Object.fromEntries(
      Object.entries(j as Record<string, unknown>).filter(
        (e): e is [string, Mark] => e[1] === 'shortlist' || e[1] === 'maybe' || e[1] === 'not_now',
      ),
    );
  } catch {
    return {};
  }
}
export interface Tally {
  shortlist: number;
  maybe: number;
  not_now: number;
  total: number;
}
export function tallyOf(listId: string): Tally {
  const t: Tally = { shortlist: 0, maybe: 0, not_now: 0, total: 0 };
  for (const m of Object.values(readTally(listId))) {
    if (m === 'shortlist' || m === 'maybe' || m === 'not_now') {
      t[m]++;
      t.total++;
    }
  }
  return t;
}
export function clearTally(listId: string) {
  try {
    sessionStorage.removeItem(TALLY_KEY(listId));
  } catch {
    /* a convenience only */
  }
}
