import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import { AuditService } from '../../audit/audit.service';
import type { Principal } from '../../auth/principal';
import { euResident } from '../../ai/catalog';
import { DbService, type Queryable } from '../../db/db.service';
import { IntakeService } from '../../pipeline/intake.service';
import { VacancyScope } from '../../vacancy/vacancy-scope.service';
import { SourceError } from '../import-source';
import {
  ACTIVE_RUN_STATES,
  activeRun,
  createBatchForRun,
  readRun,
  requestCancel,
  type RunRow,
} from '../import-runs';
import {
  AuthCircuitOpen,
  OracleConnectionService,
  type ConnectionRow,
} from './oracle-connection.service';
import { bakuTime, refuse } from './oracle-refusals';

/** Code defaults (plan 15.1): the refresh cooldown and the lookup limits. */
export const IMPORT_LIMITS = {
  cooldownMs: 10 * 60_000,
  lookupsPerUser: 10,
  lookupsAll: 30,
  windowSec: 60,
  staleDays: 30,
};

const REF = /^[A-Za-z0-9][A-Za-z0-9_.\-/ ]{0,63}$/;

export interface RunView {
  runId: string;
  mode: string;
  state: string;
  phase: string;
  batchId: string | null;
  listed: number;
  estimate: number | null;
  counts: Record<string, number>;
  waitReason: string | null;
  errorCode: string | null;
  confirmReason: string | null;
  pauseEndsAt: string | null;
  startedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  cancelRequested: boolean;
}

/**
 * Stage 3, S3-INT-10, S3-INT-11 (confirm) and S3-INT-13: what the recruiter's Oracle routes do. One
 * place starts a run (the import button, Refresh, and Retry failed on an Oracle batch). The first
 * import saves the link (design note 6): the gate and every refusal first, then the requisition is
 * re-read from Oracle by its number outside any transaction (the browser never supplies Oracle's
 * ID), then one transaction locks the vacancy, writes the link and the run, or neither.
 */
