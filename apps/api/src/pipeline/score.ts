import type { ReqStatus, RequirementClass } from '@cv/shared';

/**
 * SCORE-01..03. The score is arithmetic over statuses and recruiter-set weights. The model has no
 * say in it. `not_found` and `ambiguous` earn nothing but are shown as such, never as `not_met`.
 */
export interface ScoredItem {
  requirementId: string;
  text: string;
  classification: RequirementClass;
  weight: number;
  status: ReqStatus;
  points: number;
  earned: number;
}

export interface Breakdown {
  formula: string;
  items: ScoredItem[];
  earned: number;
  possible: number;
  mandatoryGaps: number;
}

const POINTS: Record<ReqStatus, number> = {
  met: 1,
  partially_met: 0.5,
  not_met: 0,
  not_found: 0,
  ambiguous: 0,
  not_applicable: 0,
};

export interface ScoreInput {
  requirementId: string;
  text: string;
  classification: RequirementClass;
  weight: number | null;
  status: ReqStatus;
}

export function computeScore(items: ScoreInput[]): { score: number | null; breakdown: Breakdown } {
  const rows: ScoredItem[] = items
    // Informational criteria are shown, not scored; disqualifiers are knockout rules, not points.
    .filter((i) => i.classification === 'mandatory' || i.classification === 'preferred')
    .map((i) => {
      const weight = i.weight ?? (i.classification === 'mandatory' ? 10 : 5);
      const points = POINTS[i.status];
      return { ...i, weight, points, earned: weight * points };
    })
    .map(({ requirementId, text, classification, weight, status, points, earned }) => ({
      requirementId,
      text,
      classification,
      weight,
      status,
      points,
      earned,
    }));
  // A criterion that does not apply to this candidate does not count against them.
  const counted = rows.filter((r) => r.status !== 'not_applicable');
  const possible = counted.reduce((a, r) => a + r.weight, 0);
  const earned = counted.reduce((a, r) => a + r.earned, 0);
  const mandatoryGaps = rows.filter(
    (r) => r.classification === 'mandatory' && (r.status === 'not_met' || r.status === 'not_found'),
  ).length;
  return {
    score: possible > 0 ? Math.round((earned / possible) * 10000) / 100 : null,
    breakdown: {
      formula:
        'score = 100 × Σ(weight × points) ÷ Σ(weight); points: met 1, partially met 0.5, otherwise 0; not applicable excluded',
      items: rows,
      earned,
      possible,
      mandatoryGaps,
    },
  };
}

export type Band = 'strong_match' | 'possible_match' | 'weak_match' | 'needs_review';

/** A sort/filter aid, not a decision. There is deliberately no "reject" band. */
export function bandFor(score: number | null, needsReview: boolean): Band {
  if (needsReview || score === null) return 'needs_review';
  if (score >= 70) return 'strong_match';
  if (score >= 40) return 'possible_match';
  return 'weak_match';
}
