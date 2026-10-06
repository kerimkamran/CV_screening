import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AdjustmentService } from './adjustments.service';
import type { CandidateRow } from './export.service';
import type { Breakdown } from './score';

/** The ranked candidate rows for a vacancy: one query, requirement adjustments applied. */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly db: DbService,
    private readonly adj: AdjustmentService,
  ) {}

  async rows(vid: string): Promise<CandidateRow[]> {
    const { rows } = await this.db.query<
      Omit<CandidateRow, 'score'> & { score: number | null; breakdown: Breakdown | null }
    >(
      `WITH cur AS (
         SELECT id FROM requirement_set WHERE vacancy_id = $1 AND frozen_at IS NOT NULL ORDER BY version DESC LIMIT 1)
       SELECT sc.id AS "screeningId", d.id AS "documentId", d.filename, d.uploaded_at AS "uploadedAt",
              d.parse_status AS "parseStatus", d.erased_at IS NOT NULL AS erased,
              CASE WHEN sc.state = 'queued' AND sc.cancelled_at IS NOT NULL THEN 'stopped'
                   ELSE COALESCE(sc.state::text, 'queued') END AS state, sc.candidate_name AS "candidateName", sc.band,
              sc.score::float AS score, sc.breakdown, sc.knockout_triggered AS "knockoutTriggered",
              sc.injection_suspected AS "injectionSuspected", sc.error,
              (SELECT json_build_object('outcome', x.outcome, 'reason', x.reason, 'decidedAt', x.decided_at,
                                        'decidedBy', u.display_name)
                 FROM decision x JOIN app_user u ON u.id = x.decided_by
                WHERE x.screening_id = sc.id ORDER BY x.decided_at DESC, x.id DESC LIMIT 1) AS decision
         FROM cv_document d
         LEFT JOIN screening sc ON sc.document_id = d.id AND sc.requirement_set_id = (SELECT id FROM cur)
        WHERE d.vacancy_id = $1
        ORDER BY sc.score DESC NULLS LAST, d.uploaded_at DESC`,
      [vid],
    );
    // SCORE-03: a score is only ever serialised together with its breakdown.
    const out: CandidateRow[] = rows.map(({ score, breakdown, ...r }) => ({
      ...r,
      uploadedAt: new Date(r.uploadedAt).toISOString(),
      score: score !== null && breakdown ? { value: score, breakdown } : null,
    }));
    // Spec 6.2.5: the recruiter's requirement changes re-rank without re-reading anyone.
    await this.adj.apply(vid, out);
    // Pseudonym number = upload order, the same rule the screen uses, so it never changes.
    const byUpload = [...out].sort(
      (a, b) =>
        a.uploadedAt.localeCompare(b.uploadedAt) || a.documentId.localeCompare(b.documentId),
    );
    byUpload.forEach((r, i) => (r.ordinal = i + 1));
    return out;
  }

  /**
   * Which names a person has shown in this run: the latest of "revealed" / "hidden again" per
   * candidate in the audit trail, so it follows them across devices and nothing extra is stored.
   */
  async revealedBy(vid: string, userId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ screeningId: string; action: string }>(
      `SELECT DISTINCT ON (a.entity_id) a.entity_id AS "screeningId", a.action
         FROM audit_event a
         JOIN screening sc ON sc.id = a.entity_id
         JOIN cv_document d ON d.id = sc.document_id
        WHERE a.actor_id = $1 AND d.vacancy_id = $2
          AND a.action IN ('candidate.name_revealed', 'candidate.name_hidden')
        ORDER BY a.entity_id, a.seq DESC`,
      [userId, vid],
    );
    return rows.filter((r) => r.action === 'candidate.name_revealed').map((r) => r.screeningId);
  }
}
