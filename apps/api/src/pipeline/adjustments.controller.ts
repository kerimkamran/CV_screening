import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { AdjustmentService } from './adjustments.service';

const change = z.object({
  requirementId: ulidSchema,
  to: z.enum(['mandatory', 'preferred', 'ignore']),
});

/** Design spec 6.2.5: edit requirements on the results screen, with a history and a way back. */
@Roles('TA_PARTNER', 'TA_LEAD')
@Controller('vacancies/:id/adjustments')
export class AdjustmentsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly adj: AdjustmentService,
  ) {}

  @Get()
  async get(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    return this.adj.view(vid);
  }

  @Post()
  @HttpCode(200)
  async set(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    const c = parse(change, body);
    await this.scope.assert(p, vid);
    if (p.actorType !== 'human')
      throw new BadRequestException('Only a person can change requirements');
    const v = await this.adj.view(vid);
    const r = v.requirements.find((x) => x.id === c.requirementId);
    if (!r) throw new BadRequestException('That requirement is not part of the current scan');
    if (r.current !== c.to) {
      await this.db.withTx(async (tx) => {
        await tx.query(
          `INSERT INTO criteria_adjustment (id, vacancy_id, requirement_id, from_kind, to_kind, changed_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [newId(), vid, r.id, r.current, c.to, p.userId],
        );
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: 'human',
          sourceIp: req.ip,
          action: 'criteria.adjusted',
          entityType: 'vacancy',
          entityId: vid,
          before: { requirementId: r.id, kind: r.current },
          after: { requirementId: r.id, kind: c.to },
        });
      });
    }
    return this.adj.view(vid);
  }

  /** Back to the original ranking. The history keeps every change and this reset. */
  @Post('reset')
  @HttpCode(200)
  async reset(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    if (p.actorType !== 'human')
      throw new BadRequestException('Only a person can change requirements');
    if ((await this.adj.overlay(vid)).size > 0) {
      await this.db.withTx(async (tx) => {
        await tx.query(
          `INSERT INTO criteria_adjustment (id, vacancy_id, is_reset, changed_by) VALUES ($1,$2,true,$3)`,
          [newId(), vid, p.userId],
        );
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: 'human',
          sourceIp: req.ip,
          action: 'criteria.adjustment_reset',
          entityType: 'vacancy',
          entityId: vid,
        });
      });
    }
    return this.adj.view(vid);
  }

  /**
   * What a change would do, before it is applied: the scores every candidate would have. Nothing is
   * stored. The client turns scores into bands the same way it does for the list.
   */
  @Post('preview')
  @HttpCode(200)
  async preview(@Param('id') id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const vid = parse(ulidSchema, id);
    const c = parse(change, body);
    await this.scope.assert(p, vid);
    const overlay = await this.adj.overlay(vid);
    overlay.set(c.requirementId, c.to);
    const { rows } = await this.db.query<{ screeningId: string; documentId: string }>(
      `SELECT sc.id AS "screeningId", d.id AS "documentId"
         FROM screening sc JOIN cv_document d ON d.id = sc.document_id
        WHERE d.vacancy_id = $1 AND sc.state = 'completed' AND d.erased_at IS NULL
          AND sc.requirement_set_id = (SELECT id FROM requirement_set WHERE vacancy_id = $1
                                        AND frozen_at IS NOT NULL ORDER BY version DESC LIMIT 1)`,
      [vid],
    );
    const scored = await this.adj.rescore(
      rows.map((r) => r.screeningId),
      overlay,
    );
    return {
      scores: Object.fromEntries(
        rows.map((r) => [r.documentId, scored.get(r.screeningId)?.score ?? null]),
      ),
    };
  }
}
