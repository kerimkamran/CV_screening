import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  countByStatus,
  cvStatus,
  MAX_ANNOUNCE_FILES,
  newId,
  RETRYABLE_CODES,
  uploadStatus,
  type CvStatus,
  type UploadOutcome,
} from '@cv/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { IntakeService, isFinalItem, itemOpen } from './intake.service';
import { batchReportCsv } from './batch-report';
import { ProcessorService } from './processor.service';

const HUMAN = ['TA_PARTNER', 'TA_LEAD'] as const;

const batchBody = z.object({
  files: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(300),
        path: z.string().max(1000).optional(),
        size: z.number().int().min(0).max(2_000_000_000),
      }),
    )
    .min(1)
    // The cap is checked by hand below: a typed 413 TOO_MANY_FILES, not a zod 400 (S3-UP-01).
    .max(1_000_000),
});

/** The server sentence for the 500-per-upload backstop (Wording key `upload.limit.server`). */
export const tooManyFiles = () =>
  new HttpException(
    { message: `Up to ${MAX_ANNOUNCE_FILES} files per upload.`, code: 'TOO_MANY_FILES' },
    413,
  );

interface ItemRow {
  id: string;
  parentId: string | null;
  position: number;
  filename: string;
  clientPath: string | null;
  size: number;
  outcome: UploadOutcome | null;
  code: string | null;
  message: string | null;
  documentId: string | null;
  receivedAt: Date | null;
  erased: boolean | null;
  state: 'queued' | 'processing' | 'completed' | 'failed' | 'manual' | null;
  cancelled: boolean | null;
  band: string | null;
  scored: boolean | null;
}

/**
 * Upload batches (Stage 2, S2-BE3): the server keeps one record per file the browser announces, so
 * the status of every file survives a reload and a second device. Items carry a status, never a
 * score: a score only appears in the lists and the review screen, together with its breakdown.
 */
