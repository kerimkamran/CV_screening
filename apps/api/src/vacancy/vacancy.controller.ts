import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
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
import { VacancyScope } from './vacancy-scope.service';

/**
 * IAM-04 and spec 6.10: who may see a vacancy is decided in VacancyScope. The pool (list, create,
 * save, archive) lives in pipeline/vacancy-pool.controller.ts; this controller keeps the job
 * description, the candidate-notice attestation and access grants.
 */
@Controller('vacancies')
export class VacancyController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
  ) {}

  @Roles('TA_PARTNER', 'TA_LEAD')
  @Get(':id/jd')
  async jd(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    const { rows } = await this.db.query(
      `SELECT version, body, created_at AS "createdAt" FROM job_description_version
        WHERE vacancy_id = $1 ORDER BY version DESC LIMIT 1`,
      [vid],
    );
    return rows[0];
  }

  /** A new JD version. Existing frozen criteria are untouched (JOB-07); extract again to refresh the draft. */
  @Roles('TA_PARTNER', 'TA_LEAD')
  @Put(':id/jd')
  async updateJd(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    const { jdText } = parse(z.object({ jdText: z.string().trim().min(50).max(40_000) }), body);
    await this.scope.assert(p, vid);
    return this.db.withTx(async (tx) => {
      await tx.query(`SELECT 1 FROM vacancy WHERE id = $1 FOR UPDATE`, [vid]);
      const { rows } = await tx.query<{ v: number }>(
        `SELECT COALESCE(max(version), 0) + 1 AS v FROM job_description_version WHERE vacancy_id = $1`,
        [vid],
      );
      await tx.query(
        `INSERT INTO job_description_version (id, vacancy_id, version, body, source_kind, created_by)
         VALUES ($1,$2,$3,$4,'pasted',$5)`,
        [newId(), vid, rows[0]!.v, jdText, p.userId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'vacancy.jd_update',
        entityType: 'vacancy',
        entityId: vid,
        after: { version: rows[0]!.v },
      });
      return { version: rows[0]!.v };
    });
  }

  /**
   * Deployer attestation (EU AI Act Art. 26(7), GDPR Art. 13-14): the recruiter confirms
   * candidates have been told that AI assists screening. CV uploads are refused until then.
   */
  @Roles('TA_PARTNER', 'TA_LEAD')
  @Post(':id/notice-confirm')
  @HttpCode(200)
  async confirmNotice(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    return this.db.withTx(async (tx) => {
      await tx.query(
        `UPDATE vacancy SET candidate_notice_confirmed_at = now(), candidate_notice_confirmed_by = $2 WHERE id = $1`,
        [vid, p.userId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'vacancy.notice_confirmed',
        entityType: 'vacancy',
        entityId: vid,
      });
      return { confirmed: true };
    });
  }

  @Roles('TA_LEAD')
  @Post(':id/access')
  @HttpCode(201)
  grant(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    const { userId } = parse(z.object({ userId: ulidSchema }), body);
    return this.db.withTx(async (tx) => {
      const v = await tx.query(`SELECT 1 FROM vacancy WHERE id = $1`, [vid]);
      const u = await tx.query(`SELECT 1 FROM app_user WHERE id = $1 AND status = 'active'`, [
        userId,
      ]);
      if (!v.rowCount || !u.rowCount) throw new NotFoundException();
      const rowId = newId();
      const ins = await tx.query(
        `INSERT INTO vacancy_access (id, vacancy_id, user_id, granted_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (vacancy_id, user_id) WHERE revoked_at IS NULL DO NOTHING`,
        [rowId, vid, userId, actor.userId],
      );
      if (ins.rowCount) {
        await this.audit.record(tx, {
          actorId: actor.userId,
          actorType: actor.actorType,
          actorRole: 'TA_LEAD',
          sourceIp: req.ip,
          action: 'vacancy_access.grant',
          entityType: 'vacancy',
          entityId: vid,
          after: { userId },
        });
      }
      return { vacancyId: vid, userId, changed: Boolean(ins.rowCount) };
    });
  }

  @Roles('TA_LEAD')
  @Delete(':id/access/:userId')
  revoke(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    const uid = parse(ulidSchema, userId);
    return this.db.withTx(async (tx) => {
      const upd = await tx.query(
        `UPDATE vacancy_access SET revoked_at = now(), revoked_by = $3
          WHERE vacancy_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [vid, uid, actor.userId],
      );
      if (!upd.rowCount) throw new NotFoundException();
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'TA_LEAD',
        sourceIp: req.ip,
        action: 'vacancy_access.revoke',
        entityType: 'vacancy',
        entityId: vid,
        before: { userId: uid },
      });
      return { vacancyId: vid, userId: uid, changed: true };
    });
  }
}
