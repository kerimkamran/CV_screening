import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { ENV, type Env } from '../config/env';
import { DbService, type Queryable } from '../db/db.service';
import { ClaimLostError, IntakeService, type IntakeResult } from '../pipeline/intake.service';
import { memoryShare } from '../pipeline/rendition.service';
import { ImportKeys } from './import-keys';
import {
  addStats,
  createBatchForRun,
  finishRun,
  readRun,
  stalled,
  type RunRow,
  type RunStats,
} from './import-runs';
import type { ImportSource, SourceApplication, SourceRun } from './import-source';
import { SourceError } from './import-source';
import { fileNameFromBytes } from './oracle/oracle-names';
import { ActorRevokedError, PrincipalLoader } from './principal-loader';

/** Code defaults (plan 15.1: none of these is a setting). */
export const RUNNER = {
  leaseMs: 120_000,
  heartbeatMs: 30_000,
  /** The lease is renewed only while progress is younger than this. */
  stallMs: 5 * 60_000,
  /** A park for one reason, or a pause waiting for the recruiter, ends after this. */
  waitLimitMs: 2 * 3_600_000,
  maxAttempts: 5,
  /** Files fetched at once. */
  concurrency: 2,
  /** An item counted this many times without finishing ends `rejected/crash_limit`. */
  crashStrikes: 2,
  /** No download starts above this share of memory (gate G-11 fixes the value). */
  memoryCeiling: 0.75,
  /** Shutdown waits at most this long for calls in flight. */
  shutdownMs: 20_000,
  /** A park for an outage tries again after this. */
  retryMs: 60_000,
  /** Internal applicants: OPEN, the owner decides (plan section 12). One code default. */
  includeInternal: true,
  /** End of listing: refused when db size + projection x margin passes this share of the plan. */
  storageShare: 0.7,
  storageMargin: 1.15,
};

const ITEM_TOO_LARGE = 'Over 10 MB';

/** The next midnight in Asia/Baku (UTC+4, no daylight saving): when a spent daily budget resets. */
export function nextBakuMidnight(now = new Date()): Date {
  const baku = new Date(now.getTime() + 4 * 3_600_000);
  baku.setUTCHours(24, 0, 0, 0);
  return new Date(baku.getTime() - 4 * 3_600_000);
}

class StepStop extends Error {}

/**
 * Stage 3, S3-INT-03, S3-INT-11, S3-INT-12 (plan 5.3, 5.5, 15.3): the import runner. It runs inside
 * the API process. A run is claimed with SKIP LOCKED and a 120 s lease that is renewed only while
 * the run makes progress; a lapsed lease sends the run back to the queue (5 lapses: failed). Listing
 * reads one page per transaction and moves the cursor in that transaction, so a restart never
 * duplicates an item. Fetching takes two files at a time, re-loads the clicking user and runs the
 * upload gate for every file, and stores each through `IntakeService.admit`.
 *
 * Tests call `drainRuns()`; with the worker on, a timer calls `tick()`.
 */
