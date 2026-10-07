import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import { AiGateway } from '../ai/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { DbService } from '../db/db.service';
import { looksLikeInjection } from './injection';
import { redact } from './report.service';
import { assessCv, type Req } from './assess';
import { evaluateKnockout } from './knockout';
import { bandFor } from './score';

const MAX_ATTEMPTS = 3;
const SYSTEM_SUBJECT = 'screening-worker';

/**
 * Runs one screening: deterministic knockout → one model call → verified evidence →
 * deterministic score. The model never decides anything; the result is a recommendation a human
 * reviews. In-process queue over Postgres (FOR UPDATE SKIP LOCKED) so it survives restarts.
 */
@Injectable()
export class ProcessorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('worker');
  private timer?: NodeJS.Timeout;
  private running = 0;
  private systemUserId?: string;

  constructor(
    private readonly db: DbService,
    private readonly ai: AiGateway,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap() {
    // Work claimed by a process that died is put back. Best effort: readiness reports DB trouble.
    await this.db
      .query(
        `UPDATE screening SET state = 'queued' WHERE state = 'processing' AND started_at < now() - interval '10 minutes'`,
      )
      .catch((e: Error) => this.log.warn(`stale-claim recovery skipped: ${e.message}`));
    if (this.env.WORKER_ENABLED === 'true') {
      this.timer = setInterval(() => void this.tick(), 3000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public so tests (and a future dedicated worker) can drive it. Returns true if work was done. */
  async tick(): Promise<boolean> {
    if (this.running >= this.env.WORKER_CONCURRENCY) return false;
    // Nothing is claimed while no provider is active: work waits in the queue, visibly.
    if (!(await this.ai.active())) return false;
    const claimed = await this.db.query<{ id: string }>(
      `UPDATE screening SET state = 'processing', started_at = now(), attempts = attempts + 1
        WHERE id = (SELECT id FROM screening WHERE state = 'queued' AND cancelled_at IS NULL AND run_after <= now()
                     ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id`,
    );
    const id = claimed.rows[0]?.id;
    if (!id) return false;
    this.running++;
    try {
      await this.process(id);
    } finally {
      this.running--;
    }
    return true;
  }

  async drain(max = 1000): Promise<void> {
    for (let i = 0; i < max && (await this.tick()); i++);
  }

  private async actor(): Promise<string> {
    if (this.systemUserId) return this.systemUserId;
    await this.db.query(
      `INSERT INTO app_user (id, issuer, subject, actor_kind, display_name)
       VALUES ($1,'system',$2,'service','Screening worker') ON CONFLICT (issuer, subject) DO NOTHING`,
      [newId(), SYSTEM_SUBJECT],
    );
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM app_user WHERE issuer = 'system' AND subject = $1`,
      [SYSTEM_SUBJECT],
    );
    return (this.systemUserId = rows[0]!.id);
  }

  async process(screeningId: string): Promise<void> {
    try {
      await this.run(screeningId);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : 'unknown error').slice(0, 300);
      this.log.warn(`screening ${screeningId} failed: ${msg}`);
      await this.db.query(
        `UPDATE screening SET
            state = CASE WHEN attempts >= $2 THEN 'failed'::screening_state ELSE 'queued'::screening_state END,
            run_after = now() + (attempts * interval '30 seconds'),
            error = $3
          WHERE id = $1`,
        [screeningId, MAX_ATTEMPTS, msg],
      );
    }
  }

  private async run(screeningId: string) {
    const s = (
      await this.db.query<{
        text: string | null;
        set_id: string;
        erased: boolean;
        pages: number[] | null;
      }>(
        `SELECT d.text, d.page_starts AS pages, s.requirement_set_id AS set_id, d.erased_at IS NOT NULL AS erased
           FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE s.id = $1`,
        [screeningId],
      )
    ).rows[0];
    if (!s || s.erased || !s.text) {
      await this.db.query(`UPDATE screening SET state = 'manual' WHERE id = $1`, [screeningId]);
      return;
    }
    const text = s.text;
    const reqs = (
      await this.db.query<Req>(
        `SELECT id, text, classification, weight::float AS weight, rule, extraction_conf AS confidence
           FROM requirement WHERE requirement_set_id = $1 ORDER BY position, id`,
        [s.set_id],
      )
    ).rows;

    // 1. Knockout: deterministic, no model, and it only routes to review.
    const knockout = reqs
      .filter((r) => r.classification === 'disqualifier' && r.rule)
      .map((r) => evaluateKnockout({ id: r.id, text: r.text, rule: r.rule! }, text));
    const knockoutTriggered = knockout.some((k) => k.triggered);
    const injection = looksLikeInjection(text);

    // 2-3. One model call, verified evidence, deterministic score (see assess.ts). The provider is
    // shown the CV with identity and personal fields masked; who the candidate is comes from code.
    const { identity, masked, parsed, out, rows, score, breakdown } = await assessCv(
      this.ai,
      reqs,
      text,
      s.pages,
    );
    const band = bandFor(score, knockoutTriggered || injection);
    const actorId = await this.actor();

    await this.db.withTx(async (tx) => {
      await tx.query(`DELETE FROM requirement_assessment WHERE screening_id = $1`, [screeningId]);
      for (const x of rows) {
        await tx.query(
          `INSERT INTO requirement_assessment
             (id, screening_id, requirement_id, status, confidence, evidence, evidence_dropped, rationale)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            newId(),
            screeningId,
            x.req.id,
            x.status,
            ['high', 'medium', 'low', 'unknown'].includes(x.confidence) ? x.confidence : 'unknown',
            JSON.stringify(x.spans),
            x.dropped,
            x.rationale?.slice(0, 600) ?? null,
          ],
        );
      }
      await tx.query(
        `UPDATE screening SET state = 'completed', completed_at = now(), error = NULL,
                candidate_name = $2, candidate_email = $3, summary = $4,
                knockout = $5, knockout_triggered = $6, injection_suspected = $7,
                score = $8, breakdown = $9, band = $10, ai_provider = $11, ai_model = $12
          WHERE id = $1`,
        [
          screeningId,
          identity.name,
          identity.email,
          parsed.summary ? redact(parsed.summary, identity.name).slice(0, 1200) : null,
          JSON.stringify(knockout),
          knockoutTriggered,
          injection,
          score,
          score === null ? null : JSON.stringify(breakdown),
          band,
          out.provider,
          out.model,
        ],
      );
      // Traceability: which model processed which CV, and what it recommended (never a decision).
      await this.audit.record(tx, {
        actorId,
        actorType: 'service',
        action: 'screening.completed',
        entityType: 'screening',
        entityId: screeningId,
        after: {
          provider: out.provider,
          model: out.model,
          band,
          knockoutTriggered,
          injection,
          masked: masked.counts,
        },
      });
    });
  }
}