@Roles(...HUMAN)
@Controller()
export class UploadBatchesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly intake: IntakeService,
    private readonly processor: ProcessorService,
  ) {}

  /** How full the vacancy is, the file rules, and the latest upload (for the Resumes card). */
  @Get('vacancies/:id/intake')
  async info(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    const used = await this.used(vid);
    const latest = (
      await this.db.query<{
        id: string;
        createdAt: Date;
        createdBy: string;
        createdByName: string;
        fileCount: number;
      }>(
        `SELECT b.id, b.created_at AS "createdAt", b.created_by AS "createdBy",
                u.display_name AS "createdByName", b.file_count AS "fileCount"
           FROM upload_batch b JOIN app_user u ON u.id = b.created_by
          WHERE b.vacancy_id = $1 ORDER BY b.created_at DESC, b.id DESC LIMIT 1`,
        [vid],
      )
    ).rows[0];
    return {
      used,
      limit: this.intake.maxCvs,
      maxFileMb: this.intake.maxFileBytes / 1024 / 1024,
      maxZipMb: this.intake.maxZipBytes / 1024 / 1024,
      accepts: ['.pdf', '.docx', '.txt', '.md', '.zip'],
      latestBatch: latest
        ? {
            id: latest.id,
            createdAt: new Date(latest.createdAt).toISOString(),
            createdBy: latest.createdByName,
            fileCount: latest.fileCount,
            mine: latest.createdBy === p.userId,
          }
        : null,
    };
  }

  /** Announce the files about to be sent. Wrong files and files beyond the room are marked now. */
  @Post('vacancies/:id/upload-batches')
  @HttpCode(201)
  async create(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.intake.gate(p, vid);
    const { files } = parse(batchBody, body);
    // The web never sends more than 500 (it announces a slice); this serves stale tabs and scripts.
    if (files.length > MAX_ANNOUNCE_FILES) throw tooManyFiles();
    const used = await this.used(vid);
    const room = Math.max(this.intake.maxCvs - used, 0);

    const batchId = newId();
    let counted = 0;
    const full = {
      outcome: 'skipped' as UploadOutcome,
      code: 'vacancy_full',
      message: `This vacancy holds at most ${this.intake.maxCvs} CVs`,
    };
    const items = files.map((f, position) => {
      const itemId = newId();
      let pre: { outcome: UploadOutcome; code: string; message: string } | undefined;
      const bad = this.intake.precheck(f.name, f.size);
      if (bad) pre = { outcome: bad.outcome, code: bad.code, message: bad.message };
      // Loose files use the room in announce order. A ZIP does not use a slot (its entries meet the
      // cap when they are taken in); it is marked now only when there is no room at all.
      else if (this.intake.isZipName(f.name)) {
        if (room === 0) pre = full;
      } else if (counted++ >= room) pre = full;
      return { itemId, position, f, pre };
    });

    await this.db.withTx(async (tx) => {
      await tx.query(
        `INSERT INTO upload_batch (id, vacancy_id, created_by, file_count) VALUES ($1,$2,$3,$4)`,
        [batchId, vid, p.userId, files.length],
      );
      await tx.query(
        `INSERT INTO upload_item (id, batch_id, position, filename, client_path, size_bytes, outcome, code, message, received_at)
         SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::bigint[], $7::text[], $8::text[], $9::text[], $10::timestamptz[])`,
        [
          items.map((i) => i.itemId),
          items.map(() => batchId),
          items.map((i) => i.position),
          items.map((i) => i.f.name.slice(0, 300)),
          items.map((i) => i.f.path?.slice(0, 1000) ?? null),
          items.map((i) => i.f.size),
          items.map((i) => i.pre?.outcome ?? null),
          items.map((i) => i.pre?.code ?? null),
          items.map((i) => i.pre?.message ?? null),
          items.map((i) => (i.pre ? new Date().toISOString() : null)),
        ],
      );
      // Nothing is dropped silently: files marked now are on the vacancy's skipped list too.
      const marked = items.filter((i) => i.pre);
      if (marked.length) {
        await tx.query(
          `INSERT INTO intake_skip (id, vacancy_id, filename, reason, skipped_by, upload_item_id)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])`,
          [
            marked.map(() => newId()),
            marked.map(() => vid),
            marked.map((i) => i.f.name.slice(0, 300)),
            marked.map((i) => (i.pre!.message ?? 'Skipped').slice(0, 300)),
            marked.map(() => p.userId),
            marked.map((i) => i.itemId),
          ],
        );
      }
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'upload_batch.created',
        entityType: 'upload_batch',
        entityId: batchId,
        after: { vacancyId: vid, files: files.length, marked: marked.length },
      });
    });

    return {
      batchId,
      items: items.map((i) => ({
        itemId: i.itemId,
        position: i.position,
        ...(i.pre ? { pre: i.pre } : {}),
      })),
      capacity: { used, limit: this.intake.maxCvs, room },
    };
  }

  /**
   * One batch: how many files arrived, and the status of each CV, counted once. `items=0` (counts
   * only, a couple of hundred bytes) is what the waiting screen polls; `items=1` adds the file list
   * and is asked for only while that list is open.
   */
  @Get('upload-batches/:id')
  async batch(
    @Param('id') id: string,
    @Query('items') withItems: string | undefined,
    @CurrentPrincipal() p: Principal,
  ) {
    const bid = parse(ulidSchema, id);
    const b = (
      await this.db.query<{
        id: string;
        vacancyId: string;
        createdAt: Date;
        createdBy: string;
        createdByName: string;
        fileCount: number;
        cancelledAt: Date | null;
      }>(
        `SELECT b.id, b.vacancy_id AS "vacancyId", b.created_at AS "createdAt", b.created_by AS "createdBy",
                u.display_name AS "createdByName", b.file_count AS "fileCount", b.cancelled_at AS "cancelledAt"
           FROM upload_batch b JOIN app_user u ON u.id = b.created_by WHERE b.id = $1`,
        [bid],
      )
    ).rows[0];
    if (!b) throw new NotFoundException();
    await this.scope.assert(p, b.vacancyId);

    const { rows } = await this.db.query<ItemRow>(
      `WITH cur AS (
         SELECT id FROM requirement_set WHERE vacancy_id = $2 AND frozen_at IS NOT NULL ORDER BY version DESC LIMIT 1)
       SELECT i.id, i.parent_item_id AS "parentId", i.position, i.filename, i.client_path AS "clientPath",
              i.size_bytes::float AS size, i.outcome, i.code, i.message, i.document_id AS "documentId",
              i.received_at AS "receivedAt",
              d.erased_at IS NOT NULL AS erased, sc.state, sc.cancelled_at IS NOT NULL AS cancelled,
              sc.band, sc.score IS NOT NULL AS scored
         FROM upload_item i
         LEFT JOIN cv_document d ON d.id = i.document_id AND i.outcome IN ('queued', 'unreadable')
         LEFT JOIN screening sc ON sc.document_id = d.id AND sc.requirement_set_id = (SELECT id FROM cur)
        WHERE i.batch_id = $1
        ORDER BY i.position, i.parent_item_id NULLS FIRST`,
      [bid, b.vacancyId],
    );

    const statusOf = (r: ItemRow): CvStatus =>
      (r.outcome === 'queued' || r.outcome === 'unreadable') && r.documentId
        ? cvStatus({
            erased: r.erased,
            screening: r.state
              ? { state: r.state, cancelled: r.cancelled, band: r.band, scored: r.scored }
              : null,
          })
        : uploadStatus(r.outcome, r.code);

    const top = rows.filter((r) => !r.parentId);
    // A ZIP is a container: its entries carry the statuses, the ZIP itself only "arrived".
    const leaves = rows.filter((r) => r.code !== 'zip');
    const byStatus = countByStatus(leaves.map(statusOf));
    const isCancelled = (r: ItemRow) => r.outcome === 'skipped' && r.code === 'cancelled';
    // Received: every final item except a cancelled one ("Sent 220 of 500" after a stop at 220).
    const received = top.filter((r) => isFinalItem(r.outcome, r.code) && !isCancelled(r)).length;
    const upload = {
      total: b.fileCount,
      received,
      // Not received: empty, or a retryable skip other than "vacancy full" (e.g. server_error).
      notReceived: top.filter(
        (r) =>
          !isFinalItem(r.outcome, r.code) &&
          !(r.outcome === 'skipped' && r.code === 'vacancy_full'),
      ).length,
      vacancyFull: top.filter((r) => r.outcome === 'skipped' && r.code === 'vacancy_full').length,
      cancelled: top.filter(isCancelled).length,
      rejected: leaves.filter((r) => r.outcome === 'rejected').length,
      duplicate: leaves.filter((r) => r.outcome === 'duplicate').length,
    };
    const lastReceivedAt = rows.reduce<Date | null>(
      (m, r) => (r.receivedAt && (!m || r.receivedAt > m) ? r.receivedAt : m),
      null,
    );
    return {
      batch: {
        id: b.id,
        vacancyId: b.vacancyId,
        createdAt: new Date(b.createdAt).toISOString(),
        createdBy: b.createdByName,
        fileCount: b.fileCount,
        mine: b.createdBy === p.userId,
        cancelledAt: b.cancelledAt ? new Date(b.cancelledAt).toISOString() : null,
      },
      lastReceivedAt: lastReceivedAt ? new Date(lastReceivedAt).toISOString() : null,
      counts: { upload, byStatus },
      ...(withItems === '1'
        ? {
            items: rows.map((r) => ({
              itemId: r.id,
              parentItemId: r.parentId,
              position: r.position,
              filename: r.filename,
              clientPath: r.clientPath,
              size: r.size,
              status: statusOf(r),
              code: r.code,
              message: r.message,
              documentId: r.documentId,
              container: r.code === 'zip',
            })),
          }
        : {}),
    };
  }

  /**
   * "Retry failed": put every failed analysis on the current criteria back in the queue (only
   * those: finished CVs are never run again), and say which files still have to be sent.
   */
  @Post('vacancies/:id/retry-failed')
  @HttpCode(200)
  async retryFailed(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assertEdit(p, vid);
    const { batchId, documentId } = parse(
      z.object({ batchId: ulidSchema.optional(), documentId: ulidSchema.optional() }).default({}),
      body ?? {},
    );
    if (batchId) {
      const ok = await this.db.query(
        `SELECT 1 FROM upload_batch WHERE id = $1 AND vacancy_id = $2`,
        [batchId, vid],
      );
      if (!ok.rowCount) throw new NotFoundException();
    }
    const requeued = await this.db.withTx(async (tx) => {
      const r = await tx.query<{ id: string }>(
        `UPDATE screening s SET state = 'queued', attempts = 0, run_after = now(), error = NULL,
                claim_id = NULL, lease_until = NULL
           FROM cv_document d
          WHERE d.id = s.document_id AND d.vacancy_id = $1 AND d.erased_at IS NULL
            AND s.state = 'failed'
            AND s.requirement_set_id = (SELECT id FROM requirement_set
                  WHERE vacancy_id = $1 AND frozen_at IS NOT NULL ORDER BY version DESC LIMIT 1)
            AND ($2::text IS NULL OR d.id IN (SELECT document_id FROM upload_item WHERE batch_id = $2 AND document_id IS NOT NULL))
            AND ($3::text IS NULL OR d.id = $3)
          RETURNING s.id`,
        [vid, batchId ?? null, documentId ?? null],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'screening.retried',
        entityType: 'vacancy',
        entityId: vid,
        after: {
          scope: documentId ? 'one' : batchId ? 'batch' : 'vacancy',
          batchId: batchId ?? null,
          count: r.rowCount,
        },
      });
      return r.rowCount ?? 0;
    });
    if (requeued) this.processor.nudge();

    let resend: { itemId: string; filename: string; size: number }[] = [];
    if (batchId) {
      const room = Math.max(this.intake.maxCvs - (await this.used(vid)), 0);
      // The same open-item rule as the guarded write; a cancelled batch sends nothing again.
      const open = await this.db.query<{
        id: string;
        filename: string;
        size: number;
        outcome: string | null;
        code: string | null;
      }>(
        `SELECT i.id, i.filename, i.size_bytes::float AS size, i.outcome, i.code
           FROM upload_item i JOIN upload_batch b ON b.id = i.batch_id
          WHERE i.batch_id = $1 AND i.parent_item_id IS NULL AND b.cancelled_at IS NULL
            AND ${itemOpen(2).replaceAll('outcome', 'i.outcome').replaceAll('code', 'i.code')}
          ORDER BY i.position`,
        [batchId, RETRYABLE_CODES],
      );
      let full = 0;
      resend = open.rows
        .filter((r) => r.code !== 'vacancy_full' || full++ < room)
        .map((r) => ({ itemId: r.id, filename: r.filename, size: r.size }));
    }
    return { requeued, resend };
  }

  /**
   * "Stop sending files" (S3-UP-05): the batch takes nothing more. Every item that is empty or
   * retryable becomes `skipped / cancelled`; final items are untouched; nothing about the analysis
   * changes (Stop analysis is a different action). Lock order: the batch row first, then the items,
   * so a file being stored either finishes before the cancel or sees it. Idempotent: a second call
   * answers `{cancelled: 0}`, keeps the first time and person, and writes no audit row.
   */
  @Post('upload-batches/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const bid = parse(ulidSchema, id);
    const vid = (
      await this.db.query<{ vacancyId: string }>(
        `SELECT vacancy_id AS "vacancyId" FROM upload_batch WHERE id = $1`,
        [bid],
      )
    ).rows[0]?.vacancyId;
    if (!vid) throw new NotFoundException();
    // Edit right needed; allowed on an archived vacancy (stopping never changes the vacancy).
    await this.scope.assertEdit(p, vid);
    return this.db.withTx(async (tx) => {
      const first = await tx.query(
        `UPDATE upload_batch SET cancelled_at = now(), cancelled_by = $2
          WHERE id = $1 AND cancelled_at IS NULL`,
        [bid, p.userId],
      );
      if (!first.rowCount) return { cancelled: 0 };
      const r = await tx.query(
        `UPDATE upload_item SET outcome = 'skipped', code = 'cancelled', message = 'Cancelled', received_at = now()
          WHERE batch_id = $1 AND ${itemOpen(2)}`,
        [bid, RETRYABLE_CODES],
      );
      const n = r.rowCount ?? 0;
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'upload_batch.cancelled',
        entityType: 'upload_batch',
        entityId: bid,
        after: { vacancyId: vid, cancelled: n },
      });
      return { cancelled: n };
    });
  }

  /**
   * "Download report" (S3-UP-09): one CSV row per row of the batch's Details, as it stands now.
   * Anyone who may read the vacancy may download it; the audit row (counts only) is written before
   * the bytes leave.
   */
  @Get('upload-batches/:id/report.csv')
  async report(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const bid = parse(ulidSchema, id);
    const got = (await this.batch(bid, '1', p)) as Awaited<ReturnType<typeof this.batch>> & {
      items: {
        itemId: string;
        parentItemId: string | null;
        position: number;
        filename: string;
        clientPath: string | null;
        status: CvStatus;
        message: string | null;
        documentId: string | null;
        container: boolean;
      }[];
    };
    const csv = batchReportCsv(
      got.items.map((i) => ({
        id: i.itemId,
        parentId: i.parentItemId,
        position: i.position,
        filename: i.filename,
        clientPath: i.clientPath,
        status: i.status,
        message: i.message,
        documentId: i.documentId,
        container: i.container,
      })),
    );
    const rows = csv.split('\r\n').length - 2;
    await this.audit.record(this.db, {
      actorId: p.userId,
      actorType: p.actorType,
      sourceIp: req.ip,
      action: 'upload_batch.report_downloaded',
      entityType: 'upload_batch',
      entityId: bid,
      after: { vacancyId: got.batch.vacancyId, rows },
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="upload-report-${bid}.csv"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(csv);
  }

  private async used(vid: string): Promise<number> {
    return Number(
      (
        await this.db.query<{ n: string }>(
          `SELECT count(*) AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL`,
          [vid],
        )
      ).rows[0]!.n,
    );
  }
}
