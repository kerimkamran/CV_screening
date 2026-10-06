import {
  BAND_LABEL,
  isPending,
  KIND_NAME,
  matchBand,
  mustHaveTally,
  orderCandidates,
  pseudonyms,
  reportCounts,
  skillChips,
  unreadReason,
  type MatchBand,
  type ReportCounts,
} from '@cv/shared';

/**
 * Pure rules for the Results screen (design spec 6.2). The rules for bands, order, pseudonyms and
 * reasons live in @cv/shared so the screen, the report and the shared snapshot cannot disagree;
 * they are re-exported here for the pages. What stays here is the star map.
 */
export {
  BAND_LABEL,
  isPending,
  KIND_NAME,
  matchBand,
  mustHaveTally,
  orderCandidates,
  pseudonyms,
  reportCounts,
  skillChips,
  unreadReason,
  type MatchBand,
  type ReportCounts,
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
