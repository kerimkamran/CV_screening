import type { Breakdown, CandidateRow } from './api';

/**
 * Pure rules for the Results screen (design spec 6.2). No I/O, so they are easy to test:
 * bands, ordering, pseudonyms and where each star sits on the map.
 */

export type MatchBand = 'strong' | 'good' | 'partial' | 'limited' | 'human';

/** Open in the spec: 80 / 70 / 50 are not calibrated against the model yet. */
export function matchBand(row: Pick<CandidateRow, 'state' | 'score' | 'band'>): MatchBand {
  if (row.state !== 'completed' || row.score === null || row.band === 'needs_review') {
    return 'human';
  }
  const v = row.score.value;
  return v >= 80 ? 'strong' : v >= 70 ? 'good' : v >= 50 ? 'partial' : 'limited';
}

export const isPending = (r: Pick<CandidateRow, 'state'>) =>
  r.state === 'queued' || r.state === 'processing';

export const BAND_LABEL: Record<MatchBand, string> = {
  strong: 'Strong',
  good: 'Good',
  partial: 'Partial',
  limited: 'Limited',
  human: 'Needs a human look',
};

/** Star and disc colours. The map is dark in every background, so these never change. */
export const STAR_COLOUR: Record<MatchBand, string> = {
  strong: '#F5C461',
  good: '#8FC4FF',
  partial: '#7C8DB5',
  limited: '#7C8DB5',
  human: 'transparent',
};

/** Size follows the band, not the raw score, so 73 and 78 look the same. */
export const STAR_SIZE: Record<MatchBand, number> = {
  strong: 26,
  good: 22,
  partial: 18,
  limited: 14,
  human: 16,
};

const mustHavesMet = (b: Breakdown | undefined) =>
  b?.items.filter((i) => i.classification === 'mandatory' && i.status === 'met').length ?? 0;

/**
 * Score descending. Ties: more must-haves met first, then upload order, so the order is stable.
 * Unreadable and failed files come last.
 */
export function orderCandidates(rows: CandidateRow[]): CandidateRow[] {
  const upload = (a: CandidateRow, b: CandidateRow) =>
    a.uploadedAt.localeCompare(b.uploadedAt) || a.documentId.localeCompare(b.documentId);
  return [...rows].sort((a, b) => {
    const sa = a.score?.value ?? -1;
    const sb = b.score?.value ?? -1;
    if (sa !== sb) return sb - sa;
    const ma = mustHavesMet(a.score?.breakdown);
    const mb = mustHavesMet(b.score?.breakdown);
    if (ma !== mb) return mb - ma;
    return upload(a, b);
  });
}

/** "Candidate 07": numbered by upload order, so it never changes when scores do. */
export function pseudonyms(rows: CandidateRow[]): Map<string, string> {
  const byUpload = [...rows].sort(
    (a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.documentId.localeCompare(b.documentId),
  );
  const width = Math.max(2, String(byUpload.length).length);
  return new Map(
    byUpload.map((r, i) => [r.documentId, `Candidate ${String(i + 1).padStart(width, '0')}`]),
  );
}

/** Small stable hash (FNV-1a), used only to jitter star positions. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

export interface Star {
  id: string;
  /** Percent of the panel width and height. Position carries no meaning beyond rank. */
  x: number;
  y: number;
}

/**
 * Deterministic layout: rank 0 near the centre, the others on rings by rank, with jitter seeded
 * from the candidate id so the same run always looks the same.
 */
export function layoutStars(ids: string[]): Star[] {
  const RING = [1, 6, 10, 14, 20, 28];
  const stars: Star[] = [];
  let rank = 0;
  for (let ring = 0; ring < RING.length && rank < ids.length; ring++) {
    const n = Math.min(RING[ring]!, ids.length - rank);
    for (let k = 0; k < n; k++, rank++) {
      const id = ids[rank]!;
      if (ring === 0) {
        stars.push({ id, x: 50, y: 48 });
        continue;
      }
      const j1 = hash01(id) - 0.5;
      const j2 = hash01(id + '#') - 0.5;
      const angle = ((k + 0.5 * (ring % 2)) / RING[ring]!) * Math.PI * 2 - Math.PI / 2 + j1 * 0.35;
      const r = 14 + ring * 9 + j2 * 5;
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      stars.push({
        id,
        x: clamp(50 + Math.cos(angle) * r * 1.35, 7, 93),
        y: clamp(48 + Math.sin(angle) * r * 0.78, 10, 88),
      });
    }
  }
  return stars;
}

