import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { readRun, requestCancel, stalled, type RunStats } from './import-runs';
import { OracleEnabledGuard } from './oracle/oracle-enabled.guard';

/**
 * Stage 3, S3-OPS-05 (part a): the list of import runs and Abandon, for administrators. Counts and
 * states only: no Oracle ID, no candidate name, no file name. Behind the one switch.
 */
@Roles('ADMIN')
@UseGuards(OracleEnabledGuard)
@Controller()
export class ImportRunsAdminController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get('admin/integrations/oracle/runs')
  async runs() {
    const rows = await this.db.query<{
      id: string;
      vacancyId: string;
      vacancyTitle: string;
      externalRef: string | null;
      mode: string;
      state: string;
      phase: string;
      listed: number;
      stats: RunStats;
      waitReason: string | null;
      errorCode: string | null;
      startedBy: string | null;
      createdAt: string;
      progressAt: string | null;
      finishedAt: string | null;
      waitedSince: string | null;
      awaitingSince: string | null;
    }>(
      `SELECT r.id, r.vacancy_id AS "vacancyId", v.title AS "vacancyTitle", r.external_ref AS "externalRef",
              r.mode, r.state, r.phase, r.listed, r.stats, r.wait_reason AS "waitReason",
              r.error_code AS "errorCode", COALESCE(u.display_name, u.email) AS "startedBy",
              r.created_at AS "createdAt", r.progress_at AS "progressAt", r.finished_at AS "finishedAt",
              r.waited_since AS "waitedSince", r.awaiting_since AS "awaitingSince"
         FROM import_run r JOIN vacancy v ON v.id = r.vacancy_id
         LEFT JOIN app_user u ON u.id = r.started_by
        ORDER BY (r.state IN ('queued','running','awaiting_confirm')) DESC, r.created_at DESC
        LIMIT 100`,
    );
    return {
      runs: rows.rows.map((r) => {
        const s = stalled(r);
        return { ...r, fetched: r.stats.fetched ?? 0, stalled: s !== null, stalledMinutes: s };
      }),
    };
  }

  /** Abandon: the run ends `cancelled` with code `abandoned`; CVs already copied stay. */
  @Post('admin/import-runs/:id/abandon')
  @HttpCode(200)
  async abandon(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const rid = parse(ulidSchema, id);
    return this.db.withTx(async (tx) => {
      const run = await readRun(tx, rid, true);
      if (!run) throw new NotFoundException('Not found');
      const r = await requestCancel(tx, rid, p.userId, 'abandoned');
      if (r.requested)
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: req.ip,
          action: 'import_run.abandoned',
          entityType: 'import_run',
          entityId: rid,
          after: { vacancyId: run.vacancy_id, state: run.state },
        });
      return { abandoned: r.requested, ended: r.ended };
    });
  }
}
