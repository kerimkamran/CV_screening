import { newId, RETRYABLE_CODES } from '@cv/shared';
import type { Queryable } from '../db/db.service';

/**
 * Stage 3, S3-INT-03 (plan 15.3 note 12): plain functions on a Queryable that change an import run.
 * The runner, the cancel route, Stop, archive, Abandon, Turn off, the 2-hour limits and the
 * switch-off sweep all end a run through `finishRun`, so a run ends the same way whoever ends it.
 * Pipeline files import these functions only, so there is no module cycle.
 */
export const ACTIVE_RUN_STATES = ['queued', 'running', 'awaiting_confirm'] as const;
export type RunState =
  'queued' | 'running' | 'awaiting_confirm' | 'completed' | 'failed' | 'cancelled';
export type RunPhase = 'listing' | 'fetching';
export type EndState = 'completed' | 'failed' | 'cancelled';

export interface RunRow {
  id: string;
  vacancy_id: string;
  batch_id: string | null;
  mode: 'import' | 'refresh';
  state: RunState;
  phase: RunPhase;
  external_ref: string | null;
  external_id: string | null;
  list_cursor: string | null;
  listed: number;
  estimate: number | null;
  confirm_reason: string | null;
  projected_bytes: string;
  fetched_bytes: string;
  attempts: number;
  run_after: Date | null;
  wait_reason: string | null;
  waited_since: Date | null;
  claim_id: string | null;
  lease_until: Date | null;
  progress_at: Date | null;
  error_code: string | null;
  stats: RunStats;
  started_by: string;
  started_ip: string | null;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  awaiting_since: Date | null;
  cancel_requested_at: Date | null;
  cancel_requested_by: string | null;
  created_at: Date;
  finished_at: Date | null;
}

/** Counts only: never an ID, a name or a file name (plan 6, over-collection). */
export interface RunStats {
  seen?: number;
  filtered?: number;
  preNotice?: number;
  noFile?: number;
  withheld?: number;
  already?: number;
  listed?: number;
  fetched?: number;
  gone?: number;
  pages?: number;
}

