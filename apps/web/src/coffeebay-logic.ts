import type { BatchStatus, Run } from './intake';
import { runActive } from './intake';
import { STAR_COUNT } from './Sky';

/**
 * The numbers and words behind the waiting screen (Stage 2, S2-FE11 to FE13). No React here: every
 * rule in plan 4.7 (first name, phases, progress, ETA, tab title, favicon, announcements) is a small
 * pure function, so it can be tested without a browser.
 */

// ---------------------------------------------------------------------------- the greeting

/** Words that sit where a first name would, but are not one ("UAT Recruiter"). */
const NOT_A_NAME = new Set([
  'uat',
  'test',
  'tester',
  'user',
  'recruiter',
  'admin',
  'administrator',
  'hr',
  'team',
  'lead',
  'manager',
  'demo',
  'service',
  'system',
  'unknown',
]);

/**
 * The first word of the display name, only when it looks like a name: letters, a capital then lower
 * case, 2 to 20 characters, not a role word. A "Surname, Name" entry gets no greeting by name, so a
 * surname is never used as a first name. Returns null when in doubt.
 */
export function firstNameOf(displayName: string | null | undefined): string | null {
  const full = (displayName ?? '').trim();
  if (!full || full.includes('@') || full.includes(',')) return null;
  const first = full.split(/\s+/)[0]!;
  if (first.length < 2 || first.length > 20) return null;
  if (!/^\p{Lu}[\p{Ll}'’-]+$/u.test(first)) return null;
  if (NOT_A_NAME.has(first.toLowerCase())) return null;
  return first;
}

// ---------------------------------------------------------------------------- the picture of a batch

export type Phase = 'sending' | 'reading' | 'finished';

export interface Progress {
  total: number;
  /** Files that reached the server (or were settled without being sent). */
  sent: number;
  /** CVs with a result or a final problem: analyzed, needs a look, failed, stopped. */
  done: number;
  /** CVs ready to review: analyzed, needs a human look, or no readable text. */
  ready: number;
  analyzed: number;
  needsLook: number;
  failed: number;
  /** Files that never reached the server (not sent, could not send, vacancy full). */
  notSent: number;
  analyzing: number;
  /** 0 to 1, how much of the batch is settled. */
  p: number;
  phase: Phase;
}

export function progressOf(s: BatchStatus, run: Run | null): Progress {
  const b = s.counts.byStatus;
  const n = (k: keyof typeof b) => b[k] ?? 0;
  const leafTotal = Object.values(b).reduce((a, x) => a + x, 0);
  const total = Math.max(s.counts.upload.total, leafTotal, 1);
  const analyzed = n('analyzed') + n('not_analyzed');
  const needsLook = n('needs_look') + n('unreadable');
  const failed = n('failed');
  const analyzing = n('analyzing');
  const notSent = n('not_sent') + n('could_not_send') + n('vacancy_full');
  const ready = analyzed + needsLook;
  const done = ready + failed + n('stopped');
  const open = notSent + n('sending') + n('waiting_to_send') + analyzing;
  const p = Math.min(Math.max((total - open) / total, 0), 1);
  const sent = Math.min(s.counts.upload.received, total);
  const phase: Phase = runActive(run) ? 'sending' : analyzing > 0 ? 'reading' : 'finished';
  return { total, sent, done, ready, analyzed, needsLook, failed, notSent, analyzing, p, phase };
}

/** How many of the 14 window stars are lit. */
export const litStars = (p: number) => Math.round(STAR_COUNT * Math.min(Math.max(p, 0), 1));

/** The 25, 50 and 75 % marks that were crossed between two readings (for the live region). */
export function crossedMilestone(before: number, after: number): 25 | 50 | 75 | null {
  for (const m of [75, 50, 25] as const) {
    if (before * 100 < m && after * 100 >= m) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------- the time left

export interface Sample {
  t: number;
  done: number;
}
export const ETA = { minSpanMs: 45_000, minDone: 3, windowMs: 120_000, slowAfterMs: 180_000 };

/**
 * Minutes left, or null whenever it would be a guess: at least 45 s of samples and 3 finished CVs,
 * and a rate taken over the last 2 minutes.
 */
export function etaMinutes(samples: Sample[], now: number, total: number): number | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (last.done < ETA.minDone || now - first.t < ETA.minSpanMs) return null;
  const recent = samples.filter((s) => now - s.t <= ETA.windowMs);
  const from = recent[0] ?? first;
  const span = last.t - from.t;
  const gained = last.done - from.done;
  if (span <= 0 || gained <= 0) return null;
  const left = total - last.done;
  if (left <= 0) return 0;
  return Math.max(1, Math.ceil(left / (gained / span) / 60_000));
}

/** The shown minutes change only when the new value is lower, or at least 2 higher. */
export function stableMinutes(shown: number | null, next: number | null): number | null {
  if (next === null) return shown;
  if (shown === null) return next;
  if (next < shown || next >= shown + 2) return next;
  return shown;
}

/** No new result for 3 minutes while CVs are still being read. */
export const isSlow = (lastChangeAt: number, now: number) => now - lastChangeAt > ETA.slowAfterMs;

// ---------------------------------------------------------------------------- tab title and icon

/** The English key; `t()` turns it into the person's language. */
export const READY_TITLE = '✓ Ready · parallax';

export function titleFor(
  done: number,
  total: number,
  finished: boolean,
  tt: (en: string) => string,
): string {
  return finished ? tt(READY_TITLE) : `(${done}/${total}) parallax`;
}

/** A small progress ring in navy and gold as a `data:` image (the CSP allows `img-src data:`). */
export function ringIcon(p: number, finished: boolean): string {
  const r = 12;
  const c = 2 * Math.PI * r;
  const filled = Math.round(c * Math.min(Math.max(p, 0), 1) * 100) / 100;
  const body = finished
    ? `<circle cx="16" cy="16" r="${r}" fill="none" stroke="#F5C461" stroke-width="4"/><path d="M10.5 16.5l4 4 7-8" fill="none" stroke="#F5C461" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="16" cy="16" r="${r}" fill="none" stroke="#35508a" stroke-width="4"/><circle cx="16" cy="16" r="${r}" fill="none" stroke="#F5C461" stroke-width="4" stroke-linecap="round" stroke-dasharray="${filled} ${c.toFixed(2)}" transform="rotate(-90 16 16)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#133e72"/>${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------------- where a row goes

/** The page for one CV. Until the review screen exists (S2-FE2) this is the Candidates tab. */
export const cvHref = (vacancyId: string, _documentId: string) =>
  `#/vacancies/${vacancyId}/candidates`;

// ---------------------------------------------------------------------------- the chime preference

const chimeKey = (userId: string) => `cv-coffeebay:${userId}`;
export function getChime(userId: string): boolean {
  try {
    return localStorage.getItem(chimeKey(userId)) === '1';
  } catch {
    return false;
  }
}
export function setChime(userId: string, on: boolean): void {
  try {
    localStorage.setItem(chimeKey(userId), on ? '1' : '0');
  } catch {
    /* storage can be blocked; the choice then lasts for this visit only */
  }
}

/** Per batch: the waiting screen was hidden (still shown as a button) or closed (gone). */
const viewKey = (userId: string, batchId: string) => `cv-coffeebay-view:${userId}:${batchId}`;
export type BatchView = 'full' | 'hidden' | 'closed';
export function getBatchView(userId: string, batchId: string): BatchView {
  try {
    const v = localStorage.getItem(viewKey(userId, batchId));
    return v === 'hidden' || v === 'closed' ? v : 'full';
  } catch {
    return 'full';
  }
}
export function setBatchView(userId: string, batchId: string, v: BatchView): void {
  try {
    localStorage.setItem(viewKey(userId, batchId), v);
  } catch {
    /* see above */
  }
}
