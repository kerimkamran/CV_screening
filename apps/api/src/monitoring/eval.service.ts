import { ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { newId } from '@cv/shared';
import { AiGateway } from '../ai/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { DbService } from '../db/db.service';
import { assessCv, type Req } from '../pipeline/assess';
import { analyse, buildCv, REQUIREMENTS, TEMPLATES, VARIANTS, type Arm, type Cell } from './paired';

const CONCURRENCY = 3;

/** Runs the paired-CV fairness test in the background and keeps the result (plan EVAL-01). */
@Injectable()
export class EvalService implements OnApplicationBootstrap {
  private readonly log = new Logger('eval');
  private running: Promise<void> | null = null;

  constructor(
    private readonly db: DbService,
    private readonly ai: AiGateway,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    // A run cut short by a restart is not left "running" for ever.
    await this.db
      .query(
        `UPDATE eval_run SET state = 'failed', finished_at = now(), error = 'The server restarted during the run'
          WHERE state = 'running'`,
      )
      .catch((e: Error) => this.log.warn(`stale eval recovery skipped: ${e.message}`));
  }

  /** For tests: resolves when the current run has finished. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  async start(p: Principal, arms: Arm[]): Promise<{ id: string; total: number }> {
    const active = await this.ai.active();
    if (!active)
      throw new ConflictException('Choose and test an AI model first (Admin > AI models).');
    const running = await this.db.query(`SELECT 1 FROM eval_run WHERE state = 'running' LIMIT 1`);
    if (running.rows.length) throw new ConflictException('A fairness test is already running.');
    const total = TEMPLATES.length * VARIANTS.length * arms.length;
    const id = newId();
    await this.db.withTx(async (tx) => {
      await tx.query(
        `INSERT INTO eval_run (id, kind, started_by, total, params, ai_provider, ai_model)
         VALUES ($1,'paired_cv',$2,$3,$4,$5,$6)`,
        [
          id,
          p.userId,
          total,
          JSON.stringify({
            arms,
            templates: TEMPLATES.map((t) => t.key),
            variants: VARIANTS.map((v) => v.key),
          }),
          active.provider,
          active.model,
        ],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: 'human',
        action: 'eval.started',
        entityType: 'eval_run',
        entityId: id,
        after: { arms, total, provider: active.provider, model: active.model },
      });
    });
    this.running = this.execute(id, p.userId, arms).finally(() => {
      this.running = null;
    });
    return { id, total };
  }

  private async execute(id: string, userId: string, arms: Arm[]) {
    const reqs: Req[] = REQUIREMENTS.map((r) => ({
      id: newId(),
      text: r.text,
      classification: r.classification,
      weight: r.weight,
      rule: null,
      confidence: 'high',
    }));
    const jobs: {
      template: (typeof TEMPLATES)[number];
      variant: (typeof VARIANTS)[number];
      arm: Arm;
    }[] = [];
    for (const arm of arms)
      for (const template of TEMPLATES)
        for (const variant of VARIANTS) jobs.push({ template, variant, arm });

    const cells: Cell[] = [];
    let done = 0;
    let failure: string | null = null;
    const next = async () => {
      for (let j = jobs.shift(); j; j = jobs.shift()) {
        const cell: Cell = {
          template: j.template.key,
          variant: j.variant.key,
          arm: j.arm,
          score: null,
          statuses: [],
        };
        try {
          const r = await assessCv(this.ai, reqs, buildCv(j.template, j.variant), null, {
            mask: j.arm === 'masked',
          });
          cell.score = r.score;
          cell.statuses = r.rows.map((x) => x.status);
        } catch (e) {
          cell.error = (e instanceof Error ? e.message : 'failed').slice(0, 200);
          failure ??= cell.error;
        }
        cells.push(cell);
        done++;
        if (done % 4 === 0)
          await this.db
            .query(`UPDATE eval_run SET progress = $2 WHERE id = $1`, [id, done])
            .catch(() => undefined);
      }
    };
    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, next));
      const summary = analyse(cells, arms);
      const allFailed = cells.every((c) => c.score === null);
      await this.db.withTx(async (tx) => {
        await tx.query(
          `UPDATE eval_run SET state = $2, finished_at = now(), progress = $3, result = $4, error = $5 WHERE id = $1`,
          [
            id,
            allFailed ? 'failed' : 'done',
            done,
            JSON.stringify({ summary, cells }),
            allFailed ? (failure ?? 'every call failed') : null,
          ],
        );
        await this.audit.record(tx, {
          actorId: userId,
          actorType: 'human',
          action: 'eval.finished',
          entityType: 'eval_run',
          entityId: id,
          after: {
            verdicts: summary.map((s) => ({
              arm: s.arm,
              verdict: s.verdict,
              maxAbsDelta: s.maxAbsDelta,
            })),
          },
        });
      });
    } catch (e) {
      this.log.warn(`eval ${id} failed: ${(e as Error).message}`);
      await this.db
        .query(
          `UPDATE eval_run SET state = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
          [id, (e as Error).message.slice(0, 300)],
        )
        .catch(() => undefined);
    }
  }
}
