import type { CandidateRow } from './api';
import { BAND_LABEL, matchBand, mustHaveTally } from './results-logic';

/** Recruiter marks (design spec 6.2.4). Kept apart from the AI band and never change it. */
export const MARKS = [
  { key: 'shortlist', label: 'Shortlist', done: 'Shortlisted' },
  { key: 'hold', label: 'Maybe', done: 'Maybe' },
  { key: 'reject', label: 'Not now', done: 'Not now' },
] as const;
export type MarkKey = (typeof MARKS)[number]['key'];

export const markLabel = (k: string) => MARKS.find((m) => m.key === k)?.done ?? k;

export interface ShortlistEntry {
  name: string;
  band: string;
  mustHaves: string;
  note: string;
}

/** Only the shortlisted, in the same order as Results. Names are the on-screen ones (pseudonyms unless revealed). */
export function shortlistEntries(
  ordered: CandidateRow[],
  nameOf: (r: CandidateRow) => string,
): ShortlistEntry[] {
  return ordered
    .filter((r) => r.decision?.outcome === 'shortlist')
    .map((r) => {
      const t = mustHaveTally(r.score?.breakdown);
      return {
        name: nameOf(r),
        band: BAND_LABEL[matchBand(r)],
        mustHaves: `${t.found} of ${t.total}`,
        note: r.decision!.reason,
      };
    });
}

export function shortlistText(entries: ShortlistEntry[]): string {
  return entries
    .map((e, i) => `${i + 1}. ${e.name} (${e.band}, must-haves found ${e.mustHaves}) ${e.note}`)
    .join('\n');
}

/** CSV with a guard against spreadsheet formulas: a cell that starts with = + - @ is made plain text. */
export function shortlistCsv(entries: ShortlistEntry[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = ['Candidate', 'Match', 'Must-haves found', 'My note'].map(cell).join(',');
  const rows = entries.map((e) => [e.name, e.band, e.mustHaves, e.note].map(cell).join(','));
  return [head, ...rows].join('\r\n');
}