@Injectable()
export class ImportRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('ImportRunner');
  /** The source of applications and files: the Oracle client in Phase 3, a fake in tests. */
  source: ImportSource | null = null;
  /** Memory in use as a share (replaced by specs). */
  memory: () => number = () => memoryShare();
  readonly keys: ImportKeys;
  private timer: NodeJS.Timeout | null = null;
  private current: {
    claim: string;
    runId: string;
    abort: AbortController;
    done: Promise<void>;
  } | null = null;
  private stopping = false;
  /** Erases one CV with cause `source_removed` (set by the module; needs the report service). */
  eraser: ((tx: Queryable, documentId: string, actorId: string) => Promise<void>) | null = null;

  constructor(
    private readonly db: DbService,
    private readonly intake: IntakeService,
    private readonly audit: AuditService,
    private readonly principals: PrincipalLoader,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.keys = ImportKeys.from(env.IMPORT_TOMBSTONE_KEY);
  }

  get enabled() {
    return this.env.ORACLE_IMPORT_ENABLED === 'true';
  }

  async onApplicationBootstrap() {
    // Recovery runs whatever the worker setting, and with the switch off it cancels active runs.
    await this.recover().catch((e) => this.log.warn(`recover failed: ${(e as Error).message}`));
    if (this.env.WORKER_ENABLED === 'true' && this.enabled) {
      this.timer = setInterval(() => {
        if (!this.current && !this.stopping)
          void this.tick().catch((e) => this.log.warn(`tick failed: ${(e as Error).message}`));
      }, 2_000);
      this.timer.unref();
    }
  }

  /** Shutdown: abort calls in flight, wait at most 20 s, hand the claim back so it is claimable at once. */
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    const cur = this.current;
    if (!cur) return;
    cur.abort.abort();
    await Promise.race([cur.done.catch(() => undefined), sleep(RUNNER.shutdownMs)]);
    await this.db
      .query(
        `UPDATE import_run SET state = 'queued', claim_id = NULL, lease_until = NULL
          WHERE id = $1 AND claim_id = $2 AND state = 'running'`,
        [cur.runId, cur.claim],
      )
      .catch(() => undefined);
  }

  // ------------------------------------------------------------------ recovery and the queue

  /**
   * Start-up and every tick: lapsed leases go back to the queue (`attempts + 1`; at 5: failed
   * `did_not_finish`); a pause unanswered for 2 hours is cancelled `not_confirmed`; a park for one
   * reason longer than 2 hours fails with that reason (the daily budget excepted). With the switch
   * off every active run is cancelled `switched_off`, with one audit row each.
   */
  async recover(): Promise<void> {
    if (!this.enabled) {
      const active = await this.db.query<{ id: string; started_by: string; vacancy_id: string }>(
        `SELECT id, started_by, vacancy_id FROM import_run WHERE state IN ('queued','running','awaiting_confirm')`,
      );
      for (const r of active.rows)
        await this.db.withTx(async (tx) => {
          if (await finishRun(tx, r.id, 'cancelled', 'switched_off'))
            await this.auditRun(tx, r.started_by, r.id, 'import_run.switched_off', {
              vacancyId: r.vacancy_id,
            });
        });
      return;
    }
    await this.db.query(
      `UPDATE import_run SET state = 'queued', claim_id = NULL, lease_until = NULL, attempts = attempts + 1
        WHERE state = 'running' AND lease_until < now()`,
    );
    const ends = await this.db.query<{ id: string; why: string }>(
      `SELECT id, 'did_not_finish' AS why FROM import_run WHERE state = 'queued' AND attempts >= $1
       UNION ALL
       SELECT id, 'not_confirmed' FROM import_run
        WHERE state = 'awaiting_confirm' AND awaiting_since < now() - make_interval(secs => $2)
       UNION ALL
       SELECT id, wait_reason FROM import_run
        WHERE state = 'queued' AND wait_reason IS NOT NULL AND wait_reason <> 'oracle_budget'
          AND waited_since < now() - make_interval(secs => $2)`,
      [RUNNER.maxAttempts, RUNNER.waitLimitMs / 1000],
    );
    for (const e of ends.rows)
      await this.db.withTx((tx) =>
        finishRun(tx, e.id, e.why === 'not_confirmed' ? 'cancelled' : 'failed', e.why),
      );
  }

  private stallLogged = new Map<string, number>();
  /** One `import.stalled` line per stalled run every 5 minutes: run ID, state, phase, reason, minutes. */
  async logStalled(): Promise<void> {
    const rows = await this.db.query<{
      id: string;
      state: string;
      phase: string;
      wait_reason: string | null;
      progress_at: Date | null;
      waited_since: Date | null;
      awaiting_since: Date | null;
    }>(
      `SELECT id, state, phase, wait_reason, progress_at, waited_since, awaiting_since FROM import_run
        WHERE state IN ('queued','running','awaiting_confirm')`,
    );
    const now = Date.now();
    for (const r of rows.rows) {
      const m = stalled({
        state: r.state,
        progressAt: r.progress_at,
        waitReason: r.wait_reason,
        waitedSince: r.waited_since,
        awaitingSince: r.awaiting_since,
      });
      if (m === null || now - (this.stallLogged.get(r.id) ?? 0) < 5 * 60_000) continue;
      this.stallLogged.set(r.id, now);
      this.log.warn(
        `import.stalled run=${r.id} state=${r.state} phase=${r.phase} reason=${r.wait_reason ?? '-'} minutes=${m}`,
      );
    }
  }

  /** Claim one queued run and work on it until it ends, parks or pauses. False when none was waiting. */
  async tick(): Promise<boolean> {
    if (!this.enabled || this.stopping) return false;
    await this.recover();
    await this.logStalled().catch(() => undefined);
    const claim = newId();
    const got = await this.db.query<RunRow>(
      `UPDATE import_run SET state = 'running', claim_id = $1,
              lease_until = now() + make_interval(secs => $2), progress_at = now(), run_after = NULL
        WHERE id = (SELECT id FROM import_run
                     WHERE state = 'queued' AND (run_after IS NULL OR run_after <= now())
                     ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`,
      [claim, RUNNER.leaseMs / 1000],
    );
    const run = got.rows[0];
    if (!run) return false;
    const abort = new AbortController();
    const done = this.work(run, claim, abort.signal);
    this.current = { claim, runId: run.id, abort, done };
    try {
      await done;
    } finally {
      this.current = null;
    }
    return true;
  }

  /** For specs: claim and work runs until none is waiting. */
  async drainRuns(max = 50): Promise<number> {
    let n = 0;
    while (n < max && (await this.tick())) n++;
    return n;
  }

  private async work(run: RunRow, claim: string, signal: AbortSignal): Promise<void> {
    const beat = setInterval(() => {
      void this.db
        .query(
          `UPDATE import_run SET lease_until = now() + make_interval(secs => $3)
            WHERE id = $1 AND claim_id = $2 AND progress_at > now() - make_interval(secs => $4)`,
          [run.id, claim, RUNNER.leaseMs / 1000, RUNNER.stallMs / 1000],
        )
        .catch(() => undefined);
    }, RUNNER.heartbeatMs);
    beat.unref();
    try {
      if (run.cancel_requested_at) {
        await this.end(run.id, claim, 'cancelled', run.error_code);
        return;
      }
      const source = this.source;
      if (!source) {
        await this.park(run.id, claim, 'oracle_unavailable', RUNNER.retryMs);
        return;
      }
      const sctx: SourceRun = {
        runId: run.id,
        vacancyId: run.vacancy_id,
        externalRef: run.external_ref ?? '',
        externalId: run.external_id ?? '',
        signal,
      };
      if (run.phase === 'listing') {
        const next = await this.list(run, claim, source, sctx);
        if (next !== 'fetch') return;
      }
      await this.fetch(run.id, claim, source, sctx, signal);
    } catch (e) {
      if (e instanceof StepStop || e instanceof ClaimLostError) return;
      if (signal.aborted) return; // shutdown: the claim is handed back by onModuleDestroy
      await this.onSourceError(run.id, claim, e);
    } finally {
      clearInterval(beat);
    }
  }

  /** What a source failure does to the whole run (plan 5.5). */
  private async onSourceError(runId: string, claim: string, e: unknown) {
    if (e instanceof SourceError) {
      switch (e.code) {
        case 'unavailable':
          return this.park(
            runId,
            claim,
            'oracle_unavailable',
            Math.max((e.retryAfter ?? 0) * 1000, RUNNER.retryMs),
          );
        case 'budget':
          return this.park(
            runId,
            claim,
            'oracle_budget',
            nextBakuMidnight().getTime() - Date.now(),
          );
        case 'auth':
          return this.end(runId, claim, 'failed', 'sign_in');
        case 'schema_changed':
          return this.end(runId, claim, 'failed', 'schema_changed');
        case 'vacancy_gone':
          return this.end(runId, claim, 'failed', 'vacancy_gone');
        default:
          break;
      }
    }
    this.log.warn(`run ${runId}: ${(e as Error).name}`);
    return this.park(runId, claim, 'oracle_unavailable', RUNNER.retryMs);
  }

  // ------------------------------------------------------------------ run state helpers

  private async end(
    runId: string,
    claim: string,
    state: 'completed' | 'failed' | 'cancelled',
    code: string | null,
  ) {
    await this.db.withTx(async (tx) => {
      const run = await readRun(tx, runId, true);
      if (!run || run.claim_id !== claim) return;
      if (await finishRun(tx, runId, state, code, { claimId: claim }))
        await this.auditRun(tx, run.started_by, runId, `import_run.${state}`, {
          vacancyId: run.vacancy_id,
          ...(code ? { code } : {}),
          stats: run.stats,
        });
    });
  }

  /** Park: back to the queue after a delay, no attempt spent; 2 hours for one reason ends the run. */
  async park(runId: string, claim: string, reason: string, delayMs: number) {
    await this.db.query(
      `UPDATE import_run
          SET state = 'queued', claim_id = NULL, lease_until = NULL,
              run_after = now() + make_interval(secs => $4),
              waited_since = CASE WHEN wait_reason = $3 AND waited_since IS NOT NULL THEN waited_since ELSE now() END,
              wait_reason = $3
        WHERE id = $1 AND claim_id = $2 AND state = 'running'`,
      [runId, claim, reason, Math.max(1, Math.round(delayMs / 1000))],
    );
  }

  private async progress(
    q: Queryable,
    runId: string,
    claim: string,
    sets = '',
    params: unknown[] = [],
  ) {
    const r = await q.query(
      `UPDATE import_run SET progress_at = now(), wait_reason = NULL, waited_since = NULL${sets}
        WHERE id = $1 AND claim_id = $2 AND state = 'running'`,
      [runId, claim, ...params],
    );
    if (!r.rowCount) throw new ClaimLostError();
  }

  private auditRun(q: Queryable, actorId: string, runId: string, action: string, after: object) {
    return this.audit.record(q, {
      actorId,
      actorType: 'service',
      action,
      entityType: 'import_run',
      entityId: runId,
      after,
    });
  }

  // ------------------------------------------------------------------ listing (S3-INT-11)

  private async noticeFrom(): Promise<Date | null> {
    const r = await this.db.query<{ d: string | null }>(
      `SELECT notice_effective_from::text AS d FROM integration_connection WHERE system = 'oracle_hcm'`,
    );
    return r.rows[0]?.d ? new Date(`${r.rows[0].d}T00:00:00Z`) : null;
  }

  /** Reads pages until the last one; then pauses, fails, completes, or creates the batch and fetches. */
  private async list(run0: RunRow, claim: string, source: ImportSource, sctx: SourceRun) {
    const notice = await this.noticeFrom();
    let cursor = run0.list_cursor;
    for (;;) {
      const page = await source.listPage(sctx, cursor);
      await this.db.withTx(async (tx) => {
        const run = await readRun(tx, run0.id, true);
        if (!run || run.claim_id !== claim || run.state !== 'running') throw new ClaimLostError();
        if (run.cancel_requested_at) throw new StepStop();
        let listed = run.listed;
        let projected = 0;
        const add: RunStats = { pages: 1 };
        const inc = (k: keyof RunStats) => (add[k] = (add[k] ?? 0) + 1);
        for (const app of page.applications) {
          inc('seen');
          const out = await this.classify(tx, run, app, notice, listed + 1);
          inc(out.kind);
          if (out.kind === 'listed') {
            listed++;
            projected += out.size;
          }
        }
        await this.progress(
          tx,
          run.id,
          claim,
          `, list_cursor = $3, listed = $4, stats = $5::jsonb, projected_bytes = projected_bytes + $6`,
          [page.cursor, listed, JSON.stringify(addStats(run.stats, add)), projected],
        );
      });
      cursor = page.cursor;
      if (page.done) break;
    }
    return this.endOfListing(run0.id, claim);
  }

  /** One application: counted and left out, or one import item. Raw IDs are stored only on the item. */
  private async classify(
    tx: Queryable,
    run: RunRow,
    app: SourceApplication,
    notice: Date | null,
    seq: number,
  ): Promise<{ kind: keyof RunStats; size: number }> {
    const system = 'oracle_hcm';
    if (app.eligibility !== 'active' || (app.internal && !RUNNER.includeInternal))
      return { kind: 'filtered', size: 0 };
    const ids = {
      applicationId: app.applicationId,
      personId: app.personId,
      requisitionId: run.external_id ?? '',
    };
    const appHashes = this.keys.applicationCandidates(system, app.applicationId);
    const allHashes = this.keys.candidates(system, ids);
    // The application came back and is active: earlier items of it are not gone (design note 11).
    await tx.query(
      `UPDATE import_item SET seen_in_run_id = $3 WHERE vacancy_id = $1 AND app_key_hash = ANY($2::text[]) AND run_id <> $3`,
      [run.vacancy_id, appHashes, run.id],
    );
    if (notice && app.appliedAt && app.appliedAt < notice) return { kind: 'preNotice', size: 0 };
    const att = app.attachments[0];
    if (!att) return { kind: 'noFile', size: 0 };
    // Erased or purged earlier: withheld, never stored again (tombstones, then the item fallback).
    const tomb = await tx.query(
      `SELECT 1 FROM import_tombstone WHERE system = $1 AND key_hash = ANY($2::text[]) LIMIT 1`,
      [system, allHashes],
    );
    if (tomb.rowCount) return { kind: 'withheld', size: 0 };
    const erased = await tx.query(
      `SELECT 1 FROM import_item i JOIN cv_document d ON d.id = i.document_id
        WHERE i.vacancy_id = $1 AND d.erased_at IS NOT NULL
          AND (i.app_key_hash = ANY($2::text[]) OR i.person_key_hash = ANY($2::text[])) LIMIT 1`,
      [run.vacancy_id, allHashes],
    );
    if (erased.rowCount) return { kind: 'withheld', size: 0 };
    // Already here: the same attachment has a live document, or ended duplicate or rejected.
    const attHashes = this.keys.attachmentCandidates(system, att.attachmentId);
    const already = await tx.query(
      `SELECT 1 FROM import_item i
         LEFT JOIN cv_document d ON d.id = i.document_id
         LEFT JOIN upload_item u ON u.id = i.upload_item_id
        WHERE i.vacancy_id = $1 AND i.att_key_hash = ANY($2::text[])
          AND ((d.id IS NOT NULL AND d.erased_at IS NULL) OR u.outcome IN ('duplicate','rejected'))
        LIMIT 1`,
      [run.vacancy_id, attHashes],
    );
    if (already.rowCount) return { kind: 'already', size: 0 };
    // A newer CV on an imported application replaces nothing: the new item points at the older one.
    const older = await tx.query<{ document_id: string }>(
      `SELECT i.document_id FROM import_item i JOIN cv_document d ON d.id = i.document_id
        WHERE i.vacancy_id = $1 AND i.app_key_hash = ANY($2::text[]) AND d.erased_at IS NULL
        ORDER BY d.uploaded_at DESC LIMIT 1`,
      [run.vacancy_id, appHashes],
    );
    const h = this.keys.forItem(system, { ...ids, attachmentId: att.attachmentId });
    const ins = await tx.query(
      `INSERT INTO import_item (id, run_id, vacancy_id, system, seq, external_application_id, external_attachment_id,
              app_key_hash, att_key_hash, person_key_hash, key_version, external_applied_at, size_bytes,
              supersedes_document_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (run_id, app_key_hash) DO NOTHING`,
      [
        newId(),
        run.id,
        run.vacancy_id,
        system,
        seq,
        app.applicationId,
        att.attachmentId,
        h.app,
        h.att,
        h.person,
        h.keyVersion,
        app.appliedAt,
        att.size,
        older.rows[0]?.document_id ?? null,
      ],
    );
    if (!ins.rowCount) return { kind: 'already', size: 0 };
    return { kind: 'listed', size: Math.max(0, att.size ?? 0) };
  }

  /** The last page was read: reconcile, then complete, fail on storage, pause, or create the batch. */
  private async endOfListing(runId: string, claim: string): Promise<'fetch' | 'stop'> {
    return this.db.withTx(async (tx) => {
      const run = await readRun(tx, runId, true);
      if (!run || run.claim_id !== claim) throw new ClaimLostError();
      // Reconciliation: only when Oracle returned applications (lost access looks like "all gone").
      if ((run.stats.seen ?? 0) > 0) {
        const gone = await tx.query(
          `UPDATE import_item i SET source_gone_at = now()
             FROM cv_document d
            WHERE d.id = i.document_id AND d.erased_at IS NULL AND i.vacancy_id = $1 AND i.run_id <> $2
              AND i.source_gone_at IS NULL AND i.seen_in_run_id IS DISTINCT FROM $2`,
          [run.vacancy_id, run.id],
        );
        await tx.query(
          `UPDATE import_item SET source_gone_at = NULL WHERE vacancy_id = $1 AND seen_in_run_id = $2 AND source_gone_at IS NOT NULL`,
          [run.vacancy_id, run.id],
        );
        // goneInSource 'erase' (off unless the DPO asks): flagged CVs are erased, cause source_removed.
        const conn = await tx.query<{ gone: string | null }>(
          `SELECT settings->>'goneInSource' AS gone FROM integration_connection WHERE system = 'oracle_hcm'`,
        );
        if (gone.rowCount && conn.rows[0]?.gone === 'erase' && this.eraser) {
          const flagged = await tx.query<{ document_id: string }>(
            `SELECT DISTINCT i.document_id FROM import_item i JOIN cv_document d ON d.id = i.document_id
              WHERE i.vacancy_id = $1 AND i.source_gone_at IS NOT NULL AND d.erased_at IS NULL`,
            [run.vacancy_id],
          );
          for (const f of flagged.rows) await this.eraser(tx, f.document_id, run.started_by);
        }
        if (gone.rowCount)
          await tx.query(
            `UPDATE import_run SET stats = stats || jsonb_build_object('gone', $2::int) WHERE id = $1`,
            [run.id, gone.rowCount],
          );
      }
      if (run.listed === 0) {
        await finishRun(tx, run.id, 'completed', null, { claimId: claim });
        await this.auditRun(tx, run.started_by, run.id, 'import_run.completed', {
          vacancyId: run.vacancy_id,
          stats: run.stats,
        });
        return 'stop' as const;
      }
      // Storage projection: database size + projection x 1.15 must stay under 70 % of the plan.
      const size = Number(
        (await tx.query<{ n: string }>(`SELECT pg_database_size(current_database()) AS n`)).rows[0]!
          .n,
      );
      const limit = this.env.DB_SIZE_LIMIT_MB * 1024 * 1024 * RUNNER.storageShare;
      if (size + Number(run.projected_bytes) * RUNNER.storageMargin > limit) {
        await finishRun(tx, run.id, 'failed', 'storage_low', { claimId: claim });
        await this.auditRun(tx, run.started_by, run.id, 'import_run.failed', {
          vacancyId: run.vacancy_id,
          code: 'storage_low',
          listed: run.listed,
        });
        return 'stop' as const;
      }
      const live = Number(
        (
          await tx.query<{ n: string }>(
            `SELECT count(*) AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL`,
            [run.vacancy_id],
          )
        ).rows[0]!.n,
      );
      const room = Math.max(0, this.intake.maxCvs - live);
      const aboveEstimate = run.estimate !== null && run.listed > run.estimate;
      const aboveRoom = run.listed > room;
      if ((aboveEstimate || aboveRoom) && !run.confirmed_at) {
        const reason =
          aboveEstimate && aboveRoom
            ? 'above_estimate_and_room'
            : aboveEstimate
              ? 'above_estimate'
              : 'above_room';
        await tx.query(
          `UPDATE import_run SET state = 'awaiting_confirm', confirm_reason = $2, awaiting_since = now(),
                  claim_id = NULL, lease_until = NULL
            WHERE id = $1`,
          [run.id, reason],
        );
        await this.auditRun(tx, run.started_by, run.id, 'import_run.paused', {
          vacancyId: run.vacancy_id,
          estimate: run.estimate,
          listed: run.listed,
          room,
          reason,
        });
        return 'stop' as const;
      }
      await createBatchForRun(tx, run);
      await this.progress(tx, run.id, claim, `, phase = 'fetching'`);
      // Before the first download: the estimate, the exact count and who confirmed.
      await this.auditRun(tx, run.started_by, run.id, 'import_run.listed', {
        vacancyId: run.vacancy_id,
        estimate: run.estimate,
        listed: run.listed,
        confirmedBy: run.confirmed_by ?? run.started_by,
      });
      return 'fetch' as const;
    });
  }

  // ------------------------------------------------------------------ fetching (S3-INT-12)

  private async fetch(
    runId: string,
    claim: string,
    source: ImportSource,
    sctx: SourceRun,
    signal: AbortSignal,
  ) {
    const open = await this.db.query<{
      id: string;
      upload_item_id: string;
      external_application_id: string | null;
      external_attachment_id: string | null;
      attempts: number;
      seq: number;
    }>(
      `SELECT i.id, i.upload_item_id, i.external_application_id, i.external_attachment_id, i.attempts, i.seq
         FROM import_item i JOIN upload_item u ON u.id = i.upload_item_id
        WHERE i.run_id = $1 AND u.outcome IS NULL ORDER BY i.seq`,
      [runId],
    );
    const queue = [...open.rows];
    const who = (run: RunRow) => ({
      vacancyId: run.vacancy_id,
      userId: run.confirmed_by ?? run.started_by,
    });
    let halt: null | 'stop' | 'full' = null;
    const stopAll = (why: 'stop' | 'full') => {
      if (!halt) halt = why;
    };
    const failRun = async (code: string) => {
      stopAll('stop');
      await this.end(runId, claim, 'failed', code);
    };
    const worker = async () => {
      while (!halt && !signal.aborted) {
        const item = queue.shift();
        if (!item) return;
        // Before each download: the run, the person, the gate, memory, storage.
        const run = await readRun(this.db, runId);
        if (!run || run.claim_id !== claim || run.state !== 'running') return stopAll('stop');
        if (run.cancel_requested_at) {
          stopAll('stop');
          return this.end(runId, claim, 'cancelled', run.error_code);
        }
        let principal: Principal;
        let setId: string;
        try {
          principal = await this.principals.byUserId(run.confirmed_by ?? run.started_by);
          setId = await this.intake.gate(principal, run.vacancy_id);
        } catch (e) {
          if (e instanceof ActorRevokedError || e instanceof HttpException) {
            const archived = e instanceof HttpException && /Restore this vacancy/.test(e.message);
            return failRun(archived ? 'archived' : 'actor_revoked');
          }
          throw e;
        }
        if (this.memory() >= RUNNER.memoryCeiling) {
          stopAll('stop');
          return this.park(runId, claim, 'capacity_unavailable', RUNNER.retryMs);
        }
        const projected = Number(run.projected_bytes);
        if (projected > 0 && Number(run.fetched_bytes) > projected * RUNNER.storageMargin) {
          stopAll('stop');
          return this.park(runId, claim, 'storage_low', RUNNER.retryMs);
        }
        // The strike is counted before the download: two deaths on one file end it as crash_limit.
        const strikes = (
          await this.db.query<{ attempts: number }>(
            `UPDATE import_item SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
            [item.id],
          )
        ).rows[0]!.attempts;
        if (strikes > RUNNER.crashStrikes) {
          await this.settle(
            item,
            {
              status: 'rejected',
              code: 'crash_limit',
              message: 'Failed twice, so it was left out',
            },
            who(run),
          );
          continue;
        }
        if (!item.external_application_id || !item.external_attachment_id) {
          await this.settle(
            item,
            { status: 'skipped', code: 'source_unavailable', message: 'Oracle did not answer' },
            who(run),
          );
          continue;
        }
        const ref = {
          applicationId: item.external_application_id,
          attachmentId: item.external_attachment_id,
        };
        let file;
        try {
          try {
            file = await source.download(sctx, ref);
          } catch (e) {
            if (!(e instanceof SourceError && e.code === 'link_forbidden')) throw e;
            file = await source.download(sctx, ref); // the link is read again once
          }
        } catch (e) {
          if (signal.aborted) {
            await this.unstrike(item.id);
            return;
          }
          if (e instanceof SourceError) {
            if (e.code === 'too_large') {
              await this.settle(
                item,
                { status: 'rejected', code: 'too_large', message: ITEM_TOO_LARGE },
                who(run),
              );
              continue;
            }
            if (e.code === 'link_forbidden') {
              await this.settle(
                item,
                { status: 'skipped', code: 'source_unavailable', message: 'Oracle did not answer' },
                who(run),
              );
              continue;
            }
            // Outage, budget, sign-in, schema: the attempt is returned and the whole run reacts.
            await this.unstrike(item.id);
            stopAll('stop');
            return this.onSourceError(runId, claim, e);
          }
          throw e;
        }
        let result: IntakeResult;
        try {
          result = await this.intake.admit(
            {
              principal,
              vacancyId: run.vacancy_id,
              setId,
              ip: run.started_ip ?? '',
              itemId: item.upload_item_id,
              batchId: run.batch_id ?? undefined,
              label: `Oracle application ${item.seq}`,
              via: 'oracle_hcm',
              runId,
              claimId: claim,
            },
            fileNameFromBytes(file.bytes, file.fileName),
            file.bytes,
          );
        } catch (e) {
          if (e instanceof ClaimLostError) return stopAll('stop');
          throw e;
        }
        await this.db.withTx(async (tx) => {
          const kept = result.status === 'queued' || result.status === 'unreadable';
          // The run row first, then the item: the same lock order as ending a run (`end` locks the
          // run, then its items), so a file settling while another worker ends the run cannot deadlock.
          await this.progress(
            tx,
            runId,
            claim,
            `, fetched_bytes = fetched_bytes + $3, stats = jsonb_set(stats, '{fetched}', to_jsonb(COALESCE((stats->>'fetched')::int, 0) + 1))`,
            [file.bytes.length],
          );
          await tx.query(
            `UPDATE import_item SET size_bytes = $2, document_id = COALESCE($3, document_id) WHERE id = $1`,
            [item.id, file.bytes.length, kept ? (result.documentId ?? null) : null],
          );
        });
        if (result.code === 'vacancy_full') stopAll('full');
        if (result.code === 'cancelled') stopAll('stop');
      }
    };
    try {
      await Promise.all(Array.from({ length: RUNNER.concurrency }, () => worker()));
    } catch (e) {
      if (e instanceof ClaimLostError) return;
      throw e;
    }
    if (signal.aborted) return;
    if (halt === 'full') {
      // At most room + 2 files were downloaded; the rest are closed without a download.
      const run = await readRun(this.db, runId);
      if (!run) return;
      const rest = await this.db.query<{ upload_item_id: string; seq: number }>(
        `SELECT i.upload_item_id, i.seq FROM import_item i JOIN upload_item u ON u.id = i.upload_item_id
          WHERE i.run_id = $1 AND u.outcome IS NULL`,
        [runId],
      );
      for (const r of rest.rows)
        await this.settle(
          { upload_item_id: r.upload_item_id, seq: r.seq },
          {
            status: 'skipped',
            code: 'vacancy_full',
            message: `This vacancy holds at most ${this.intake.maxCvs} CVs`,
          },
          who(run),
        );
    } else if (halt === 'stop') {
      // A cancel seen inside admit stops the workers without ending the run: end it here.
      const after = await readRun(this.db, runId);
      if (after?.state === 'running' && after.claim_id === claim && after.cancel_requested_at)
        await this.end(runId, claim, 'cancelled', after.error_code);
      return;
    }
    const after = await readRun(this.db, runId);
    if (after?.cancel_requested_at) return this.end(runId, claim, 'cancelled', after.error_code);
    await this.end(runId, claim, 'completed', null);
  }

  /** Close one item without a stored CV, and keep it on the skip list under its neutral label. */
  private async settle(
    item: { upload_item_id: string; seq: number },
    r: { status: IntakeResult['status']; code: string; message: string },
    who: { vacancyId: string; userId: string },
  ) {
    const label = `Oracle application ${item.seq}`;
    const out: IntakeResult = { filename: label, itemId: item.upload_item_id, ...r };
    const fin = await this.intake.finishItem(item.upload_item_id, out);
    if (fin.wrote)
      await this.intake.skipRecord(
        {
          vacancyId: who.vacancyId,
          principal: { userId: who.userId } as Principal,
          itemId: item.upload_item_id,
          label,
        },
        out,
      );
  }

  private async unstrike(itemId: string) {
    await this.db
      .query(`UPDATE import_item SET attempts = GREATEST(0, attempts - 1) WHERE id = $1`, [itemId])
      .catch(() => undefined);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());
