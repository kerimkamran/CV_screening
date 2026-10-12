import { Injectable } from '@nestjs/common';
import { MARK_LABEL, markFromStored, type Mark } from '@cv/shared';
import { DbService } from '../db/db.service';
import { AdjustmentService } from './adjustments.service';
import { pageAt } from './documents';
import type { PoolRow } from './pool.service';

export type ReqState = 'matched' | 'partly' | 'missing';

interface Evidence {
  start: number;
  end: number;
  quote?: string;
}

/**
 * What the two-pane report needs (Development Plan WP 3.5): the result on one side, the resume on
 * the other, and the anchors that join them. Names, the original text and quotes are shown as written
 * (decision of 8 October 2026: candidate names are not hidden).
 */
@Injectable()
export class CandidateViewService {
  constructor(
    private readonly db: DbService,
    private readonly adj: AdjustmentService,
  ) {}

  private async source(row: PoolRow) {
    const { rows } = await this.db.query<{
      text: string | null;
      pageStarts: number[] | null;
      filename: string;
      truncated: boolean;
      name: string | null;
      email: string | null;
      summary: string | null;
    }>(
      `SELECT d.text, d.page_starts AS "pageStarts", d.filename, d.text_truncated AS truncated,
              s.candidate_name AS name, s.candidate_email AS email, s.summary
         FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE s.id = $1`,
      [row.matchId],
    );
    return rows[0]!;
  }

  /** Blocks are the paragraphs of the resume; an anchor says which one it falls in. */
  private blocks(text: string, pageStarts: number[] | null) {
    const out: { start: number; end: number; page: number | null }[] = [];
    const re = /\S[\s\S]*?(?=\n{2,}|$)/g;
    for (const m of text.matchAll(re)) {
      out.push({
        start: m.index!,
        end: m.index! + m[0].length,
        page: pageAt(pageStarts, m.index!),
      });
    }
    return out;
  }

  async report(row: PoolRow) {
    const src = await this.source(row);
    const view = src.text ?? '';
    const blocks = this.blocks(view, null);
    const blockOf = (pos: number) => blocks.findIndex((b) => pos >= b.start && pos < b.end + 1);

    const { rows: assess } = await this.db.query<{
      requirementId: string;
      text: string;
      classification: string;
      weight: number | null;
      status: string | null;
      confidence: string | null;
      evidence: Evidence[] | null;
      rationale: string | null;
    }>(
      `SELECT r.id AS "requirementId", r.text, r.classification, r.weight::float AS weight,
              a.status, a.confidence, a.evidence, a.rationale
         FROM requirement r
         LEFT JOIN requirement_assessment a ON a.requirement_id = r.id AND a.screening_id = $1
        WHERE r.requirement_set_id = (SELECT requirement_set_id FROM screening WHERE id = $1)
          AND r.classification <> 'disqualifier'
        ORDER BY r.position, r.id`,
      [row.matchId],
    );
    // Requirement changes made on the results screen move a criterion between must-have and nice-to-have.
    const overlay = await this.adj.overlay(row.vacancyId);
    const isLatest = row.outOfDate === false;
    const kind = (id: string, c: string): 'must' | 'nice' | 'other' => {
      const k = isLatest ? (overlay.get(id) ?? c) : c;
      return k === 'mandatory' ? 'must' : k === 'preferred' ? 'nice' : 'other';
    };

    const requirements = assess.map((a) => {
      const state: ReqState =
        a.status === 'met' ? 'matched' : a.status === 'partially_met' ? 'partly' : 'missing';
      const anchors = (a.evidence ?? [])
        .map((e) => {
          if (e.end <= e.start) return null;
          return {
            start: e.start,
            end: e.end,
            quote: view.slice(e.start, e.end),
            page: pageAt(src.pageStarts, e.start),
            block: Math.max(0, blockOf(e.start)),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return {
        requirementId: a.requirementId,
        text: a.text,
        kind: kind(a.requirementId, a.classification),
        state,
        unclear: a.status === 'ambiguous',
        notFound: a.status === 'not_found' || a.status === 'not_met',
        confidence: a.confidence,
        rationale: a.rationale,
        anchors,
      };
    });

    const { rows: hist } = await this.db.query<{
      outcome: string;
      reason: string | null;
      at: Date;
      by: string;
    }>(
      `SELECT x.outcome, x.reason, x.decided_at AS at, u.display_name AS by
         FROM decision x JOIN screening s ON s.id = x.screening_id JOIN app_user u ON u.id = x.decided_by
        WHERE s.document_id = $1 ORDER BY x.decided_at DESC, x.id DESC LIMIT 50`,
      [row.documentId],
    );
    const { rows: changes } = await this.db.query<{
      version: number;
      at: Date;
      by: string;
      description: string | null;
    }>(
      `SELECT h.requirements_version AS version, h.changed_at AS at, u.display_name AS by, h.description
         FROM vacancy_history h JOIN app_user u ON u.id = h.changed_by
        WHERE h.vacancy_id = $1 AND h.cause <> 'create'
          AND h.requirements_version > (
                SELECT COALESCE(rs.requirements_version, 1) FROM screening s
                  JOIN requirement_set rs ON rs.id = s.requirement_set_id WHERE s.id = $2)
        ORDER BY h.changed_at`,
      [row.vacancyId, row.matchId],
    );

    return {
      matchId: row.matchId,
      documentId: row.documentId,
      label: row.label,
      name: row.name,
      pseudonym: row.pseudonym,
      email: src.email,
      filename: src.filename,
      vacancy: {
        id: row.vacancyId,
        title: row.vacancyTitle,
        status: row.vacancyStatus,
        archived: row.vacancyArchived,
      },
      score: row.score,
      band: row.band,
      mustFound: row.mustFound,
      mustTotal: row.mustTotal,
      summary: src.summary,
      analyzedAt: row.analyzedAt,
      outOfDate: row.outOfDate
        ? {
            scoredAgainst: row.scoredAgainst,
            changes: changes.map((c) => ({ ...c, at: new Date(c.at).toISOString() })),
          }
        : null,
      reanalyzing: row.reanalyzing,
      decision: {
        mark: row.decision,
        note: row.decisionNote,
        version: row.decisionVersion,
        decidedAt: row.decidedAt,
        decidedBy: row.decidedBy,
      },
      history: hist.map((h) => ({
        mark: markFromStored(h.outcome) as Mark,
        label: MARK_LABEL[markFromStored(h.outcome)],
        note: h.reason,
        at: new Date(h.at).toISOString(),
        by: h.by,
      })),
      requirements,
    };
  }

  /** The resume as the reader shows it: the original text with its pages and paragraphs. */
  async resume(row: PoolRow) {
    const src = await this.source(row);
    const text = src.text ?? '';
    return {
      text,
      truncated: src.truncated,
      pageStarts: src.pageStarts,
      blocks: this.blocks(text, src.pageStarts),
    };
  }
}