/** Each star joins its nearest neighbours by rank. Capped so the shape stays legible. */
export function linkStars(count: number): [number, number][] {
  const links: [number, number][] = [];
  for (let i = 1; i < count; i++) {
    links.push([i - 1, i]);
    if (i >= 3 && i % 2 === 1) links.push([i - 3, i]);
  }
  return links.slice(0, Math.max(0, count + 3));
}

/** Matched, partly found and not found, must-haves first (spec 6.2.3). */
export function skillChips(b: Breakdown | undefined) {
  const items = (b?.items ?? []).slice().sort((x, y) => {
    const w = (c: string) => (c === 'mandatory' ? 0 : 1);
    return w(x.classification) - w(y.classification);
  });
  const kind = (s: string): 'found' | 'partly' | 'missing' =>
    s === 'met' ? 'found' : s === 'partially_met' ? 'partly' : 'missing';
  return items.map((i) => ({ ...i, kind: kind(i.status) }));
}

/** Plain reason a file was not read, for the report's data-quality list (spec 6.5). */
export function unreadReason(
  r: Pick<CandidateRow, 'state' | 'parseStatus' | 'error'>,
): string | null {
  if (r.state === 'queued' || r.state === 'processing' || r.state === 'completed') return null;
  if (r.state === 'stopped') return 'Stopped before it was read';
  if (r.parseStatus === 'empty') return 'Scan only: no readable text in the file';
  if (r.parseStatus === 'failed') return 'Damaged or locked file';
  if (r.state === 'failed') return 'Could not be scored. Try again from the Table tab';
  return 'No readable text in the file';
}

export interface ReportCounts {
  read: number;
  scored: number;
  needLook: number;
  stopped: number;
  unread: number;
  total: number;
}

/** Header numbers for the evaluation report. "Need a human look" matches the Results screen. */
export function reportCounts(rows: CandidateRow[]): ReportCounts {
  const live = rows.filter((r) => !r.erased);
  const pending = live.filter(isPending).length;
  const stopped = live.filter((r) => r.state === 'stopped').length;
  const bands = live.map((r) => matchBand(r));
  const idle = live.map((r) => !isPending(r) && r.state !== 'stopped');
  return {
    total: live.length,
    read: live.length - pending - stopped,
    stopped,
    scored: bands.filter(
      (b, i) => idle[i] && (b === 'strong' || b === 'good' || b === 'partial' || b === 'limited'),
    ).length,
    needLook: bands.filter((b, i) => idle[i] && b === 'human').length,
    unread: live.filter((r) => unreadReason(r) !== null).length,
  };
}

/** Must-haves found out of all must-haves, from the stored breakdown. */
export function mustHaveTally(b: Breakdown | undefined): { found: number; total: number } {
  const m = (b?.items ?? []).filter((i) => i.classification === 'mandatory');
  return { found: m.filter((i) => i.status === 'met').length, total: m.length };
}

export const KIND_NAME = {
  mandatory: 'Must-have',
  preferred: 'Nice-to-have',
  ignore: 'Ignore',
} as const;

/** One plain line for what a change did to the bands, e.g. "2 candidates moved: 1 from Strong to Good…". */
export function bandMoves(
  before: Map<string, MatchBand>,
  after: Map<string, MatchBand>,
): { moved: number; line: string } {
  const moves = new Map<string, number>();
  for (const [id, a] of after) {
    const b = before.get(id);
    if (b && b !== a) {
      const k = `${BAND_LABEL[b]} to ${BAND_LABEL[a]}`;
      moves.set(k, (moves.get(k) ?? 0) + 1);
    }
  }
  const moved = [...moves.values()].reduce((x, y) => x + y, 0);
  if (moved === 0) return { moved, line: 'No candidate changed band. The order may have changed.' };
  const parts = [...moves].map(([k, n]) => `${n} from ${k}`);
  return {
    moved,
    line: `${moved} ${moved === 1 ? 'candidate' : 'candidates'} changed band: ${parts.join(', ')}.`,
  };
}
