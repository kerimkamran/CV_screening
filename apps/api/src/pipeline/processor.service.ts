import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import { AiGateway, PAUSED_TEXT } from '../ai/ai-gateway.service';
import { ProviderError } from '../ai/providers';
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
/** A claim is a lease: the worker extends its own, and an expired one goes back to the queue. */
const LEASE_SECONDS = 120;
const LEASE_EXTEND_MS = 30_000;
const FILL_MS = 2_000;
const SHUTDOWN_WAIT_MS = 20_000;

/** The completion write found the screening no longer ours (erased, stopped, or taken back). */
class LostClaim extends Error {}

/**
 * Runs one screening: deterministic knockout → one model call → verified evidence →
 * deterministic score. The model never decides anything; the result is a recommendation a human
 * reviews. In-process queue over Postgres (FOR UPDATE SKIP LOCKED) so it survives restarts.
 */
@Injectable()
export class ProcessorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('worker');
  private fillTimer?: NodeJS.Timeout;
  private leaseTimer?: NodeJS.Timeout;
  private running = 0;
  private stopping = false;
  private filling = false;
  private fillAgain = false;
  /** screening id → the claim this process holds on it. */
  private readonly claims = new Map<string, string>();
  private systemUserId?: string;

  constructor(
    private readonly db: DbService,
    private readonly ai: AiGateway,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap() {
    // Work claimed by a process that died is put back. Best effort: readiness reports DB trouble.
    await this.recover().catch((e: Error) =>
      this.log.warn(`stale-claim recovery skipped: ${e.message}`),
    );
    if (this.env.WORKER_ENABLED === 'true') {
      this.fillTimer = setInterval(() => this.nudge(), FILL_MS);
      this.fillTimer.unref();
      this.leaseTimer = setInterval(() => void this.maintain(), LEASE_EXTEND_MS);
      this.leaseTimer.unref();
    }
  }

  /** Stop claiming, give running work a moment to finish, then hand back what is still ours. */
  async onModuleDestroy() {
    this.stopping = true;
    if (this.fillTimer) clearInterval(this.fillTimer);
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    const until = Date.now() + SHUTDOWN_WAIT_MS;
    while (this.running > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    if (this.claims.size === 0) return;
    try {
      await this.db.query(
        `UPDATE screening SET state = 'queued', attempts = GREATEST(attempts - 1, 0),
                claim_id = NULL, lease_until = NULL
          WHERE state = 'processing' AND claim_id = ANY($1::text[])`,
        [[...this.claims.values()]],
      );
    } catch (e) {
      this.log.warn(`could not release claims on shutdown: ${(e as Error).message}`);
    }
  }

  /**
   * Work arrived (an upload, a retry) or a slot freed up: start what fits now. Never awaited by the
   * caller, never throws. Without a running worker (WORKER_ENABLED=false) it does nothing.
   */
  nudge() {
    if (this.env.WORKER_ENABLED !== 'true' || this.stopping) return;
    void this.fill().catch((e: Error) => this.log.warn(`fill failed: ${e.message}`));
  }

  /**
   * Keep every free slot busy: while there is room, a model that is not paused, and a queued row,
   * claim one and process it without waiting for it. Fair share: the vacancy with the fewest CVs in
   * flight goes first, then the oldest, so a 100-CV upload cannot starve a small one.
   */
  async fill(): Promise<void> {
    if (this.filling) {
      this.fillAgain = true;
      return;
    }
    this.filling = true;
    try {
      do {
        this.fillAgain = false;
        while (!this.stopping && this.running < this.env.WORKER_CONCURRENCY) {
          if (!(await this.canClaim())) break;
          const claim = await this.claimOne();
          if (!claim) break;
          this.start(claim);
        }
      } while (this.fillAgain && !this.stopping);
    } finally {
      this.filling = false;
    }
  }

  private start(claim: { id: string; claimId: string }) {
    this.running++;
    this.claims.set(claim.id, claim.claimId);
    void this.process(claim.id, claim.claimId).finally(() => {
      this.running--;
      this.claims.delete(claim.id);
      this.nudge();
    });
  }

  /** A provider is active and not paused. Nothing is claimed otherwise: work waits, visibly. */
  private async canClaim(): Promise<boolean> {
    if (!(await this.ai.active())) return false;
    return !(await this.ai.activePaused());
  }

  private async claimOne(): Promise<{ id: string; claimId: string } | null> {
    const claimId = newId();
    const r = await this.db.query<{ id: string }>(
      `WITH inflight AS (
         SELECT d.vacancy_id, count(*) AS n
           FROM screening x JOIN cv_document d ON d.id = x.document_id
          WHERE x.state = 'processing' GROUP BY d.vacancy_id),
       pick AS (
         SELECT s.id FROM screening s
           JOIN cv_document d ON d.id = s.document_id
           LEFT JOIN inflight f ON f.vacancy_id = d.vacancy_id
          WHERE s.state = 'queued' AND s.cancelled_at IS NULL AND s.run_after <= now()
          ORDER BY COALESCE(f.n, 0), s.created_at
          FOR UPDATE OF s SKIP LOCKED LIMIT 1)
       UPDATE screening SET state = 'processing', started_at = now(), attempts = attempts + 1,
              claim_id = $1, lease_until = now() + make_interval(secs => $2)
        WHERE id = (SELECT id FROM pick) RETURNING id`,
      [claimId, LEASE_SECONDS],
    );
    const id = r.rows[0]?.id;
    return id ? { id, claimId } : null;
  }

  /** Every 30 s: extend the leases of what this process is working on, and recover expired ones. */
  private async maintain() {
    try {
      if (this.claims.size) {
        await this.db.query(
          `UPDATE screening SET lease_until = now() + make_interval(secs => $2)
            WHERE state = 'processing' AND claim_id = ANY($1::text[])`,
          [[...this.claims.values()], LEASE_SECONDS],
        );
      }
      if ((await this.recover()) > 0) this.nudge();
    } catch (e) {
      this.log.warn(`lease upkeep failed: ${(e as Error).message}`);
    }
  }

  /**
   * An expired lease goes back to the queue, or to `failed` once it has used its attempts (an
   * expiry counts as one). Rows from before leases existed fall back to the old 10-minute rule.
   */
  async recover(): Promise<number> {
    const r = await this.db.query(
      `UPDATE screening SET
              state = CASE WHEN attempts >= $1 THEN 'failed'::screening_state ELSE 'queued'::screening_state END,
              error = CASE WHEN attempts >= $1 THEN 'The analysis did not finish' ELSE error END,
              run_after = now(), claim_id = NULL, lease_until = NULL
        WHERE state = 'processing'
          AND ((lease_until IS NOT NULL AND lease_until < now())
            OR (lease_until IS NULL AND started_at < now() - interval '10 minutes'))`,
      [MAX_ATTEMPTS],
    );
    return r.rowCount ?? 0;
  }

  /** Public so tests (and a future dedicated worker) can drive it. Returns true if work was done. */
  async tick(): Promise<boolean> {
    if (this.running >= this.env.WORKER_CONCURRENCY) return false;
    if (!(await this.canClaim())) return false;
    const claim = await this.claimOne();
    if (!claim) return false;
    this.running++;
    this.claims.set(claim.id, claim.claimId);
    try {
      await this.process(claim.id, claim.claimId);
    } finally {
      this.running--;
      this.claims.delete(claim.id);
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

  async process(screeningId: string, claimId: string): Promise<void> {
    try {
      await this.run(screeningId, claimId);
    } catch (e) {
      if (e instanceof LostClaim) {
        // Erased, stopped or taken back while it was being read: nothing is written.
        this.log.log(`screening ${screeningId} is no longer ours; result dropped`);
        return;
      }
      const msg = (e instanceof Error ? e.message : 'unknown error').slice(0, 300);
      this.log.warn(`screening ${screeningId} failed: ${msg}`);
      // The provider was paused by the breaker: put it back untouched, without using an attempt.
      const paused = e instanceof ProviderError && e.status === 503 && msg.includes(PAUSED_TEXT);
      await this.db.query(
        `UPDATE screening SET
            attempts = CASE WHEN $4::boolean THEN GREATEST(attempts - 1, 0) ELSE attempts END,
            state = CASE WHEN NOT $4::boolean AND attempts >= $2 THEN 'failed'::screening_state ELSE 'queued'::screening_state END,
            run_after = now() + CASE WHEN $4::boolean THEN interval '60 seconds' ELSE attempts * interval '30 seconds' END,
            error = $3, claim_id = NULL, lease_until = NULL
          WHERE id = $1 AND claim_id = $5 AND state = 'processing'`,
        [screeningId, MAX_ATTEMPTS, msg, paused, claimId],
      );
    }
  }

  private async run(screeningId: string, claimId: string) {
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
      await this.db.query(
        `UPDATE screening SET state = 'manual', claim_id = NULL, lease_until = NULL
          WHERE id = $1 AND claim_id = $2 AND state = 'processing'`,
        [screeningId, claimId],
      );
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
      // The guarded write comes first: if the screening is no longer ours (the CV was erased while
      // it was being read, or the lease was taken back), nothing at all is written.
      const done = await tx.query(
        `UPDATE screening SET state = 'completed', completed_at = now(), error = NULL,
                candidate_name = $2, candidate_email = $3, summary = $4,
                knockout = $5, knockout_triggered = $6, injection_suspected = $7,
                score = $8, breakdown = $9, band = $10, ai_provider = $11, ai_model = $12,
                lease_until = NULL
          WHERE id = $1 AND claim_id = $13 AND state = 'processing'`,
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
          claimId,
        ],
      );
      if (!done.rowCount) throw new LostClaim();
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