@Injectable()
export class OracleImportService {
  constructor(
    private readonly db: DbService,
    private readonly conns: OracleConnectionService,
    private readonly intake: IntakeService,
    private readonly scope: VacancyScope,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ shared checks

  private async activeConnection(): Promise<ConnectionRow> {
    const row = await this.conns.row();
    if (!row || !row.enabled) throw refuse('ORACLE_NOT_ACTIVE');
    return row;
  }

  /** The refusals that need no Oracle call (S3-INT-10 (7)). */
  private async preflight(
    row: ConnectionRow,
    opts: { vacancyId?: string; cooldown?: boolean } = {},
  ) {
    if (!row.notice_attested_at) throw refuse('NOTICE_NOT_ATTESTED');
    const ret = await this.db.query<{ enabled: boolean }>(
      `SELECT enabled FROM retention_setting WHERE id = 1`,
    );
    if (!ret.rows[0]?.enabled) throw refuse('RETENTION_OFF');
    if (row.auth_failed_at) throw refuse('ORACLE_AUTH');
    if (!(await this.conns.client.budgetLeft(row.id))) throw refuse('ORACLE_BUDGET');
    await this.assertEuAi(row);
    if (opts.vacancyId && opts.cooldown) {
      const last = await this.db.query<{ at: Date }>(
        `SELECT GREATEST(created_at, COALESCE(finished_at, created_at)) AS at FROM import_run
          WHERE vacancy_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [opts.vacancyId],
      );
      const at = last.rows[0]?.at;
      if (at && Date.now() - new Date(at).getTime() < IMPORT_LIMITS.cooldownMs) {
        const allowed = new Date(new Date(at).getTime() + IMPORT_LIMITS.cooldownMs);
        throw refuse(
          'IMPORT_COOLDOWN',
          { allowedAt: allowed.toISOString() },
          { time: bakuTime(allowed) },
        );
      }
    }
  }

  /** requireEuAi (on by default): the active AI company must process in the EU (S3-INT-10 (11)). */
  async assertEuAi(row: ConnectionRow) {
    if (!this.conns.settings(row).requireEuAi) return;
    const a = await this.db.query<{ company: string; settings: Record<string, unknown> }>(
      `SELECT c.company, c.settings FROM ai_setting s JOIN ai_model m ON m.id = s.active_model
         JOIN ai_connection c ON c.id = m.connection_id`,
    );
    const r = a.rows[0];
    if (!r || !euResident(r.company, r.settings)) throw refuse('AI_NOT_EU');
  }

  /** An Oracle read at the click: refusals for sign-in, budget and outage. */
  private async oracle<T>(fn: Parameters<OracleConnectionService['call']>[0]): Promise<T> {
    try {
      return (await this.conns.call(fn)) as T;
    } catch (e) {
      if (e instanceof AuthCircuitOpen) throw refuse('ORACLE_AUTH');
      if (e instanceof SourceError) {
        if (e.code === 'auth') throw refuse('ORACLE_AUTH');
        if (e.code === 'budget') throw refuse('ORACLE_BUDGET');
        throw refuse('ORACLE_UNAVAILABLE');
      }
      throw refuse('ORACLE_UNAVAILABLE');
    }
  }

  private async room(vid: string, q: Queryable = this.db) {
    const live = Number(
      (
        await q.query<{ n: string }>(
          `SELECT count(*) AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL`,
          [vid],
        )
      ).rows[0]!.n,
    );
    return Math.max(0, this.intake.maxCvs - live);
  }

  // ------------------------------------------------------------------ lookup (S3-INT-10 step 10b)

  async lookup(p: Principal, vid: string, ref: string, ip?: string) {
    const vac = await this.scope.assertEdit(p, vid);
    if (vac.archivedAt) throw new ConflictException('Restore this vacancy first');
    if (!REF.test(ref)) throw refuse('ORACLE_REQ_NOT_FOUND');
    const row = await this.activeConnection();
    if (row.auth_failed_at) throw refuse('ORACLE_AUTH');
    if (!(await this.conns.client.budgetLeft(row.id))) throw refuse('ORACLE_BUDGET');
    // Database-backed limits (they hold after a restart): per user and for everyone, per minute.
    const counts = (
      await this.db.query<{ mine: string; all: string }>(
        `SELECT count(*) FILTER (WHERE actor_id = $1) AS mine, count(*) AS all FROM audit_event
          WHERE action = 'oracle.lookup' AND occurred_at > now() - make_interval(secs => $2)`,
        [p.userId, IMPORT_LIMITS.windowSec],
      )
    ).rows[0]!;
    if (
      Number(counts.mine) >= IMPORT_LIMITS.lookupsPerUser ||
      Number(counts.all) >= IMPORT_LIMITS.lookupsAll
    )
      throw refuse('LOOKUP_LIMIT');
    await this.audit.record(this.db, {
      actorId: p.userId,
      actorType: p.actorType,
      sourceIp: ip,
      action: 'oracle.lookup',
      entityType: 'vacancy',
      entityId: vid,
      after: { requisitionNumber: ref },
    });
    const client = this.conns.client;
    const req = await this.oracle<{
      id: string;
      number: string;
      title: string;
      state: string;
    } | null>((t) => client.findRequisition(t, ref));
    if (!req) return { found: false };
    const estimate = await this.oracle<number>((t) => client.estimate(t, req.id));
    return {
      found: true,
      number: req.number,
      title: req.title,
      state: req.state,
      estimate,
      room: await this.room(vid),
    };
  }

  // ------------------------------------------------------------------ start (S3-INT-10 step 10a, S3-INT-13 (13))

  async start(
    p: Principal,
    vid: string,
    body: { ref?: string; estimate?: number },
    ip: string | undefined,
    opts: { mode?: 'import' | 'refresh' } = {},
  ): Promise<{ runId: string }> {
    await this.intake.gate(p, vid);
    const row = await this.activeConnection();
    const linked = (
      await this.db.query<{
        external_ref: string | null;
        external_id: string | null;
        external_link_state: string | null;
      }>(`SELECT external_ref, external_id, external_link_state FROM vacancy WHERE id = $1`, [vid])
    ).rows[0]!;
    const ref = linked.external_ref ?? body.ref?.trim();
    if (!ref || !REF.test(ref)) throw refuse('ORACLE_REQ_NOT_FOUND');
    const hasRuns = Boolean(
      (await this.db.query(`SELECT 1 FROM import_run WHERE vacancy_id = $1 LIMIT 1`, [vid]))
        .rowCount,
    );
    const running = await activeRun(this.db, vid);
    if (running) throw refuse('IMPORT_RUNNING', { runId: running.id });
    await this.preflight(row, { vacancyId: vid, cooldown: hasRuns });
    const client = this.conns.client;
    const req = await this.oracle<{ id: string; number: string } | null>((t) =>
      client.findRequisition(t, ref),
    );
    if (!req) throw refuse('ORACLE_REQ_NOT_FOUND');
    const fresh = await this.oracle<number>((t) => client.estimate(t, req.id));
    const confirmed = Number.isFinite(body.estimate)
      ? Math.max(0, Math.floor(body.estimate!))
      : fresh;
    // The smaller of the two: a wrong number from the browser cannot switch the pause off.
    const estimate = Math.min(confirmed, fresh);
    const s = this.conns.settings(row);
    const runId = newId();
    return this.db.withTx(async (tx) => {
      const v = (
        await tx.query<{
          external_ref: string | null;
          external_link_state: string | null;
          status: string;
        }>(
          `SELECT external_ref, external_link_state, status FROM vacancy WHERE id = $1 FOR UPDATE`,
          [vid],
        )
      ).rows[0]!;
      const lead = p.roles.includes('TA_LEAD');
      if (!v.external_ref) {
        const state = s.linkPolicy === 'lead_approval' && !lead ? 'proposed' : 'approved';
        await tx.query('SAVEPOINT link');
        try {
          await tx.query(
            `UPDATE vacancy SET external_ref = $2, external_system = 'oracle_hcm', external_id = $3,
                    external_link_state = $4::text, external_linked_by = $5::ulid, external_linked_at = now(),
                    external_approved_by = CASE WHEN $4::text = 'approved' THEN $5::ulid END,
                    external_approved_at = CASE WHEN $4::text = 'approved' THEN now() END
              WHERE id = $1`,
            [vid, req.number, req.id, state, p.userId],
          );
          await tx.query('RELEASE SAVEPOINT link');
        } catch (e) {
          await tx.query('ROLLBACK TO SAVEPOINT link');
          if ((e as { code?: string }).code === '23505') {
            const other = await this.db.query<{ id: string }>(
              `SELECT id FROM vacancy WHERE external_ref = $1 AND id <> $2`,
              [req.number, vid],
            );
            const otherId = other.rows[0]?.id;
            const visible = otherId
              ? await this.scope.assert(p, otherId).then(
                  () => true,
                  () => false,
                )
              : false;
            throw refuse('ORACLE_REQ_LINKED', visible ? { vacancyId: otherId } : {});
          }
          throw e;
        }
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: ip,
          action: 'vacancy.external_link',
          entityType: 'vacancy',
          entityId: vid,
          after: { requisitionNumber: req.number, requisitionId: req.id, state },
        });
        if (state === 'proposed') return Promise.reject(refuse('LINK_NOT_APPROVED'));
      } else if (v.external_link_state === 'proposed' && !lead) {
        throw refuse('LINK_NOT_APPROVED');
      }
      await tx.query('SAVEPOINT run');
      try {
        await tx.query(
          `INSERT INTO import_run (id, vacancy_id, mode, state, phase, external_ref, external_id, estimate, started_by, started_ip)
           VALUES ($1,$2,$3,'queued','listing',$4,$5,$6,$7,$8)`,
          [
            runId,
            vid,
            opts.mode ?? (hasRuns ? 'refresh' : 'import'),
            req.number,
            req.id,
            estimate,
            p.userId,
            ip ?? null,
          ],
        );
        await tx.query('RELEASE SAVEPOINT run');
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT run');
        if ((e as { code?: string }).code === '23505') {
          const act = await activeRun(tx, vid);
          throw refuse('IMPORT_RUNNING', { runId: act?.id });
        }
        throw e;
      }
      // The import never calls start(); a first import opens a draft vacancy here (S3-INT-10 (12)).
      await tx.query(`UPDATE vacancy SET status = 'open' WHERE id = $1 AND status = 'draft'`, [
        vid,
      ]);
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'import_run.started',
        entityType: 'import_run',
        entityId: runId,
        after: {
          vacancyId: vid,
          requisitionNumber: req.number,
          estimate,
          mode: opts.mode ?? (hasRuns ? 'refresh' : 'import'),
        },
      });
      return { runId };
    });
  }

  /**
   * The link was written as `proposed` (lead approval on) and the start refused: that refusal must
   * not roll the proposal back. Runs the start; on LINK_NOT_APPROVED the link is saved on its own.
   */
  async startOrPropose(
    p: Principal,
    vid: string,
    body: { ref?: string; estimate?: number },
    ip?: string,
  ) {
    try {
      return await this.start(p, vid, body, ip);
    } catch (e) {
      if (
        e instanceof HttpException &&
        (e.getResponse() as { code?: string }).code === 'LINK_NOT_APPROVED'
      ) {
        const v = await this.db.query(`SELECT external_ref FROM vacancy WHERE id = $1`, [vid]);
        if (!v.rows[0]?.external_ref) await this.propose(p, vid, body.ref ?? '', ip);
      }
      throw e;
    }
  }

  private async propose(p: Principal, vid: string, ref: string, ip?: string) {
    const client = this.conns.client;
    const req = await this.oracle<{ id: string; number: string } | null>((t) =>
      client.findRequisition(t, ref),
    );
    if (!req) return;
    await this.db.withTx(async (tx) => {
      const r = await tx.query(
        `UPDATE vacancy SET external_ref = $2, external_system = 'oracle_hcm', external_id = $3, external_link_state = 'proposed',
                external_linked_by = $4, external_linked_at = now() WHERE id = $1 AND external_ref IS NULL`,
        [vid, req.number, req.id, p.userId],
      );
      if (r.rowCount)
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: ip,
          action: 'vacancy.external_link',
          entityType: 'vacancy',
          entityId: vid,
          after: { requisitionNumber: req.number, requisitionId: req.id, state: 'proposed' },
        });
    });
  }

  // ------------------------------------------------------------------ link, unlink, approve

  async unlink(p: Principal, vid: string, ip?: string) {
    await this.scope.assertEdit(p, vid);
    return this.db.withTx(async (tx) => {
      const v = (
        await tx.query<{ external_ref: string | null }>(
          `SELECT external_ref FROM vacancy WHERE id = $1 FOR UPDATE`,
          [vid],
        )
      ).rows[0]!;
      if (!v.external_ref) return { unlinked: false };
      if (await activeRun(tx, vid)) throw refuse('IMPORT_RUNNING');
      const imported = await tx.query(
        `SELECT 1 FROM import_item WHERE vacancy_id = $1 AND document_id IS NOT NULL LIMIT 1`,
        [vid],
      );
      if (imported.rowCount && !p.roles.includes('TA_LEAD'))
        throw new ForbiddenException('To change it now, ask a team lead.');
      await tx.query(
        `UPDATE vacancy SET external_ref = NULL, external_system = NULL, external_id = NULL, external_link_state = NULL,
                external_linked_by = NULL, external_linked_at = NULL, external_approved_by = NULL, external_approved_at = NULL
          WHERE id = $1`,
        [vid],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'vacancy.external_unlink',
        entityType: 'vacancy',
        entityId: vid,
        before: { requisitionNumber: v.external_ref },
      });
      return { unlinked: true };
    });
  }

  async approve(p: Principal, vid: string, ip?: string) {
    await this.scope.assertEdit(p, vid);
    return this.db.withTx(async (tx) => {
      const r = await tx.query(
        `UPDATE vacancy SET external_link_state = 'approved', external_approved_by = $2, external_approved_at = now()
          WHERE id = $1 AND external_link_state = 'proposed'`,
        [vid, p.userId],
      );
      if (r.rowCount)
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: ip,
          action: 'vacancy.external_link_approved',
          entityType: 'vacancy',
          entityId: vid,
        });
      return { approved: Boolean(r.rowCount) };
    });
  }

  // ------------------------------------------------------------------ the vacancy's Oracle state

  private view(r: RunRow & { started_name?: string | null }): RunView {
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.stats ?? {})) counts[k] = Math.trunc(Number(v) || 0);
    return {
      runId: r.id,
      mode: r.mode,
      state: r.state,
      phase: r.phase,
      batchId: r.batch_id,
      listed: r.listed,
      estimate: r.estimate,
      counts,
      waitReason: r.wait_reason,
      errorCode: r.error_code,
      confirmReason: r.confirm_reason,
      pauseEndsAt:
        r.state === 'awaiting_confirm' && r.awaiting_since
          ? new Date(new Date(r.awaiting_since).getTime() + 2 * 3_600_000).toISOString()
          : null,
      startedBy: r.started_name ?? null,
      createdAt: new Date(r.created_at).toISOString(),
      finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      cancelRequested: Boolean(r.cancel_requested_at),
    };
  }

  /** `GET vacancies/:id/oracle` (S3-INT-10 (13)): never an Oracle host. */
  async state(p: Principal, vid: string) {
    await this.scope.assert(p, vid);
    const row = await this.conns.row();
    const v = (
      await this.db.query<{
        external_ref: string | null;
        external_link_state: string | null;
        linked_at: Date | null;
        linked_by: string | null;
      }>(
        `SELECT v.external_ref, v.external_link_state, v.external_linked_at AS linked_at,
                COALESCE(u.display_name, u.email) AS linked_by
           FROM vacancy v LEFT JOIN app_user u ON u.id = v.external_linked_by WHERE v.id = $1`,
        [vid],
      )
    ).rows[0]!;
    const runs = await this.db.query<RunRow & { started_name: string | null }>(
      `SELECT r.*, COALESCE(u.display_name, u.email) AS started_name FROM import_run r
         LEFT JOIN app_user u ON u.id = r.started_by
        WHERE r.vacancy_id = $1 ORDER BY r.created_at DESC LIMIT 5`,
      [vid],
    );
    const active = runs.rows.find((r) =>
      (ACTIVE_RUN_STATES as readonly string[]).includes(r.state),
    );
    const last = runs.rows.find((r) => !(ACTIVE_RUN_STATES as readonly string[]).includes(r.state));
    const lastDone = runs.rows.find((r) => r.state === 'completed');
    const gone = Number(
      (
        await this.db.query<{ n: string }>(
          `SELECT count(*) AS n FROM import_item i JOIN cv_document d ON d.id = i.document_id
            WHERE i.vacancy_id = $1 AND i.source_gone_at IS NOT NULL AND d.erased_at IS NULL`,
          [vid],
        )
      ).rows[0]!.n,
    );
    const imported = Boolean(
      (
        await this.db.query(
          `SELECT 1 FROM import_item WHERE vacancy_id = $1 AND document_id IS NOT NULL LIMIT 1`,
          [vid],
        )
      ).rowCount,
    );
    let canEdit = true;
    try {
      await this.scope.assertEdit(p, vid);
    } catch {
      canEdit = false;
    }
    return {
      available: Boolean(row?.enabled),
      link: v.external_ref
        ? {
            ref: v.external_ref,
            state: v.external_link_state,
            linkedBy: v.linked_by,
            linkedAt: v.linked_at ? new Date(v.linked_at).toISOString() : null,
            canUnlink: canEdit && !active && (!imported || p.roles.includes('TA_LEAD')),
          }
        : null,
      run: active ? this.view(active) : null,
      lastRun: last ? this.view(last) : null,
      goneCount: gone,
      staleDays: lastDone?.finished_at
        ? Math.floor((Date.now() - new Date(lastDone.finished_at).getTime()) / 86_400_000)
        : null,
      linkPolicy: row ? this.conns.settings(row).linkPolicy : 'open',
      room: await this.room(vid),
    };
  }

  // ------------------------------------------------------------------ confirm and cancel

  /** Confirm after a pause (S3-INT-11 (2)): the gate is run again for the person who confirms. */
  async confirm(p: Principal, runId: string, ip?: string) {
    const run0 = await readRun(this.db, runId);
    if (!run0) throw new NotFoundException();
    await this.intake.gate(p, run0.vacancy_id);
    const row = await this.activeConnection();
    await this.assertEuAi(row);
    return this.db.withTx(async (tx) => {
      const run = await readRun(tx, runId, true);
      if (!run || run.state !== 'awaiting_confirm')
        throw new ConflictException('This import is not waiting for you.');
      await tx.query(
        `UPDATE import_run SET confirmed_by = $2, confirmed_at = now() WHERE id = $1`,
        [runId, p.userId],
      );
      await createBatchForRun(tx, { ...run, confirmed_by: p.userId });
      await tx.query(
        `UPDATE import_run SET state = 'queued', phase = 'fetching', awaiting_since = NULL, run_after = NULL WHERE id = $1`,
        [runId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'import_run.confirmed',
        entityType: 'import_run',
        entityId: runId,
        after: {
          vacancyId: run.vacancy_id,
          estimate: run.estimate,
          listed: run.listed,
          reason: run.confirm_reason,
        },
      });
      return { confirmed: true, runId };
    });
  }

  async cancel(p: Principal, runId: string, ip?: string) {
    const run0 = await readRun(this.db, runId);
    if (!run0) throw new NotFoundException();
    await this.scope.assertEdit(p, run0.vacancy_id);
    return this.db.withTx(async (tx) => {
      const r = await requestCancel(tx, runId, p.userId);
      if (r.requested)
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: ip,
          action: 'import_run.cancel_requested',
          entityType: 'import_run',
          entityId: runId,
          after: { vacancyId: run0.vacancy_id },
        });
      return { cancelled: r.requested };
    });
  }
}
