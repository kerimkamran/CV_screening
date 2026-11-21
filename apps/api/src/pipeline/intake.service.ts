import { ConflictException, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  isFinalItem,
  newId,
  RETRYABLE_CODES,
  type UploadCode,
  type UploadOutcome,
} from '@cv/shared';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { Semaphore } from '../common/semaphore';
import { ENV, type Env } from '../config/env';
import { DbService, type Queryable } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import {
  docxStructureOk,
  extractTextWithPages,
  MAX_TEXT_CHARS,
  MIN_READABLE_CHARS,
  MIME,
  sha256,
  sniff,
} from './documents';
import { ProcessorService } from './processor.service';
import { iterateZip, ZipProblem } from './zip-intake';
import { sweepSpools } from './zip-spool';

/**
 * Taking CVs in (Stage 2, S2-BE2; Stage 3, S3-UP-02/03/05/06). One place for the rules, shared by
 * the legacy 50-file route, the one-file-per-request item route and SenAI's "Analyze for this
 * vacancy" copy:
 * - a capped reader: bytes beyond the cap are drained, never buffered; a ZIP is spooled to a temp
 *   file and read from there one entry at a time;
 * - at most INTAKE_MAX_CONCURRENT files being read at once; a ZIP holds ONE permit while it is
 *   expanded and its entries reuse it, so loose files keep going during a ZIP;
 * - text is read outside any transaction;
 * - one transaction per file, under a per-vacancy advisory lock, so the duplicate check and the
 *   vacancy cap are race-safe; only LIVE (not erased) documents count;
 * - a unique-violation is a duplicate, never a 500;
 * - a result is written to the upload item in the same transaction, so a retry is idempotent;
 * - a final item outcome is never written over (`ITEM_OPEN`): the write that loses returns the
 *   result that stands and adds no skip row;
 * - a batch that was cancelled stores nothing more (lock order: advisory lock, batch row FOR SHARE,
 *   item FOR UPDATE; the cancel route updates the batch row first).
 */

export interface IntakeResult {
  filename: string;
  status: UploadOutcome;
  code?: UploadCode | string;
  message?: string;
  documentId?: string;
  itemId?: string;
}

export interface IntakeCtx {
  principal: Principal;
  vacancyId: string;
  /** The frozen requirement set the new screenings are made against. */
  setId: string;
  ip: string;
  /** The upload item this file answers (item route). */
  itemId?: string;
  batchId?: string;
  /**
   * Stage 3, S3-INT-04: a file fetched by the Oracle import. `label` ("Oracle application 7") is
   * what the permanent skip list keeps instead of the candidate's file name; `via` and `runId` go on
   * the audit row; `claimId` must still be the run's claim when the CV is stored.
   */
  label?: string;
  via?: 'oracle_hcm';
  runId?: string;
  claimId?: string;
}

/** The import run lost its claim while this file was being read: the runner stops, nothing is written. */
export class ClaimLostError extends Error {
  constructor() {
    super('import run claim lost');
  }
}

export const MSG = {
  wrongType: 'Only PDF, DOCX, TXT and MD files are accepted',
  oldWord: 'Old Word format: save it as .docx or PDF',
  empty: 'The file is empty',
  duplicate: 'Already uploaded for this vacancy',
  noText: 'No readable text (scanned or protected file). Review the original manually.',
  noCvsInZip: 'No CVs found in this ZIP',
} as const;

/** A stored item outcome that must not be processed again (shared: `@cv/shared` status.ts). */
export { isFinalItem };

/**
 * The only condition under which an item's outcome may be written: it is empty, or it is a skip with
 * a code that may be sent again. One text, used by `finishItem` and by the cancel route.
 * `$RETRY` is replaced by the parameter that holds `RETRYABLE_CODES`.
 */
export const ITEM_OPEN = `(outcome IS NULL OR (outcome = 'skipped' AND code = ANY($RETRY::text[])))`;
export const itemOpen = (param: number) => ITEM_OPEN.replace('$RETRY', `$${param}`);

/** Raised inside the storing transaction when a write the lock should allow is refused. */
class ItemRaceError extends Error {}

