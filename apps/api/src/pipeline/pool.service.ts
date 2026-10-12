import { Inject, Injectable } from '@nestjs/common';
import {
  BAND_CUTOFFS,
  foldText,
  markFromStored,
  mustHaveTally,
  pseudonym,
  type Mark,
  type MatchBand,
  type VacancyStatus,
} from '@cv/shared';
import { ENV, type Env } from '../config/env';
import { DbService } from '../db/db.service';
import { AdjustmentService } from './adjustments.service';

/** One row of the Candidate pool: a resume that was analyzed for one vacancy (spec 6.8). */
export interface PoolRow {
  documentId: string;
  vacancyId: string;
  vacancyTitle: string;
  vacancyStatus: VacancyStatus;
  vacancyArchived: boolean;
  /** "Candidate 07": numbered by upload order inside the vacancy. */
  pseudonym: string;
  /** What the list shows: the candidate's name, or the pseudonym when names are hidden or unknown. */
  label: string;
  /** The candidate's name; null when names are hidden (CANDIDATE_NAMES=hidden) or not found in the resume. */
  name: string | null;
  ordinal: number;
  /** The current match: the latest completed scoring of this resume for this vacancy. */
  matchId: string;
  score: number;
  band: Exclude<MatchBand, 'human'>;
  mustFound: number;
  mustTotal: number;
  decision: Mark;
  decisionNote: string | null;
  decisionVersion: number;
  decidedAt: string | null;
  decidedBy: string | null;
  outOfDate: boolean;
  /** Date of the requirements the match was made against (tooltip text). */
  scoredAgainst: string | null;
  reanalyzing: boolean;
  analyzedAt: string;
  updatedAt: string;
  uploadedAt: string;
  /** Matched skill labels, only when asked for (search). */
  skills?: string[];
}

export const bandOf = (score: number): Exclude<MatchBand, 'human'> =>
  score >= BAND_CUTOFFS.strong
    ? 'strong'
    : score >= BAND_CUTOFFS.good
      ? 'good'
      : score >= BAND_CUTOFFS.partial
        ? 'partial'
        : 'limited';

interface Raw {
  documentId: string;
  vacancyId: string;
  vacancyTitle: string;
  vacancyStatus: VacancyStatus;
  archived: boolean;
  vacancyReqVersion: number;
  ordinal: number;
  total: number;
  uploadedAt: Date;
  matchId: string;
  candidateName: string | null;
  score: number;
  analyzedAt: Date;
  matchReqVersion: number | null;
  matchSetFrozenAt: Date | null;
  isLatest: boolean;
  mustFound: number;
  mustTotal: number;
  decisionStored: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionVersion: number;
  reanalyzing: boolean;
}

/**
 * The single source of the pool's numbers. The vacancy list, the Candidate pool, the report's
 * previous/next walk and the assistant's answers all read these rows, so a count shown in one place
 * is the count shown everywhere (Development Plan, rule 4: the server owns the numbers).
 */
