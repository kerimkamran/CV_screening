import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { newId, type UploadCode, type UploadOutcome } from '@cv/shared';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { Semaphore } from '../common/semaphore';
import { ENV, type Env } from '../config/env';
import { DbService, type Queryable } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import {
  extractTextWithPages,
  MAX_TEXT_CHARS,
  MIN_READABLE_CHARS,
  MIME,
  sha256,
  sniff,
} from './documents';
import { ProcessorService } from './processor.service';
import { iterateZip, ZipProblem } from './zip-intake';

/**
 * Taking CVs in (Stage 2, S2-BE2). One place for the rules, shared by the legacy 50-file route, the
 * one-file-per-request item route and SenAI's "Analyze for this vacancy" copy:
 * - a capped reader: bytes beyond the cap are drained, never buffered;
 * - at most INTAKE_MAX_CONCURRENT files being read at once (a ZIP takes every permit);
 * - text is read outside any transaction;
 * - one transaction per file, under a per-vacancy advisory lock, so the duplicate check and the
 *   vacancy cap are race-safe; only LIVE (not erased) documents count;
 * - a unique-violation is a duplicate, never a 500;
 * - a result is written to the upload item in the same transaction, so a retry is idempotent.
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
}

export const MSG = {
  wrongType: 'Only PDF, DOCX and TXT files are accepted',
  oldWord: 'Old Word format: save it as .docx or PDF',
  empty: 'The file is empty',
  duplicate: 'Already uploaded for this vacancy',
  noText: 'No readable text (scanned or protected file). Review the original manually.',
  noCvsInZip: 'No CVs found in this ZIP',
} as const;

/** A stored item outcome that must not be processed again. Retryable: not received, vacancy full. */
export const isFinalItem = (outcome: string | null, code: string | null) =>
  outcome !== null && !(outcome === 'skipped' && code === 'vacancy_full');

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
export class IntakeService {
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

  /** The item, if it belongs to this vacancy. */
  async itemOf(vid: string, itemId: string) {
    return (
      await this.db.query<{ batchId: string; filename: string; size: number }>(
        `SELECT i.batch_id AS "batchId", i.filename, i.size_bytes::float AS size
           FROM upload_item i JOIN upload_batch b ON b.id = i.batch_id
          WHERE i.id = $1 AND b.vacancy_id = $2 AND i.parent_item_id IS NULL`,
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

  /** Write a result on the item (outside a transaction: rejected, duplicate, too large). */
  async finishItem(itemId: string | undefined, r: IntakeResult, tx?: PoolClient): Promise<void> {
    if (!itemId) return;
    const q: Queryable = tx ?? this.db;
    await q.query(
      `UPDATE upload_item SET outcome = $2, code = $3, message = $4, document_id = $5, received_at = now()
        WHERE id = $1`,
      [itemId, r.status, r.code ?? null, r.message?.slice(0, 300) ?? null, r.documentId ?? null],
    );
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
    await this.finishItem(ctx.itemId, out);
    await this.skipRecord(ctx, out);
    return out;
  }

  /** Skipped files are never dropped silently: keep the list with the vacancy (spec 6.1.4). */
  async skipRecord(
    ctx: Pick<IntakeCtx, 'vacancyId' | 'principal' | 'itemId'>,
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
        r.filename.slice(0, 300),
        (r.message ?? 'Skipped').slice(0, 300),
        ctx.principal.userId,
        ctx.itemId ?? null,
      ],
    );
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
      await this.finishItem(ctx.itemId, out);
      await this.skipRecord(ctx, out);
      return out;
    };
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
    const release = permitHeld ? () => undefined : await this.permits.acquire(1);
    try {
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
          await this.finishItem(ctx.itemId, r, tx);
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
          await this.finishItem(ctx.itemId, r, tx);
          await this.skipRecord(ctx, r, tx);
          return r;
        }
        await tx.query(
          `INSERT INTO cv_document
             (id, vacancy_id, filename, mime, size_bytes, sha256, content, text, text_truncated,
              parse_status, parse_error, uploaded_by, page_starts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
        await this.finishItem(ctx.itemId, r, tx);
        await this.audit.record(tx, {
          actorId: ctx.principal.userId,
          actorType: ctx.principal.actorType,
          sourceIp: ctx.ip,
          action: 'document.upload',
          entityType: 'document',
          entityId: docId,
          after: { vacancyId: ctx.vacancyId, sha256: hash, parseStatus },
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
      await this.finishItem(ctx.itemId, result);
      await this.skipRecord(ctx, result);
    }
    if (result.status === 'queued') this.processor.nudge();
    return result;
  }

  // ------------------------------------------------------------------ a ZIP

  /**
   * Take in a ZIP: its entries are read one at a time and each becomes a child item of the ZIP's
   * item. A ZIP takes every permit. The ZIP's own item ends as `queued` with code `zip` (a
   * container, not a CV), or `skipped / vacancy_full` when some entries did not fit, so the
   * recruiter can send it again once there is room (finished entries are never done twice).
   */
  async admitZip(ctx: IntakeCtx, filenameIn: string, buf: Buffer): Promise<IntakeResult[]> {
    const filename = filenameIn.slice(0, 200);
    const out: IntakeResult[] = [];
    const release = await this.permits.acquire(this.permits.size);
    try {
      let taken = 0;
      let full = 0;
      let entries = 0;
      try {
        for await (const e of iterateZip(buf, {
          maxEntries: this.maxCvs * 2,
          maxEntryBytes: this.maxFileBytes,
          maxTotalBytes: this.maxZipBytes * 2,
          maxRatio: 200,
        })) {
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
          const r = await this.admitFile(child, e.name, e.data, true);
          if (r.status === 'queued' || r.status === 'unreadable') taken++;
          if (r.code === 'vacancy_full') full++;
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
      if (entries === 0) {
        parent = await this.reject(ctx, filename, {
          status: 'skipped',
          code: 'no_cvs_in_zip',
          message: MSG.noCvsInZip,
        });
      } else if (full > 0) {
        parent = {
          filename,
          status: 'skipped',
          code: 'vacancy_full',
          message: `This vacancy holds at most ${this.maxCvs} CVs`,
          itemId: ctx.itemId,
        };
        await this.finishItem(ctx.itemId, parent);
      } else {
        parent = {
          filename,
          status: 'queued',
          code: 'zip',
          message: `${taken} of ${entries} files taken in`,
          itemId: ctx.itemId,
        };
        await this.finishItem(ctx.itemId, parent);
      }
      // The legacy route has no items: it gets the entries' own results (or the one problem).
      if (ctx.itemId) return [parent, ...out];
      return entries === 0 ? [parent] : out;
    } finally {
      release();
    }
  }
}
