import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { DbService } from '../db/db.service';
import { eraseDocumentData } from './erase-document';
import { ReportService } from './report.service';

export interface RetentionSetting {
  enabled: boolean;
  days: number;
}
export interface RetentionResult {
  certificateId: string | null;
  documents: number;
  heldBack: number;
  vacancies: number;
  cutoff: string;
  days: number;
  dryRun: boolean;
}

const SYSTEM_SUBJECT = 'retention-job';
const HOUR = 3_600_000;

/**
 * DOC-08..11. Candidate documents are erased once they are older than the retention period, unless
 * their vacancy is under legal hold. Same erasure as the recruiter's own erase action; every
 * document gets an audit entry and every run gets a certificate (counts only). Off until an admin
 * turns it on and chooses the period.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('retention');
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap() {
    if (this.env.WORKER_ENABLED !== 'true') return;
    this.timer = setInterval(() => void this.scheduled(), HOUR);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async setting(): Promise<RetentionSetting> {
    const { rows } = await this.db.query<RetentionSetting>(
      `SELECT enabled, days FROM retention_setting WHERE id = 1`,
    );
    return rows[0] ?? { enabled: false, days: 180 };
  }

  private async scheduled() {
    try {
      const s = await this.setting();
      if (s.enabled) await this.run('schedule', false);
    } catch (e) {
      this.log.warn(`scheduled purge failed: ${(e as Error).message}`);
    }
  }

  private async systemUser(): Promise<string> {
    await this.db.query(
      `INSERT INTO app_user (id, issuer, subject, actor_kind, display_name)
       VALUES ($1,'system',$2,'service','Retention job') ON CONFLICT (issuer, subject) DO NOTHING`,
      [newId(), SYSTEM_SUBJECT],
    );
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM app_user WHERE issuer = 'system' AND subject = $1`,
      [SYSTEM_SUBJECT],
    );
    return rows[0]!.id;
  }

  /** What a run would do now, without doing it. */
  async preview(): Promise<{ documents: number; heldBack: number; cutoff: string; days: number }> {
    const { days } = await this.setting();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const { rows } = await this.db.query<{ due: string; held: string }>(
      `SELECT count(*) FILTER (WHERE NOT v.legal_hold) AS due,
              count(*) FILTER (WHERE v.legal_hold) AS held
         FROM cv_document d JOIN vacancy v ON v.id = d.vacancy_id
        WHERE d.erased_at IS NULL AND d.uploaded_at < $1`,
      [cutoff],
    );
    return {
      documents: Number(rows[0]!.due),
      heldBack: Number(rows[0]!.held),
      cutoff: cutoff.toISOString(),
      days,
    };
  }

  async run(
    trigger: 'schedule' | 'manual',
    dryRun: boolean,
    actorId?: string,
  ): Promise<RetentionResult> {
    if (this.busy) throw new Error('A purge is already running');
    this.busy = true;
    try {
      const { days } = await this.setting();
      const cutoff = new Date(Date.now() - days * 86_400_000);
      if (dryRun) {
        const p = await this.preview();
        return { certificateId: null, ...p, vacancies: 0, dryRun: true };
      }
      const actor = actorId ?? (await this.systemUser());
      const sys = await this.systemUser();
      const { rows: due } = await this.db.query<{ id: string; vacancy_id: string }>(
        `SELECT d.id, d.vacancy_id FROM cv_document d JOIN vacancy v ON v.id = d.vacancy_id
          WHERE d.erased_at IS NULL AND d.uploaded_at < $1 AND NOT v.legal_hold
          ORDER BY d.uploaded_at LIMIT 5000`,
        [cutoff],
      );
      const held = await this.db.query<{ n: string }>(
        `SELECT count(*) AS n FROM cv_document d JOIN vacancy v ON v.id = d.vacancy_id
          WHERE d.erased_at IS NULL AND d.uploaded_at < $1 AND v.legal_hold`,
        [cutoff],
      );
      let documents = 0;
      const vacancies = new Set<string>();
      for (const d of due) {
        await this.db.withTx(async (tx) => {
          // Re-check inside the transaction: a hold placed meanwhile wins.
          const hold = await tx.query<{ legal_hold: boolean }>(
            `SELECT legal_hold FROM vacancy WHERE id = $1 FOR SHARE`,
            [d.vacancy_id],
          );
          if (hold.rows[0]?.legal_hold) return;
          if (!(await eraseDocumentData(tx, this.reports, d.id, sys))) return;
          await this.audit.record(tx, {
            actorId: actor,
            actorType: actorId ? 'human' : 'service',
            action: 'document.purge',
            entityType: 'document',
            entityId: d.id,
            after: { reason: 'retention', days, trigger },
          });
          documents++;
          vacancies.add(d.vacancy_id);
        });
      }
      const certificateId = newId();
      const heldBack = Number(held.rows[0]!.n);
      if (documents > 0 || heldBack > 0 || trigger === 'manual') {
        await this.db.withTx(async (tx) => {
          await tx.query(
            `INSERT INTO retention_certificate (id, trigger, days, cutoff, documents, held_back, vacancies, actor_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [certificateId, trigger, days, cutoff, documents, heldBack, vacancies.size, actor],
          );
          await this.audit.record(tx, {
            actorId: actor,
            actorType: actorId ? 'human' : 'service',
            action: 'retention.run',
            entityType: 'retention_run',
            entityId: certificateId,
            after: { trigger, days, cutoff: cutoff.toISOString(), documents, heldBack },
          });
        });
      }
      return {
        certificateId: documents > 0 || heldBack > 0 || trigger === 'manual' ? certificateId : null,
        documents,
        heldBack,
        vacancies: vacancies.size,
        cutoff: cutoff.toISOString(),
        days,
        dryRun: false,
      };
    } finally {
      this.busy = false;
    }
  }
}
