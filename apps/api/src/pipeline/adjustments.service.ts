import { Injectable } from '@nestjs/common';
import type { ReqStatus, RequirementClass } from '@cv/shared';
import { DbService } from '../db/db.service';
import type { CandidateRow } from './export.service';
import { bandFor, computeScore } from './score';

export type Kind = 'mandatory' | 'preferred' | 'ignore';

const kindName = (c: string): Kind =>
  c === 'mandatory' ? 'mandatory' : c === 'preferred' ? 'preferred' : 'ignore';

const kindOf = (c: RequirementClass): Kind =>
  c === 'mandatory' ? 'mandatory' : c === 'preferred' ? 'preferred' : 'ignore';
const classOf = (k: Kind): RequirementClass =>
  k === 'mandatory' ? 'mandatory' : k === 'preferred' ? 'preferred' : 'informational';

interface AssessmentRow {
  screening_id: string;
  requirement_id: string;
  text: string;
  classification: RequirementClass;
  weight: number | null;
  status: ReqStatus;
}

/**
 * Design spec 6.2.5. Re-weighing a requirement re-ranks without re-reading any resume: the stored
 * assessments (status per requirement) are scored again with the new kinds. The score formula is
 * the same arithmetic as the first scan; the model is not called.
 */
@Injectable()
export class AdjustmentService {
  constructor(private readonly db: DbService) {}

  /** The frozen requirement set the current scan uses. */
  async currentSet(vid: string) {
    const { rows } = await this.db.query<{
      id: string;
      text: string;
      classification: RequirementClass;
    }>(
      `WITH cur AS (SELECT id FROM requirement_set WHERE vacancy_id = $1 AND frozen_at IS NOT NULL
                     ORDER BY version DESC LIMIT 1)
       SELECT r.id, r.text, r.classification FROM requirement r
        WHERE r.requirement_set_id = (SELECT id FROM cur) ORDER BY r.position, r.id`,
      [vid],
    );
    return rows;
  }

  /** Latest kind per requirement since the last reset. */
  async overlay(vid: string): Promise<Map<string, Kind>> {
    const { rows } = await this.db.query<{
      requirement_id: string | null;
      to_kind: Kind | null;
      is_reset: boolean;
    }>(
      `SELECT requirement_id, to_kind, is_reset FROM criteria_adjustment
        WHERE vacancy_id = $1 ORDER BY changed_at, id`,
      [vid],
    );
    const m = new Map<string, Kind>();
    for (const r of rows) {
      if (r.is_reset) m.clear();
      else if (r.requirement_id && r.to_kind) m.set(r.requirement_id, r.to_kind);
    }
    return m;
  }

  async view(vid: string) {
    const [set, overlay, changes] = await Promise.all([
      this.currentSet(vid),
      this.overlay(vid),
      this.history(vid),
    ]);
    const lastReset = changes.map((c) => c.reset).lastIndexOf(true);
    return {
      requirements: set
        .filter((r) => r.classification !== 'disqualifier')
        .map((r) => ({
          id: r.id,
          text: r.text,
          original: kindName(r.classification),
          current: overlay.get(r.id) ?? kindName(r.classification),
        })),
      knockouts: set.filter((r) => r.classification === 'disqualifier').map((r) => r.text),
      changes,
      /** Changes since the first scan, or since the last "back to original". */
      changeCount: changes.slice(lastReset + 1).filter((c) => !c.reset).length,
    };
  }

  async history(vid: string) {
    const { rows } = await this.db.query<{
      id: string;
      requirement_id: string | null;
      text: string | null;
      from_kind: Kind | null;
      to_kind: Kind | null;
      is_reset: boolean;
      by: string;
      at: string;
    }>(
      `SELECT a.id, a.requirement_id, r.text, a.from_kind, a.to_kind, a.is_reset,
              u.display_name AS by, a.changed_at AS at
         FROM criteria_adjustment a
         LEFT JOIN requirement r ON r.id = a.requirement_id
         JOIN app_user u ON u.id = a.changed_by
        WHERE a.vacancy_id = $1 ORDER BY a.changed_at, a.id`,
      [vid],
    );
    return rows.map((r) => ({
      id: r.id,
      requirementId: r.requirement_id,
      requirement: r.text,
      from: r.from_kind,
      to: r.to_kind,
      reset: r.is_reset,
      by: r.by,
      at: r.at,
    }));
  }

  /**
   * Scores for the given screenings under an overlay. Only screenings that have assessments are
   * returned. Weights are kept when a requirement stays in its class and reset to the default
   * (10 must-have, 5 nice-to-have) when it moves.
   */
  async rescore(screeningIds: string[], overlay: Map<string, Kind>) {
    const out = new Map<string, ReturnType<typeof computeScore>>();
    if (screeningIds.length === 0) return out;
    const { rows } = await this.db.query<AssessmentRow>(
      `SELECT a.screening_id, a.requirement_id, r.text, r.classification, r.weight::float AS weight, a.status
         FROM requirement_assessment a JOIN requirement r ON r.id = a.requirement_id
        WHERE a.screening_id = ANY($1) AND r.classification <> 'disqualifier'
        ORDER BY r.position, r.id`,
      [screeningIds],
    );
    const by = new Map<string, AssessmentRow[]>();
    for (const r of rows)
      (by.get(r.screening_id) ?? by.set(r.screening_id, []).get(r.screening_id)!).push(r);
    for (const [sid, items] of by) {
      out.set(
        sid,
        computeScore(
          items.map((i) => {
            const to = overlay.get(i.requirement_id);
            const changed = to !== undefined && to !== kindOf(i.classification);
            return {
              requirementId: i.requirement_id,
              text: i.text,
              classification: changed ? classOf(to) : i.classification,
              weight: changed ? null : i.weight,
              status: i.status,
            };
          }),
        ),
      );
    }
    return out;
  }

  /** Apply the stored overlay to listing rows in place. Rows without assessments stay as they are. */
  async apply(vid: string, rows: CandidateRow[]): Promise<number> {
    const overlay = await this.overlay(vid);
    if (overlay.size === 0) return 0;
    const ids = rows
      .filter((r) => r.state === 'completed' && r.screeningId)
      .map((r) => r.screeningId!);
    const scored = await this.rescore(ids, overlay);
    for (const r of rows) {
      const s = r.screeningId ? scored.get(r.screeningId) : undefined;
      if (!s) continue;
      r.originalScore = r.score?.value ?? null;
      r.adjusted = true;
      r.score = s.score === null ? null : { value: s.score, breakdown: s.breakdown };
      r.band = r.band === 'needs_review' ? 'needs_review' : bandFor(s.score, false);
    }
    // Same order as the query: best score first, nothing-to-score last, then newest upload.
    rows.sort(
      (a, b) =>
        (b.score?.value ?? -1) - (a.score?.value ?? -1) ||
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
    return overlay.size;
  }
}