@Injectable()
export class PoolService {
  constructor(
    private readonly db: DbService,
    private readonly adj: AdjustmentService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get namesShown() {
    return this.env.CANDIDATE_NAMES === 'shown';
  }

  async rows(vacancyIds: string[], opts: { withSkills?: boolean } = {}): Promise<PoolRow[]> {
    if (vacancyIds.length === 0) return [];
    const { rows } = await this.db.query<Raw>(
      `WITH docs AS (
         SELECT d.id, d.vacancy_id, d.uploaded_at, d.erased_at,
                row_number() OVER (PARTITION BY d.vacancy_id ORDER BY d.uploaded_at, d.id)::int AS ordinal,
                count(*) OVER (PARTITION BY d.vacancy_id)::int AS total
           FROM cv_document d WHERE d.vacancy_id = ANY($1::char(26)[]))
       SELECT d.id AS "documentId", d.vacancy_id AS "vacancyId", d.ordinal, d.total,
              d.uploaded_at AS "uploadedAt",
              v.title AS "vacancyTitle", v.status AS "vacancyStatus",
              v.archived_at IS NOT NULL AS archived, v.requirements_version AS "vacancyReqVersion",
              m.id AS "matchId", m.candidate_name AS "candidateName", m.score::float AS score, m.completed_at AS "analyzedAt",
              m.req_version AS "matchReqVersion", m.frozen_at AS "matchSetFrozenAt",
              m.is_latest AS "isLatest",
              must.found AS "mustFound", must.total AS "mustTotal",
              dec.outcome AS "decisionStored", dec.reason AS "decisionNote",
              dec.decided_at AS "decidedAt", dec.by AS "decidedBy",
              (SELECT count(*)::int FROM decision x JOIN screening s3 ON s3.id = x.screening_id
                WHERE s3.document_id = d.id) AS "decisionVersion",
              EXISTS (SELECT 1 FROM screening s4
                       WHERE s4.document_id = d.id AND s4.state IN ('queued', 'processing')
                         AND s4.cancelled_at IS NULL) AS reanalyzing
         FROM docs d
         JOIN vacancy v ON v.id = d.vacancy_id
         JOIN LATERAL (
              SELECT sc.id, sc.candidate_name, sc.score, sc.band, sc.completed_at, sc.breakdown,
                     rs.requirements_version AS req_version, rs.frozen_at,
                     rs.id = (SELECT q.id FROM requirement_set q
                               WHERE q.vacancy_id = d.vacancy_id AND q.frozen_at IS NOT NULL
                               ORDER BY q.version DESC LIMIT 1) AS is_latest
                FROM screening sc JOIN requirement_set rs ON rs.id = sc.requirement_set_id
               WHERE sc.document_id = d.id AND sc.state = 'completed'
               ORDER BY rs.version DESC LIMIT 1) m ON true
         CROSS JOIN LATERAL (
              SELECT count(*) FILTER (WHERE i->>'classification' = 'mandatory' AND i->>'status' = 'met')::int AS found,
                     count(*) FILTER (WHERE i->>'classification' = 'mandatory')::int AS total
                FROM jsonb_array_elements(COALESCE(m.breakdown->'items', '[]'::jsonb)) i) must
         LEFT JOIN LATERAL (
              SELECT x.outcome, x.reason, x.decided_at, u.display_name AS by
                FROM decision x JOIN screening s2 ON s2.id = x.screening_id
                JOIN app_user u ON u.id = x.decided_by
               WHERE s2.document_id = d.id ORDER BY x.decided_at DESC, x.id DESC LIMIT 1) dec ON true
        WHERE d.erased_at IS NULL AND m.score IS NOT NULL AND m.band <> 'needs_review'`,
      [vacancyIds],
    );

    // Requirement changes made on the results screen (6.2.5) re-weigh the stored assessments;
    // the pool shows the same adjusted score as the results do.
    const adjusted = new Map<string, { score: number; found: number; total: number }>();
    for (const vid of new Set(rows.filter((r) => r.isLatest).map((r) => r.vacancyId))) {
      const overlay = await this.adj.overlay(vid);
      if (overlay.size === 0) continue;
      const ids = rows.filter((r) => r.vacancyId === vid && r.isLatest).map((r) => r.matchId);
      for (const [sid, s] of await this.adj.rescore(ids, overlay)) {
        if (s.score === null) continue;
        const t = mustHaveTally(s.breakdown);
        adjusted.set(sid, { score: s.score, found: t.found, total: t.total });
      }
    }

    const out: PoolRow[] = rows.map((r) => {
      const a = adjusted.get(r.matchId);
      const score = a?.score ?? r.score;
      const decided = r.decidedAt ? new Date(r.decidedAt).toISOString() : null;
      const analyzed = new Date(r.analyzedAt).toISOString();
      return {
        documentId: r.documentId,
        vacancyId: r.vacancyId,
        vacancyTitle: r.vacancyTitle,
        vacancyStatus: r.vacancyStatus,
        vacancyArchived: r.archived,
        pseudonym: pseudonym(r.ordinal, r.total),
        label:
          this.namesShown && r.candidateName?.trim()
            ? r.candidateName.trim()
            : pseudonym(r.ordinal, r.total),
        name: this.namesShown && r.candidateName?.trim() ? r.candidateName.trim() : null,
        ordinal: r.ordinal,
        matchId: r.matchId,
        score,
        band: bandOf(score),
        mustFound: a?.found ?? r.mustFound,
        mustTotal: a?.total ?? r.mustTotal,
        decision: markFromStored(r.decisionStored),
        decisionNote: r.decisionNote,
        decisionVersion: r.decisionVersion,
        decidedAt: decided,
        decidedBy: r.decidedBy,
        outOfDate: (r.matchReqVersion ?? 1) < r.vacancyReqVersion,
        scoredAgainst: r.matchSetFrozenAt ? new Date(r.matchSetFrozenAt).toISOString() : null,
        reanalyzing: r.reanalyzing,
        analyzedAt: analyzed,
        updatedAt: decided && decided > analyzed ? decided : analyzed,
        uploadedAt: new Date(r.uploadedAt).toISOString(),
      };
    });

    if (opts.withSkills && out.length) {
      const { rows: sk } = await this.db.query<{ id: string; skills: string[] }>(
        `SELECT sc.id, array_agg(i->>'text') FILTER (WHERE i->>'status' IN ('met', 'partially_met')) AS skills
           FROM screening sc, jsonb_array_elements(COALESCE(sc.breakdown->'items', '[]'::jsonb)) i
          WHERE sc.id = ANY($1::char(26)[]) GROUP BY sc.id`,
        [out.map((r) => r.matchId)],
      );
      const by = new Map(sk.map((s) => [s.id, s.skills ?? []]));
      for (const r of out) r.skills = by.get(r.matchId) ?? [];
    }
    return out;
  }

  /** Spec 6.2.7 and 6.8: match descending; ties by more must-haves found, then upload order. */
  static byMatch(a: PoolRow, b: PoolRow): number {
    return (
      b.score - a.score ||
      b.mustFound - a.mustFound ||
      a.uploadedAt.localeCompare(b.uploadedAt) ||
      a.documentId.localeCompare(b.documentId)
    );
  }

  static matches(r: PoolRow, q: string): boolean {
    const words = foldText(q).split(' ').filter(Boolean);
    if (!words.length) return true;
    const hay = foldText(
      [r.pseudonym, r.name ?? '', r.vacancyTitle, ...(r.skills ?? [])].join(' '),
    );
    return words.every((w) => hay.includes(w));
  }
}
