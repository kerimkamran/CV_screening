import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { DECISION_OUTCOMES, newId } from '@cv/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';

const decisionSchema = z.object({
  outcome: z.enum(DECISION_OUTCOMES),
  reason: z.string().trim().min(10).max(2000),
  /** Required for `reject`: the reviewer attests they looked at the evidence, not just the score. */
  evidenceReviewed: z.boolean().optional(),
});

@Roles('TA_PARTNER', 'TA_LEAD')
@Controller('screenings')
export class ScreeningsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
  ) {}

  /**
   * Design spec 6.2.6: names are hidden on screen by default. Showing one is a recruiter's action
   * and is recorded: who revealed whom, and when. The name itself is never part of the score.
   */
  @Post('reveal-names')
  @HttpCode(200)
  async revealNames(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const { screeningIds } = parse(
      z.object({ screeningIds: z.array(ulidSchema).min(1).max(500) }),
      body,
    );
    if (p.actorType !== 'human') throw new BadRequestException('Only a person can reveal names');
    const ids = [...new Set(screeningIds)];
    for (const sid of ids) await this.scope.assertScreening(p, sid);
    await this.db.withTx(async (tx) => {
      for (const sid of ids) {
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: 'human',
          sourceIp: req.ip,
          action: 'candidate.name_revealed',
          entityType: 'screening',
          entityId: sid,
        });
      }
    });
    return { revealed: ids.length };
  }

  /** WORK-02..04: everything the reviewer needs — and the evidence behind every number. */
  @Get(':id')
  async one(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const sid = parse(ulidSchema, id);
    const { vacancyId } = await this.scope.assertScreening(p, sid);
    const s = (
      await this.db.query(
        `SELECT sc.id, sc.state, sc.band, sc.candidate_name AS "candidateName", sc.candidate_email AS "candidateEmail",
                sc.summary, sc.knockout, sc.knockout_triggered AS "knockoutTriggered",
                sc.injection_suspected AS "injectionSuspected", sc.score::float AS score, sc.breakdown,
                sc.ai_provider AS "aiProvider", sc.ai_model AS "aiModel", sc.error,
                rs.version AS "criteriaVersion",
                d.id AS "documentId", d.filename, d.uploaded_at AS "uploadedAt", d.parse_status AS "parseStatus",
                d.text, d.text_truncated AS "textTruncated", d.erased_at IS NOT NULL AS erased
           FROM screening sc
           JOIN cv_document d ON d.id = sc.document_id
           JOIN requirement_set rs ON rs.id = sc.requirement_set_id
          WHERE sc.id = $1`,
        [sid],
      )
    ).rows[0];
    if (!s) throw new NotFoundException();
    const assessments = (
      await this.db.query(
        `SELECT r.id AS "requirementId", r.text, r.classification, r.weight::float AS weight,
                a.status, a.confidence, a.evidence, a.evidence_dropped AS "evidenceDropped", a.rationale
           FROM requirement r
           LEFT JOIN requirement_assessment a ON a.requirement_id = r.id AND a.screening_id = $1
          WHERE r.requirement_set_id = (SELECT requirement_set_id FROM screening WHERE id = $1)
            AND r.classification <> 'disqualifier'
          ORDER BY r.position, r.id`,
        [sid],
      )
    ).rows;
    const decisions = (
      await this.db.query(
        `SELECT x.id, x.outcome, x.reason, x.decided_at AS "decidedAt", u.display_name AS "decidedBy"
           FROM decision x JOIN app_user u ON u.id = x.decided_by
          WHERE x.screening_id = $1 ORDER BY x.decided_at DESC, x.id DESC`,
        [sid],
      )
    ).rows;
    const { score, breakdown, ...rest } = s;
    return {
      ...rest,
      vacancyId,
      // SCORE-03: no score without its breakdown.
      score: score !== null && breakdown ? { value: score, breakdown } : null,
      assessments,
      decisions,
    };
  }

  /**
   * WORK-05/13. The only way a candidate's status changes: a named human, with a reason.
   * Append-only; a later decision supersedes but never erases an earlier one.
   */
  @Post(':id/decision')
  @HttpCode(201)
  async decide(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const sid = parse(ulidSchema, id);
    const d = parse(decisionSchema, body);
    await this.scope.assertScreening(p, sid);
    if (p.actorType !== 'human')
      throw new BadRequestException('Only a person can record a decision');
    if (d.outcome === 'reject' && d.evidenceReviewed !== true) {
      throw new BadRequestException('Confirm that you reviewed the evidence before rejecting');
    }
    return this.db.withTx(async (tx) => {
      const s = (
        await tx.query<{ state: string; erased: boolean }>(
          `SELECT sc.state, d.erased_at IS NOT NULL AS erased
             FROM screening sc JOIN cv_document d ON d.id = sc.document_id WHERE sc.id = $1 FOR UPDATE OF sc`,
          [sid],
        )
      ).rows[0];
      if (!s) throw new NotFoundException();
      if (s.erased) throw new ConflictException("This candidate's data has been erased");
      if (s.state === 'queued' || s.state === 'processing') {
        throw new ConflictException('Screening is still running');
      }
      const rowId = newId();
      await tx.query(
        `INSERT INTO decision (id, screening_id, outcome, reason, decided_by) VALUES ($1,$2,$3,$4,$5)`,
        [rowId, sid, d.outcome, d.reason, p.userId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: 'human',
        sourceIp: req.ip,
        action: `decision.${d.outcome}`,
        entityType: 'screening',
        entityId: sid,
        after: { decisionId: rowId, outcome: d.outcome },
      });
      return { id: rowId, outcome: d.outcome };
    });
  }
}
