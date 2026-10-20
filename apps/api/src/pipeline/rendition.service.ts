import { readFileSync } from 'node:fs';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { DbService } from '../db/db.service';
import {
  convertDocxToPdf,
  converterAvailable,
  prepareProfile,
  RenditionError,
  sweepTemp,
} from './docx-convert';
import { IntakeService } from './intake.service';

/**
 * Word CVs as pages (Stage 2, S2-BE7). One conversion at a time, in the background, never while
 * uploads are being read and never when the container is short of memory. A recruiter who opens a
 * Word CV whose pages are not ready moves it to the front of the line.
 */

const TICK_MS = 3_000;
const STALE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 2;
/** The converter does not start above this share of the container's memory. */
export const MEMORY_CEILING = 0.6;

const WORD_NAME = `(lower(d.filename) LIKE '%.docx' OR d.mime LIKE '%wordprocessingml%')`;

/** Share of the container's memory in use (the working set, without the file cache), 0 to 1. */
export function memoryShare(read: (p: string) => string = (p) => readFileSync(p, 'utf8')): number {
  const num = (p: string) => {
    try {
      return Number(read(p).trim());
    } catch {
      return NaN;
    }
  };
  try {
    // cgroup v2
    const max = read('/sys/fs/cgroup/memory.max').trim();
    if (max !== 'max') {
      const limit = Number(max);
      const cur = num('/sys/fs/cgroup/memory.current');
      const inactive = /^inactive_file (\d+)/m.exec(read('/sys/fs/cgroup/memory.stat'))?.[1];
      if (limit > 0 && Number.isFinite(cur))
        return Math.min(1, Math.max(0, (cur - Number(inactive ?? 0)) / limit));
    }
  } catch {
    /* not v2 */
  }
  const limit = num('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  const usage = num('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  if (Number.isFinite(limit) && Number.isFinite(usage) && limit > 0 && limit < 2 ** 50)
    return usage / limit;
  return 1 - freemem() / totalmem();
}

export type RenditionRun = 'idle' | 'blocked' | 'ready' | 'failed' | 'retry' | 'stopped';

@Injectable()
export class RenditionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('rendition');
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopping = false;
  private found = false;
  private profile?: string;

  constructor(
    private readonly db: DbService,
    private readonly intake: IntakeService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap() {
    this.found = await converterAvailable(this.env.RENDITION_SOFFICE);
    if (this.env.RENDITION_ENABLED !== 'true') return;
    if (!this.found) {
      this.log.warn(
        'The converter (LibreOffice) is not installed: Word CVs will show their text only.',
      );
      return;
    }
    await sweepTemp();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Can this instance produce pages? (Switched on and the converter is there.) */
  get available(): boolean {
    return this.env.RENDITION_ENABLED === 'true' && this.found;
  }

  /** Try the next one soon. Never awaited, never throws. */
  nudge() {
    if (this.available && !this.stopping) void this.tick();
  }

  /** A person is looking at this Word CV: its pages go to the front of the line. */
  async prioritise(documentId: string) {
    await this.db.query(
      `UPDATE cv_document SET rendition_priority = true
        WHERE id = $1 AND rendition_state IN ('pending', 'processing') AND erased_at IS NULL`,
      [documentId],
    );
    this.nudge();
  }

  private async tick() {
    try {
      await this.runOnce();
    } catch (e) {
      this.log.warn(`rendition tick failed: ${(e as Error).message}`);
    }
  }

  /** A conversion that was started and never finished goes back, or fails for good. */
  async recover(): Promise<number> {
    const r = await this.db.query(
      `UPDATE cv_document
          SET rendition_state = CASE WHEN rendition_attempts >= $2 THEN 'failed' ELSE 'pending' END,
              rendition_error = CASE WHEN rendition_attempts >= $2 THEN 'The conversion did not finish.' ELSE rendition_error END
        WHERE rendition_state = 'processing' AND rendition_started_at < now() - ($1::int * interval '1 millisecond')`,
      [STALE_MS, MAX_ATTEMPTS],
    );
    return r.rowCount ?? 0;
  }

  /**
   * Convert the next waiting CV, if the conditions allow. `force` skips the switches and the
   * guards (for tests and for the first run after a deploy check).
   */
  async runOnce(force = false): Promise<RenditionRun> {
    if (this.stopping) return 'stopped';
    if (this.busy) return 'blocked';
    if (!force && !this.available) return 'blocked';
    if (!this.found && !(await converterAvailable(this.env.RENDITION_SOFFICE))) return 'blocked';
    if (!force && (this.intake.permits.inUse > 0 || memoryShare() >= MEMORY_CEILING))
      return 'blocked';
    this.busy = true;
    try {
      await this.recover();
      // The claim takes a waiting row, or a live Word file an older instance stored during a deploy
      // (state NULL), with the ones a person is waiting for first, then the oldest.
      const claimed = (
        await this.db.query<{ id: string; content: Buffer; attempts: number }>(
          `UPDATE cv_document
              SET rendition_state = 'processing', rendition_started_at = now(),
                  rendition_attempts = rendition_attempts + 1
            WHERE id = (
                    SELECT d.id FROM cv_document d
                     WHERE d.erased_at IS NULL AND d.content IS NOT NULL
                       AND (d.rendition_state = 'pending' OR (d.rendition_state IS NULL AND ${WORD_NAME}))
                     ORDER BY d.rendition_priority DESC, d.uploaded_at, d.id
                     LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING id, content, rendition_attempts AS attempts`,
        )
      ).rows[0];
      if (!claimed) return 'idle';
      return await this.convert(claimed.id, claimed.content, claimed.attempts);
    } finally {
      this.busy = false;
    }
  }

  private async convert(id: string, content: Buffer, attempts: number): Promise<RenditionRun> {
    try {
      if (!this.profile) {
        this.profile = join(tmpdir(), `cv-rendition-profile-${process.pid}`);
        await prepareProfile(this.profile);
      }
      const { pdf } = await convertDocxToPdf(content, {
        soffice: this.env.RENDITION_SOFFICE,
        profileDir: this.profile,
      });
      // The write only lands if the CV is still ours to write to and has not been erased.
      const r = await this.db.query(
        `UPDATE cv_document
            SET rendition_pdf = $2, rendition_state = 'ready', rendition_error = NULL, rendition_priority = false
          WHERE id = $1 AND rendition_state = 'processing' AND erased_at IS NULL`,
        [id, pdf],
      );
      return r.rowCount ? 'ready' : 'stopped';
    } catch (e) {
      const err =
        e instanceof RenditionError ? e : new RenditionError('The conversion failed.', true);
      if (!(e instanceof RenditionError))
        this.log.warn(`conversion error: ${(e as Error).message}`);
      const final = !err.retryable || attempts >= MAX_ATTEMPTS;
      await this.db.query(
        `UPDATE cv_document
            SET rendition_state = $2, rendition_error = $3, rendition_priority = false
          WHERE id = $1 AND rendition_state = 'processing' AND erased_at IS NULL`,
        [id, final ? 'failed' : 'pending', err.message.slice(0, 300)],
      );
      return final ? 'failed' : 'retry';
    }
  }

  /** What the review screen needs to know about a Word CV's pages. */
  async stateOf(documentId: string) {
    const r = (
      await this.db.query<{
        state: string | null;
        word: boolean;
        pdf: boolean;
        error: string | null;
      }>(
        `SELECT rendition_state AS state, ${WORD_NAME} AS word, rendition_pdf IS NOT NULL AS pdf,
                rendition_error AS error
           FROM cv_document d WHERE d.id = $1`,
        [documentId],
      )
    ).rows[0];
    return r ?? { state: null, word: false, pdf: false, error: null };
  }
}