/**
 * Read a stream up to `cap` bytes. Anything beyond is counted and thrown away, so an 11 MB file
 * costs at most the cap in memory and is reported as `tooLarge`.
 */
export async function readCapped(
  file: AsyncIterable<Buffer | string>,
  cap: number,
): Promise<{ buf: Buffer; tooLarge: boolean; bytes: number }> {
  const chunks: Buffer[] = [];
  let kept = 0;
  let bytes = 0;
  for await (const raw of file) {
    const c = typeof raw === 'string' ? Buffer.from(raw) : raw;
    bytes += c.length;
    if (kept + c.length <= cap) {
      chunks.push(c);
      kept += c.length;
    } else if (kept < cap) {
      chunks.push(c.subarray(0, cap - kept));
      kept = cap;
    }
  }
  const tooLarge = bytes > cap;
  return { buf: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks), tooLarge, bytes };
}

@Injectable()
export class IntakeService implements OnModuleInit {
  private readonly log = new Logger('intake');
  readonly permits: Semaphore;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly processor: ProcessorService,
    private readonly scope: VacancyScope,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.permits = new Semaphore(env.INTAKE_MAX_CONCURRENT);
  }

  /** Boot: ZIP temp folders a crashed process left behind are removed (S3-UP-06). */
  async onModuleInit() {
    const n = await sweepSpools();
    if (n) this.log.log(`removed ${n} left-over ZIP temp folder(s)`);
  }

  get maxFileBytes() {
    return this.env.MAX_UPLOAD_MB * 1024 * 1024;
  }
  get maxZipBytes() {
    return this.env.MAX_ZIP_MB * 1024 * 1024;
  }
  get maxCvs() {
    return this.env.MAX_RESUMES_PER_RUN;
  }

  isZipName(name: string) {
    return /\.zip$/i.test(name);
  }

  /** See `readCapped`. */
  readCapped(file: AsyncIterable<Buffer | string>, cap: number) {
    return readCapped(file, cap);
  }

  /** Before any bytes are read: what the name and the announced size already tell us. */
  precheck(
    name: string,
    size?: number,
  ): { outcome: 'rejected'; code: UploadCode; message: string } | null {
    const lower = name.toLowerCase();
    if (/\.doc$/.test(lower))
      return { outcome: 'rejected', code: 'old_word_format', message: MSG.oldWord };
    if (!/\.(pdf|docx|txt|md|zip)$/.test(lower)) {
      return { outcome: 'rejected', code: 'wrong_type', message: MSG.wrongType };
    }
    if (size === 0) return { outcome: 'rejected', code: 'empty', message: MSG.empty };
    const cap = this.isZipName(lower) ? this.env.MAX_ZIP_MB : this.env.MAX_UPLOAD_MB;
    if (size !== undefined && size > cap * 1024 * 1024) {
      return { outcome: 'rejected', code: 'too_large', message: `Larger than ${cap} MB` };
    }
    return null;
  }

  rejectTooLarge(
    ctx: Pick<IntakeCtx, 'itemId' | 'vacancyId' | 'principal'>,
    filename: string,
  ): Promise<IntakeResult> {
    const zip = this.isZipName(filename);
    return this.reject(ctx, filename, {
      code: 'too_large',
      message: `Larger than ${zip ? this.env.MAX_ZIP_MB : this.env.MAX_UPLOAD_MB} MB`,
    });
  }

  /**
   * Everything an upload needs to be true before a byte is accepted: the caller may change the
   * vacancy (403), it is not archived (409), candidates were told AI assists (409), and the
   * criteria are frozen (409). Returns the frozen requirement set the screenings use.
   */
  async gate(p: Principal, vid: string): Promise<string> {
    const vac = await this.scope.assertEdit(p, vid);
    if (vac.archivedAt) throw new ConflictException('Restore this vacancy first');
    if (!vac.candidateNoticeConfirmedAt) {
      throw new ConflictException(
        'Confirm that candidates have been informed that AI assists screening before uploading CVs.',
      );
    }
    const frozen = (
      await this.db.query<{ id: string }>(
        `SELECT id FROM requirement_set WHERE vacancy_id = $1 AND frozen_at IS NOT NULL ORDER BY version DESC LIMIT 1`,
        [vid],
      )
    ).rows[0];
    if (!frozen) throw new ConflictException('Freeze the criteria before uploading CVs.');
    return frozen.id;
  }

  /** The item, if it belongs to this vacancy and to a browser batch (an Oracle item is the runner's alone). */
  async itemOf(vid: string, itemId: string) {
    return (
      await this.db.query<{ batchId: string; filename: string; size: number }>(
        `SELECT i.batch_id AS "batchId", i.filename, i.size_bytes::float AS size
           FROM upload_item i JOIN upload_batch b ON b.id = i.batch_id
          WHERE i.id = $1 AND b.vacancy_id = $2 AND i.parent_item_id IS NULL AND b.source = 'browser'`,
        [itemId, vid],
      )
    ).rows[0];
  }

  /** The stored results of a finished item: itself, and for a ZIP its entries too. */
  async storedResults(itemId: string): Promise<IntakeResult[] | null> {
    const own = await this.storedResult(itemId);
    if (!own) return null;
    const kids = await this.db.query<{
      id: string;
      filename: string;
      outcome: UploadOutcome;
      code: string | null;
      message: string | null;
      document_id: string | null;
    }>(
      `SELECT id, filename, outcome, code, message, document_id FROM upload_item
        WHERE parent_item_id = $1 AND outcome IS NOT NULL ORDER BY position`,
      [itemId],
    );
    return [
      own,
      ...kids.rows.map((k) => ({
        filename: k.filename,
        status: k.outcome,
        code: k.code ?? undefined,
        message: k.message ?? undefined,
        documentId: k.document_id ?? undefined,
        itemId: k.id,
      })),
    ];
  }

  // ------------------------------------------------------------------ items

  /**
   * Write a result on the item, only while the item is open (S3-UP-02). Returns whether it wrote,
   * and the result that stands: `r` when it wrote, the stored result when it did not. Rule for every
   * caller: when it did not write, answer with the stored result and add no skip row.
   */
  async finishItem(
    itemId: string | undefined,
    r: IntakeResult,
    tx?: PoolClient,
  ): Promise<{ wrote: boolean; result: IntakeResult }> {
    if (!itemId) return { wrote: true, result: r };
    const q: Queryable = tx ?? this.db;
    const w = await q.query(
      `UPDATE upload_item SET outcome = $2, code = $3, message = $4, document_id = $5, received_at = now()
        WHERE id = $1 AND ${itemOpen(6)}`,
      [
        itemId,
        r.status,
        r.code ?? null,
        r.message?.slice(0, 300) ?? null,
        r.documentId ?? null,
        RETRYABLE_CODES,
      ],
    );
    if (w.rowCount) return { wrote: true, result: r };
    const stored = await this.readItem(itemId, q);
    return { wrote: false, result: stored ?? r };
  }

  /** The item as stored, whatever its state (null when it does not exist). */
  private async readItem(itemId: string, q: Queryable = this.db): Promise<IntakeResult | null> {
    const it = (
      await q.query<{
        filename: string;
        outcome: UploadOutcome | null;
        code: string | null;
        message: string | null;
        document_id: string | null;
      }>(`SELECT filename, outcome, code, message, document_id FROM upload_item WHERE id = $1`, [
        itemId,
      ])
    ).rows[0];
    if (!it || it.outcome === null) return null;
    return {
      filename: it.filename,
      status: it.outcome,
      code: it.code ?? undefined,
      message: it.message ?? undefined,
      documentId: it.document_id ?? undefined,
      itemId,
    };
  }

  /** Whether the batch of this upload was cancelled ("Stop sending files", S3-UP-05). */
  async batchCancelled(batchId: string | undefined, q: Queryable = this.db): Promise<boolean> {
    if (!batchId) return false;
    return Boolean(
      (
        await q.query(`SELECT 1 FROM upload_batch WHERE id = $1 AND cancelled_at IS NOT NULL`, [
          batchId,
        ])
      ).rowCount,
    );
  }

  /** The answer for an item whose batch was cancelled: closed as `skipped / cancelled`. */
  async closeCancelled(
    ctx: Pick<IntakeCtx, 'itemId'>,
    filename: string,
    tx?: PoolClient,
  ): Promise<IntakeResult> {
    const r: IntakeResult = {
      filename,
      status: 'skipped',
      code: 'cancelled',
      message: 'Cancelled',
      itemId: ctx.itemId,
    };
    return (await this.finishItem(ctx.itemId, r, tx)).result;
  }

  /** The stored result of an item that is already final, or null when it still needs processing. */
  async storedResult(itemId: string): Promise<IntakeResult | null> {
    const it = (
      await this.db.query<{
        filename: string;
        outcome: UploadOutcome | null;
        code: string | null;
        message: string | null;
        document_id: string | null;
      }>(`SELECT filename, outcome, code, message, document_id FROM upload_item WHERE id = $1`, [
        itemId,
      ])
    ).rows[0];
    if (!it || !isFinalItem(it.outcome, it.code)) return null;
    return {
      filename: it.filename,
      status: it.outcome!,
      code: it.code ?? undefined,
      message: it.message ?? undefined,
      documentId: it.document_id ?? undefined,
      itemId,
    };
  }

  /** Reject without reading anything and record it. */
  async reject(
    ctx: Pick<IntakeCtx, 'itemId' | 'vacancyId' | 'principal'>,
    filename: string,
    r: { code: UploadCode | string; message: string; status?: UploadOutcome },
  ): Promise<IntakeResult> {
    const out: IntakeResult = {
      filename,
      status: r.status ?? 'rejected',
      code: r.code,
      message: r.message,
      itemId: ctx.itemId,
    };
    const fin = await this.finishItem(ctx.itemId, out);
    if (!fin.wrote) return fin.result;
    await this.skipRecord(ctx, out);
    return out;
  }

  /**
   * An unexpected error while taking a file in (S3-UP-03): never a 500 and never an item left open.
   * The item becomes `skipped / server_error`, which may be sent again. One log line with the item ID
   * and no file name.
   */
  async serverError(
    ctx: Pick<IntakeCtx, 'itemId' | 'vacancyId' | 'principal'>,
    filename: string,
    e: unknown,
  ): Promise<IntakeResult> {
    this.log.error(
      `intake failed for item ${ctx.itemId ?? '(legacy route)'}: ${(e as Error)?.name ?? 'Error'}`,
    );
    return this.reject(ctx, filename, {
      status: 'skipped',
      code: 'server_error',
      message: 'The server could not process this file',
    });
  }

  /** Skipped files are never dropped silently: keep the list with the vacancy (spec 6.1.4). */
  async skipRecord(
    ctx: Pick<IntakeCtx, 'vacancyId' | 'principal' | 'itemId' | 'label'>,
    r: IntakeResult,
    tx?: PoolClient,
  ): Promise<void> {
    if (r.status === 'queued' || r.status === 'unreadable') return;
    const q: Queryable = tx ?? this.db;
    await q.query(
      `INSERT INTO intake_skip (id, vacancy_id, filename, reason, skipped_by, upload_item_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        newId(),
        ctx.vacancyId,
        (ctx.label ?? r.filename).slice(0, 300),
        (r.message ?? 'Skipped').slice(0, 300),
        ctx.principal.userId,
        ctx.itemId ?? null,
      ],
    );
  }

  // ------------------------------------------------------------------ a copy from another vacancy

  /**
   * Stage 3, Phase 7 (plan 14.5, decision 1): SenAI's "Analyze for this vacancy" copies a CV that is
   * already read in another vacancy. It goes through the same rules as an upload: the upload gate
   * (edit right, not archived, notice confirmed, criteria frozen), the vacancy lock, the CV cap, and
   * the duplicate check on live CVs only (an erased CV with the same bytes does not block it).
   * `record` writes the caller's audit row in the same transaction.
   */
  async admitCopy(
    p: Principal,
    vacancyId: string,
    src: {
      id: string;
      filename: string;
      mime: string;
      size: number;
      sha: string;
      content: Buffer;
      text: string;
      truncated: boolean;
      pageStarts: unknown;
      renditionPdf: Buffer | null;
      renditionState: string | null;
    },
    record: (tx: PoolClient, documentId: string) => Promise<void>,
  ): Promise<string> {
    const setId = await this.gate(p, vacancyId);
    const docId = newId();
    await this.db.withTx(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`intake:${vacancyId}`]);
      const dup = await tx.query(
        `SELECT 1 FROM cv_document WHERE vacancy_id = $1 AND sha256 = $2 AND erased_at IS NULL`,
        [vacancyId, src.sha],
      );
      if (dup.rowCount) throw new ConflictException('This CV is already in this vacancy');
      const live = Number(
        (
          await tx.query<{ n: string }>(
            `SELECT count(*) AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL`,
            [vacancyId],
          )
        ).rows[0]!.n,
      );
      if (live >= this.maxCvs)
        throw new ConflictException(`This vacancy holds at most ${this.maxCvs} CVs`);
      await tx.query(
        `INSERT INTO cv_document
           (id, vacancy_id, filename, mime, size_bytes, sha256, content, text, text_truncated,
            parse_status, uploaded_by, page_starts, copied_from, rendition_pdf, rendition_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'parsed',$10,$11,$12,$13,$14)`,
        [
          docId,
          vacancyId,
          src.filename,
          src.mime,
          src.size,
          src.sha,
          src.content,
          src.text,
          src.truncated,
          p.userId,
          src.pageStarts ? JSON.stringify(src.pageStarts) : null,
          src.id,
          // The pages made for the original come with the copy (S2-BE7).
          src.renditionState === 'ready' ? src.renditionPdf : null,
          src.renditionState === 'ready' ? 'ready' : src.renditionState ? 'pending' : null,
        ],
      );
      await tx.query(
        `INSERT INTO screening (id, document_id, requirement_set_id, state) VALUES ($1,$2,$3,'queued')`,
        [newId(), docId, setId],
      );
      await tx.query(`UPDATE vacancy SET status = 'open' WHERE id = $1 AND status = 'draft'`, [
        vacancyId,
      ]);
      await record(tx, docId);
    });
    this.processor.nudge();
    return docId;
  }

  // ------------------------------------------------------------------ one file

  /** Take one file in (not a ZIP). Takes one permit while its text is read. */
  async admit(ctx: IntakeCtx, filenameIn: string, buf: Buffer): Promise<IntakeResult> {
    return this.admitFile(ctx, filenameIn, buf, false);
  }

  private async admitFile(
    ctx: IntakeCtx,
    filenameIn: string,
    buf: Buffer,
    permitHeld: boolean,
  ): Promise<IntakeResult> {
    const filename = filenameIn.slice(0, 200);
    const early = async (r: Omit<IntakeResult, 'filename' | 'itemId'>) => {
      const out: IntakeResult = { filename, itemId: ctx.itemId, ...r };
      const fin = await this.finishItem(ctx.itemId, out);
      if (!fin.wrote) return fin.result;
      await this.skipRecord(ctx, out);
      return out;
    };
    // A cancelled batch takes nothing more (S3-UP-05).
    if (await this.batchCancelled(ctx.batchId)) return this.closeCancelled(ctx, filename);
    if (buf.length === 0) {
      return early({ status: 'rejected', code: 'empty', message: MSG.empty });
    }
    const kind = sniff(buf, filename);
    if (!kind) {
      const old = /\.doc$/i.test(filename);
      return early({
        status: 'rejected',
        code: old ? 'old_word_format' : 'wrong_type',
        message: old ? MSG.oldWord : MSG.wrongType,
      });
    }
    const hash = sha256(buf);
    const dupOf = async () =>
      (
        await this.db.query<{ id: string }>(
          `SELECT id FROM cv_document WHERE vacancy_id = $1 AND sha256 = $2 AND erased_at IS NULL`,
          [ctx.vacancyId, hash],
        )
      ).rows[0]?.id;
    const dup = await dupOf();
    if (dup) {
      return early({
        status: 'duplicate',
        code: 'duplicate',
        message: MSG.duplicate,
        documentId: dup,
      });
    }

    // Text is read outside any transaction, holding one permit (a ZIP already holds them all).
    let text = '';
    let pageStarts: number[] | null = null;
    let parseStatus: 'parsed' | 'empty' | 'failed' = 'parsed';
    let parseError: string | null = null;
    // S3-INT-04 (5): a Word file whose directory is too big is stored unread (no extraction, no pages).
    const docxRefused = kind === 'docx' && !docxStructureOk(buf);
    const release = permitHeld ? () => undefined : await this.permits.acquire(1);
    try {
      if (docxRefused) throw new Error('docx structure over the limits');
      ({ text, pageStarts } = await extractTextWithPages(buf, kind));
      if (text.length < MIN_READABLE_CHARS) parseStatus = 'empty'; // e.g. a scanned PDF: no OCR in the MVP
    } catch (e) {
      this.log.warn(`parse failed (${kind}): ${(e as Error).message}`);
      parseStatus = 'failed';
      parseError = 'The file could not be read';
    } finally {
      release();
    }
    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) {
      text = text.slice(0, MAX_TEXT_CHARS);
      pageStarts = pageStarts?.filter((o) => o < text.length) ?? null;
    }
    const readable = parseStatus === 'parsed';

    const docId = newId();
    let result: IntakeResult;
    try {
      result = await this.db.withTx(async (tx) => {
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`intake:${ctx.vacancyId}`]);
        // Lock order: the batch row (shared) before the item, as the cancel route updates the batch
        // row first. A cancel either committed before this point or waits until this file is done.
        const cancelled = ctx.batchId
          ? Boolean(
              (
                await tx.query(
                  `SELECT 1 FROM upload_batch WHERE id = $1 AND cancelled_at IS NOT NULL FOR SHARE`,
                  [ctx.batchId],
                )
              ).rowCount,
            )
          : false;
        const must = async (r: IntakeResult) => {
          const fin = await this.finishItem(ctx.itemId, r, tx);
          // The item row is locked and was just checked: a refused write here is a bug. Roll back,
          // so a CV is never stored with a refused item write.
          if (!fin.wrote) throw new ItemRaceError('item write refused under its lock');
        };
        if (ctx.itemId) {
          const it = (
            await tx.query<{
              outcome: UploadOutcome | null;
              code: string | null;
              message: string | null;
              document_id: string | null;
            }>(
              `SELECT outcome, code, message, document_id FROM upload_item WHERE id = $1 FOR UPDATE`,
              [ctx.itemId],
            )
          ).rows[0];
          if (it && isFinalItem(it.outcome, it.code)) {
            return {
              filename,
              status: it.outcome!,
              code: it.code ?? undefined,
              message: it.message ?? undefined,
              documentId: it.document_id ?? undefined,
              itemId: ctx.itemId,
            };
          }
        }
        // S3-INT-04 (3): an import file re-reads its run and the vacancy under the lock. A claim
        // that is no longer the run's writes nothing; a cancel or an archive ends the item cancelled.
        let runStopped = false;
        if (ctx.runId) {
          const run = (
            await tx.query<{ claim_id: string | null; cancel: boolean; archived: boolean }>(
              `SELECT r.claim_id, (r.cancel_requested_at IS NOT NULL OR r.state <> 'running') AS cancel,
                      (v.archived_at IS NOT NULL) AS archived
                 FROM import_run r JOIN vacancy v ON v.id = r.vacancy_id
                WHERE r.id = $1 FOR SHARE OF r, v`,
              [ctx.runId],
            )
          ).rows[0];
          if (!run || (ctx.claimId && run.claim_id !== ctx.claimId)) throw new ClaimLostError();
          runStopped = run.cancel || run.archived;
        }
        if (cancelled || runStopped) {
          const r: IntakeResult = {
            filename,
            status: 'skipped',
            code: 'cancelled',
            message: 'Cancelled',
            itemId: ctx.itemId,
          };
          await must(r);
          return r;
        }
        const again = (
          await tx.query<{ id: string }>(
            `SELECT id FROM cv_document WHERE vacancy_id = $1 AND sha256 = $2 AND erased_at IS NULL`,
            [ctx.vacancyId, hash],
          )
        ).rows[0];
        if (again) {
          const r: IntakeResult = {
            filename,
            status: 'duplicate',
            code: 'duplicate',
            message: MSG.duplicate,
            documentId: again.id,
            itemId: ctx.itemId,
          };
          await must(r);
          await this.skipRecord(ctx, r, tx);
          return r;
        }
        const live = Number(
          (
            await tx.query<{ n: string }>(
              `SELECT count(*) AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL`,
              [ctx.vacancyId],
            )
          ).rows[0]!.n,
        );
        if (live >= this.maxCvs) {
          const r: IntakeResult = {
            filename,
            status: 'skipped',
            code: 'vacancy_full',
            message: `This vacancy holds at most ${this.maxCvs} CVs`,
            itemId: ctx.itemId,
          };
          await must(r);
          await this.skipRecord(ctx, r, tx);
          return r;
        }
        await tx.query(
          `INSERT INTO cv_document
             (id, vacancy_id, filename, mime, size_bytes, sha256, content, text, text_truncated,
              parse_status, parse_error, uploaded_by, page_starts, rendition_state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            docId,
            ctx.vacancyId,
            filename,
            MIME[kind],
            buf.length,
            hash,
            buf,
            readable ? text : null,
            truncated,
            parseStatus,
            parseError,
            ctx.principal.userId,
            readable && pageStarts ? JSON.stringify(pageStarts) : null,
            // A Word file waits for its pages (S2-BE7); everything else has none to make.
            kind === 'docx' && !docxRefused ? 'pending' : null,
          ],
        );
        await tx.query(
          `INSERT INTO screening (id, document_id, requirement_set_id, state) VALUES ($1,$2,$3,$4)`,
          [newId(), docId, ctx.setId, readable ? 'queued' : 'manual'],
        );
        // Spec 6.7: a vacancy becomes Open when its first screening starts.
        await tx.query(`UPDATE vacancy SET status = 'open' WHERE id = $1 AND status = 'draft'`, [
          ctx.vacancyId,
        ]);
        const r: IntakeResult = readable
          ? { filename, status: 'queued', documentId: docId, itemId: ctx.itemId }
          : {
              filename,
              status: 'unreadable',
              code: parseStatus === 'failed' ? 'read_failed' : 'no_text',
              documentId: docId,
              message: MSG.noText,
              itemId: ctx.itemId,
            };
        await must(r);
        await this.audit.record(tx, {
          actorId: ctx.principal.userId,
          actorType: ctx.principal.actorType,
          sourceIp: ctx.ip,
          action: 'document.upload',
          entityType: 'document',
          entityId: docId,
          after: {
            vacancyId: ctx.vacancyId,
            sha256: hash,
            parseStatus,
            ...(ctx.via ? { via: ctx.via, runId: ctx.runId } : {}),
          },
        });
        return r;
      });
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e;
      // Lost a race that the lock did not cover (for example another instance): it is a duplicate.
      const existing = await dupOf();
      result = {
        filename,
        status: 'duplicate',
        code: 'duplicate',
        message: MSG.duplicate,
        documentId: existing,
        itemId: ctx.itemId,
      };
      const fin = await this.finishItem(ctx.itemId, result);
      if (fin.wrote) await this.skipRecord(ctx, result);
      else result = fin.result;
    }
    if (result.status === 'queued') this.processor.nudge();
    return result;
  }

  // ------------------------------------------------------------------ a ZIP

  /**
   * Take in a ZIP (S3-UP-06): `source` is the spooled temp file (a Buffer is accepted for small
   * callers and tests). Its entries are read one at a time and each becomes a child item of the
   * ZIP's item. The ZIP holds ONE permit while it is expanded and its entries reuse it. The ZIP's
   * own item ends as:
   * - `queued` with code `zip` (a container, not a CV);
   * - `skipped / vacancy_full` when some entries did not fit, or `skipped / server_error` when
   *   storing an entry failed, so the recruiter can send it again (finished entries are never done
   *   twice, and only the open entries are redone);
   * - `skipped / cancelled` when the batch was cancelled: the loop checks before each entry.
   */
  async admitZip(
    ctx: IntakeCtx,
    filenameIn: string,
    source: string | Buffer,
  ): Promise<IntakeResult[]> {
    const filename = filenameIn.slice(0, 200);
    const out: IntakeResult[] = [];
    const release = await this.permits.acquire(1);
    try {
      let taken = 0;
      let full = 0;
      let failed = 0;
      let entries = 0;
      let cancelled = false;
      try {
        for await (const e of iterateZip(source, {
          maxEntries: this.maxCvs * 2,
          maxEntryBytes: this.maxFileBytes,
          maxTotalBytes: this.maxZipBytes * 2,
          maxRatio: 200,
        })) {
          if (await this.batchCancelled(ctx.batchId)) {
            cancelled = true;
            break;
          }
          entries++;
          const label = e.kind === 'file' ? e.name : `${filename} › ${e.name}`;
          // A child item per entry, so the entry has its own status in the batch.
          let childId: string | undefined;
          if (ctx.itemId && ctx.batchId) {
            const made = await this.db.query<{ id: string }>(
              `INSERT INTO upload_item (id, batch_id, parent_item_id, position, filename, size_bytes)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (batch_id, parent_item_id, position) DO NOTHING RETURNING id`,
              [
                newId(),
                ctx.batchId,
                ctx.itemId,
                e.index,
                label.slice(0, 300),
                e.kind === 'file' ? e.data.length : 0,
              ],
            );
            childId =
              made.rows[0]?.id ??
              (
                await this.db.query<{ id: string }>(
                  `SELECT id FROM upload_item WHERE batch_id = $1 AND parent_item_id = $2 AND position = $3`,
                  [ctx.batchId, ctx.itemId, e.index],
                )
              ).rows[0]!.id;
            const stored = await this.storedResult(childId);
            if (stored) {
              out.push(stored);
              if (stored.status === 'queued' || stored.status === 'unreadable') taken++;
              continue;
            }
          }
          const child: IntakeCtx = { ...ctx, itemId: childId };
          if (e.kind === 'skipped') {
            out.push(
              await this.reject(child, label, {
                status: 'skipped',
                code: e.code,
                message: e.reason,
              }),
            );
            continue;
          }
          let r: IntakeResult;
          try {
            r = await this.admitFile(child, e.name, e.data, true);
          } catch (err) {
            // Storing this entry failed: the entry may be sent again, and so may the ZIP.
            r = await this.serverError(child, label, err);
          }
          if (r.status === 'queued' || r.status === 'unreadable') taken++;
          if (r.code === 'vacancy_full') full++;
          if (r.code === 'server_error') failed++;
          out.push(r);
        }
      } catch (e) {
        if (!(e instanceof ZipProblem)) throw e;
        const r = await this.reject(ctx, filename, {
          code: 'bad_zip',
          message: e.message,
          status: 'rejected',
        });
        return [r];
      }
      let parent: IntakeResult;
      if (cancelled) {
        parent = await this.closeCancelled(ctx, filename);
      } else if (entries === 0) {
        parent = await this.reject(ctx, filename, {
          status: 'skipped',
          code: 'no_cvs_in_zip',
          message: MSG.noCvsInZip,
        });
      } else if (failed > 0) {
        parent = (
          await this.finishItem(ctx.itemId, {
            filename,
            status: 'skipped',
            code: 'server_error',
            message: 'The server could not process this file',
            itemId: ctx.itemId,
          })
        ).result;
      } else if (full > 0) {
        parent = (
          await this.finishItem(ctx.itemId, {
            filename,
            status: 'skipped',
            code: 'vacancy_full',
            message: `This vacancy holds at most ${this.maxCvs} CVs`,
            itemId: ctx.itemId,
          })
        ).result;
      } else {
        parent = (
          await this.finishItem(ctx.itemId, {
            filename,
            status: 'queued',
            code: 'zip',
            message: `${taken} of ${entries} files taken in`,
            itemId: ctx.itemId,
          })
        ).result;
      }
      // The legacy route has no items: it gets the entries' own results (or the one problem).
      if (ctx.itemId) return [parent, ...out];
      return entries === 0 ? [parent] : out;
    } finally {
      release();
    }
  }
}