export async function readRun(q: Queryable, runId: string, lock = false): Promise<RunRow | null> {
  return (
    (
      await q.query<RunRow>(`SELECT * FROM import_run WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [
        runId,
      ])
    ).rows[0] ?? null
  );
}

export async function activeRun(q: Queryable, vacancyId: string): Promise<RunRow | null> {
  return (
    (
      await q.query<RunRow>(
        `SELECT * FROM import_run WHERE vacancy_id = $1 AND state = ANY($2::text[])`,
        [vacancyId, ACTIVE_RUN_STATES],
      )
    ).rows[0] ?? null
  );
}

/**
 * End a run in the caller's transaction. Open items are settled (`skipped/cancelled` on cancel,
 * `skipped/source_unavailable` on failure), every raw Oracle ID of the run and the cursor are set to
 * NULL, and retryable items of older Oracle batches of the vacancy are closed as `superseded`.
 * Returns false when the run had already ended (nothing changes then).
 */
export async function finishRun(
  q: Queryable,
  runId: string,
  state: EndState,
  errorCode: string | null = null,
  opts: { claimId?: string } = {},
): Promise<boolean> {
  const r = await q.query<{ vacancy_id: string; batch_id: string | null }>(
    `UPDATE import_run
        SET state = $2, error_code = $3, finished_at = now(), list_cursor = NULL,
            claim_id = NULL, lease_until = NULL, run_after = NULL,
            wait_reason = NULL, waited_since = NULL
      WHERE id = $1 AND state = ANY($4::text[])
        ${opts.claimId ? 'AND claim_id = $5' : ''}
      RETURNING vacancy_id, batch_id`,
    opts.claimId
      ? [runId, state, errorCode, ACTIVE_RUN_STATES, opts.claimId]
      : [runId, state, errorCode, ACTIVE_RUN_STATES],
  );
  const row = r.rows[0];
  if (!row) return false;
  if (row.batch_id && state !== 'completed') {
    const [code, message] =
      state === 'cancelled'
        ? ['cancelled', 'Cancelled']
        : ['source_unavailable', 'Oracle did not answer'];
    await q.query(
      `UPDATE upload_item SET outcome = 'skipped', code = $2, message = $3, received_at = now()
        WHERE batch_id = $1 AND outcome IS NULL`,
      [row.batch_id, code, message],
    );
  }
  await q.query(
    `UPDATE import_item SET external_application_id = NULL, external_attachment_id = NULL
      WHERE run_id = $1 AND (external_application_id IS NOT NULL OR external_attachment_id IS NOT NULL)`,
    [runId],
  );
  // Older Oracle batches of this vacancy: their open or retryable files are now this run's concern.
  await q.query(
    `UPDATE upload_item i SET outcome = 'skipped', code = 'superseded', message = 'Replaced by a newer import',
            received_at = now()
       FROM upload_batch b
      WHERE b.id = i.batch_id AND b.vacancy_id = $1 AND b.source = 'oracle_hcm'
        AND b.id IS DISTINCT FROM $2::text
        AND b.created_at < COALESCE((SELECT created_at FROM upload_batch WHERE id = $2::text), now())
        AND (i.outcome IS NULL OR (i.outcome = 'skipped' AND i.code = ANY($3::text[])))`,
    [row.vacancy_id, row.batch_id, RETRYABLE_CODES],
  );
  return true;
}

/**
 * Ask a run to stop. A run no worker holds (`queued`, `awaiting_confirm`) is finished here, in the
 * caller's transaction; a `running` run gets `cancel_requested_at` and the runner finishes it before
 * its next download and inside `admit`.
 */
export async function requestCancel(
  q: Queryable,
  runId: string,
  userId: string,
  errorCode: string | null = null,
): Promise<{ ended: boolean; requested: boolean }> {
  const run = await readRun(q, runId, true);
  if (!run || !(ACTIVE_RUN_STATES as readonly string[]).includes(run.state))
    return { ended: false, requested: false };
  if (run.state === 'running') {
    await q.query(
      `UPDATE import_run SET cancel_requested_at = COALESCE(cancel_requested_at, now()),
              cancel_requested_by = COALESCE(cancel_requested_by, $2),
              error_code = COALESCE(error_code, $3)
        WHERE id = $1`,
      [runId, userId, errorCode],
    );
    return { ended: false, requested: true };
  }
  return { ended: await finishRun(q, runId, 'cancelled', errorCode), requested: true };
}

/**
 * At the end of listing: one batch for the run, one upload item per import item, oldest application
 * first, each with the neutral label "Oracle application {n}" (the real file name is never written
 * to a permanent table other than `cv_document`). `seq` is renumbered by application date here.
 * Only called when `listed` is at least 1 (`upload_batch.file_count > 0`).
 */
export async function createBatchForRun(
  q: Queryable,
  run: Pick<RunRow, 'id' | 'vacancy_id' | 'started_by' | 'confirmed_by'>,
): Promise<{ batchId: string; files: number }> {
  const items = (
    await q.query<{ id: string; size_bytes: string | null }>(
      `SELECT id, size_bytes FROM import_item WHERE run_id = $1
        ORDER BY external_applied_at ASC NULLS LAST, seq ASC`,
      [run.id],
    )
  ).rows;
  if (!items.length) throw new Error('createBatchForRun: no items');
  const batchId = newId();
  await q.query(
    `INSERT INTO upload_batch (id, vacancy_id, created_by, file_count, source) VALUES ($1,$2,$3,$4,'oracle_hcm')`,
    [batchId, run.vacancy_id, run.confirmed_by ?? run.started_by, items.length],
  );
  for (let k = 0; k < items.length; k++) {
    const it = items[k]!;
    const uid = newId();
    await q.query(
      `INSERT INTO upload_item (id, batch_id, position, filename, size_bytes) VALUES ($1,$2,$3,$4,$5)`,
      [uid, batchId, k, `Oracle application ${k + 1}`, Number(it.size_bytes ?? 0)],
    );
    await q.query(`UPDATE import_item SET seq = $2, upload_item_id = $3 WHERE id = $1`, [
      it.id,
      k + 1,
      uid,
    ]);
  }
  await q.query(`UPDATE import_run SET batch_id = $2 WHERE id = $1`, [run.id, batchId]);
  return { batchId, files: items.length };
}

/** Whole numbers only: merges counts into `stats` (plan 15.2, S3-INT-11 (10)). */
export function addStats(a: RunStats, b: RunStats): RunStats {
  const out: RunStats = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof RunStats, number][])
    out[k] = Math.trunc((out[k] ?? 0) + (v ?? 0));
  return out;
}

/**
 * S3-OPS-05 (a): a run is stalled when it is running with no progress for 5 minutes, parked for 30,
 * or waiting for the recruiter for 60. A run that waits for the next day's call budget is not marked:
 * that wait is by design. Returns the minutes, or null when the run is not stalled.
 */
export function stalled(r: {
  state: string;
  progressAt: string | Date | null;
  waitReason: string | null;
  waitedSince?: string | Date | null;
  awaitingSince?: string | Date | null;
}): number | null {
  const mins = (d: string | Date | null | undefined) =>
    d ? Math.floor((Date.now() - new Date(d).getTime()) / 60_000) : 0;
  if (r.state === 'running') return mins(r.progressAt) >= 5 ? mins(r.progressAt) : null;
  if (r.state === 'queued' && r.waitReason && r.waitReason !== 'oracle_budget')
    return mins(r.waitedSince) >= 30 ? mins(r.waitedSince) : null;
  if (r.state === 'awaiting_confirm')
    return mins(r.awaitingSince) >= 60 ? mins(r.awaitingSince) : null;
  return null;
}
