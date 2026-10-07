import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { EvalService } from './eval.service';
import { TEMPLATES, VARIANTS } from './paired';

const startSchema = z.object({
  arms: z
    .array(z.enum(['masked', 'unmasked']))
    .min(1)
    .max(2)
    .default(['masked', 'unmasked']),
});

interface RunRow {
  id: string;
  state: string;
  startedAt: Date;
  finishedAt: Date | null;
  startedBy: string | null;
  progress: number;
  total: number;
  params: unknown;
  result: unknown;
  error: string | null;
  provider: string | null;
  model: string | null;
}
const COLS = `r.id, r.state, r.started_at AS "startedAt", r.finished_at AS "finishedAt",
  u.display_name AS "startedBy", r.progress, r.total, r.params, r.result, r.error,
  r.ai_provider AS provider, r.ai_model AS model`;
const shape = (r: RunRow) => ({
  ...r,
  startedAt: new Date(r.startedAt).toISOString(),
  finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
});

/** The paired-CV fairness test: ADMIN starts it, ADMIN and GOVERNANCE read the results. */
@Controller('admin/eval')
export class EvalController {
  constructor(
    private readonly db: DbService,
    private readonly svc: EvalService,
  ) {}

  @Get()
  @Roles('ADMIN', 'GOVERNANCE')
  async list() {
    const { rows } = await this.db.query<RunRow>(
      `SELECT ${COLS} FROM eval_run r LEFT JOIN app_user u ON u.id = r.started_by
        ORDER BY r.started_at DESC, r.id DESC LIMIT 20`,
    );
    return {
      runs: rows.map(shape),
      design: {
        templates: TEMPLATES.map((t) => ({ key: t.key, title: t.title })),
        variants: VARIANTS.map((v) => ({ key: v.key, label: v.label, change: v.change })),
      },
    };
  }

  @Get(':id')
  @Roles('ADMIN', 'GOVERNANCE')
  async one(@Param('id') id: string) {
    const rid = parse(ulidSchema, id);
    const { rows } = await this.db.query<RunRow>(
      `SELECT ${COLS} FROM eval_run r LEFT JOIN app_user u ON u.id = r.started_by WHERE r.id = $1`,
      [rid],
    );
    if (!rows[0]) throw new NotFoundException();
    return shape(rows[0]);
  }

  @Post('paired')
  @HttpCode(202)
  @Roles('ADMIN')
  start(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.svc.start(p, parse(startSchema, body ?? {}).arms);
  }
}
