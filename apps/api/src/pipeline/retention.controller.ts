import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { AuditService } from '../audit/audit.service';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { RetentionService } from './retention.service';

const settingSchema = z.object({
  enabled: z.boolean(),
  days: z.number().int().min(30).max(3650),
});
const holdSchema = z.object({
  hold: z.boolean(),
  matter: z.string().trim().min(3).max(200).optional(),
});

/** DOC-09/10/11 for the people responsible for the data (ADMIN, GOVERNANCE). */
@Roles('ADMIN', 'GOVERNANCE')
@Controller()
export class RetentionController {
  constructor(
    private readonly svc: RetentionService,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get('admin/retention')
  async status() {
    const [setting, preview, certs, vacancies] = await Promise.all([
      this.svc.setting(),
      this.svc.preview(),
      this.db.query(
        `SELECT c.id, c.run_at AS "runAt", c.trigger, c.days, c.documents, c.held_back AS "heldBack",
                c.vacancies, u.display_name AS "by"
           FROM retention_certificate c JOIN app_user u ON u.id = c.actor_id
          ORDER BY c.run_at DESC LIMIT 20`,
      ),
      this.db.query(
        `SELECT v.id, v.title, v.legal_hold AS "legalHold", v.legal_hold_matter AS matter,
                v.legal_hold_at AS "since", u.display_name AS "by",
                (SELECT count(*)::int FROM cv_document d WHERE d.vacancy_id = v.id AND d.erased_at IS NULL) AS documents
           FROM vacancy v LEFT JOIN app_user u ON u.id = v.legal_hold_by
          ORDER BY v.legal_hold DESC, v.created_at DESC LIMIT 500`,
      ),
    ]);
    return {
      ...setting,
      due: preview.documents,
      heldBack: preview.heldBack,
      cutoff: preview.cutoff,
      certificates: certs.rows,
      vacancies: vacancies.rows,
    };
  }

  @Put('admin/retention')
  async update(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const s = parse(settingSchema, body);
    const before = await this.svc.setting();
    await this.db.withTx(async (tx) => {
      await tx.query(
        `UPDATE retention_setting SET enabled = $1, days = $2, updated_by = $3, updated_at = now() WHERE id = 1`,
        [s.enabled, s.days, p.userId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'retention.setting',
        entityType: 'retention_setting',
        entityId: '00000000000000000000000001',
        before,
        after: s,
      });
    });
    return this.status();
  }

  @Post('admin/retention/run')
  @HttpCode(200)
  async run(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const { dryRun } = parse(z.object({ dryRun: z.boolean().default(true) }), body ?? {});
    return this.svc.run('manual', dryRun, p.userId);
  }

  @Put('admin/vacancies/:id/legal-hold')
  async hold(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    const h = parse(holdSchema, body);
    if (h.hold && !h.matter)
      throw new BadRequestException('A matter reference is required for a hold');
    return this.db.withTx(async (tx) => {
      const r = await tx.query(
        `UPDATE vacancy SET legal_hold = $2, legal_hold_matter = $3,
                legal_hold_by = CASE WHEN $2 THEN $4::ulid END, legal_hold_at = CASE WHEN $2 THEN now() END
          WHERE id = $1`,
        [vid, h.hold, h.hold ? h.matter : null, p.userId],
      );
      if (!r.rowCount) throw new NotFoundException('Vacancy not found');
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: h.hold ? 'vacancy.legal_hold_on' : 'vacancy.legal_hold_off',
        entityType: 'vacancy',
        entityId: vid,
        after: h.hold ? { matter: h.matter } : {},
      });
      return { legalHold: h.hold };
    });
  }
}
