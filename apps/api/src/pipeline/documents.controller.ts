import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/multipart';
import { eraseDocumentData } from './erase-document';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ENV, type Env } from '../config/env';
import { hashText } from './vacancy.service';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { Inject } from '@nestjs/common';
import { readVacancyDocx, VacancyFileProblem } from './documents';
import { AdjustmentService } from './adjustments.service';
import { CandidatesService } from './candidates.service';
import { ReportService } from './report.service';
import { ExportService } from './export.service';
import { LinkProblem, LinkReader } from './link-reader';
import { IntakeService, type IntakeResult } from './intake.service';
import { ProcessorService } from './processor.service';

const HUMAN = ['TA_PARTNER', 'TA_LEAD'] as const;
const MAX_FILES = 50;

/** Kept for existing imports: a per-file upload result. */
export type UploadOutcome = IntakeResult;

@Roles(...HUMAN)
@Controller()
export class DocumentsController {
  private readonly log = new Logger('documents');
  /** Overridable in tests; production always uses the guarded defaults. */
  links = new LinkReader();

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly xlsx: ExportService,
    private readonly adj: AdjustmentService,
    private readonly candidatesSvc: CandidatesService,
    private readonly reports: ReportService,
    private readonly intake: IntakeService,
    private readonly processor: ProcessorService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Home screen: read the text of a vacancy Word file (one per request). Nothing is stored; the
   * recruiter reviews the text first. One line, one next step, as in the design spec.
   */
  @Post('vacancies/read-document')
  @HttpCode(200)
  async readVacancyFile(@Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Expected multipart/form-data');
    const limit = this.env.MAX_UPLOAD_MB * 1024 * 1024;
    for await (const part of req.parts({ limits: { fileSize: limit, files: 1 } })) {
      if (part.type !== 'file') continue;
      const filename = (part.filename || 'vacancy.docx').slice(0, 200);
      const buf = await part.toBuffer();
      if (part.file.truncated) throw new BadRequestException('That file is over the size limit');
      try {
        const text = await readVacancyDocx(buf, filename);
        return { filename, text, words: text.split(/\s+/).filter(Boolean).length };
      } catch (e) {
        if (e instanceof VacancyFileProblem) throw new BadRequestException(e.message);
        throw e;
      }
    }
    throw new BadRequestException('No file received');
  }

  /**
   * Home screen: read the text of a public vacancy page. The server fetches it (never the browser)
   * with the safeguards in `link-reader.ts`. Nothing is stored; the recruiter reviews the text.
   */
  @Post('vacancies/read-link')
  @HttpCode(200)
  async readVacancyLink(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const { url } = parse(z.object({ url: z.string().trim().min(4).max(2000) }), body);
    try {
      const r = await this.links.read(url);
      await this.audit.record(this.db, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'vacancy.link_read',
        entityType: 'vacancy_link',
        entityId: newId(),
        after: { host: r.host, words: r.words },
      });
      return { ...r, hash: hashText(r.text) };
    } catch (e) {
      if (!(e instanceof LinkProblem)) throw e;
      if (e.kind === 'invalid') throw new BadRequestException(e.message);
      this.log.warn(`vacancy link not read (${e.kind}): ${e.message}`);
      throw new BadRequestException({
        message: "Couldn't read that page. Paste the text instead.",
        code: 'LINK_UNREADABLE',
      });
    }
  }

  /**
   * DOC-01..04: upload. Two shapes share one route:
   * - `?item=<id>`: one file for one upload item (Stage 2). The result is the item's status, a retry
   *   of a finished item returns its stored result, and nothing is processed twice.
   * - no item: the earlier route with up to 50 files, kept for existing clients and scripts.
   * Both go through IntakeService.
   */
  @Post('vacancies/:id/documents')
  @HttpCode(200)
  async upload(
    @Param('id') id: string,
    @Query('item') itemQ: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ): Promise<{ results: IntakeResult[] }> {
    const vid = parse(ulidSchema, id);
    const setId = await this.intake.gate(p, vid);
    if (!req.isMultipart()) throw new BadRequestException('Expected multipart/form-data');
    const ctx = { principal: p, vacancyId: vid, setId, ip: req.ip };
    const maxZip = this.intake.maxZipBytes;
    const maxFile = this.intake.maxFileBytes;

    // The part limit is the larger ZIP limit; the reader below holds each file to its own cap.
    const read = async (part: {
      file: AsyncIterable<Buffer> & { truncated?: boolean };
      filename?: string;
    }) => {
      const filename = (part.filename || 'cv').slice(0, 200);
      const zip = this.intake.isZipName(filename);
      const r = await this.intake.readCapped(part.file, zip ? maxZip : maxFile);
      return { filename, buf: r.buf, tooLarge: r.tooLarge || !!part.file.truncated, zip };
    };
    const take = async (
      c: typeof ctx & { itemId?: string; batchId?: string },
      f: Awaited<ReturnType<typeof read>>,
    ) => {
      if (f.tooLarge) return [await this.intake.rejectTooLarge(c, f.filename)];
      if (f.zip && f.buf[0] === 0x50 && f.buf[1] === 0x4b)
        return this.intake.admitZip(c, f.filename, f.buf);
      return [await this.intake.admit(c, f.filename, f.buf)];
    };

    if (itemQ) {
      const itemId = parse(ulidSchema, itemQ);
      const item = await this.intake.itemOf(vid, itemId);
      if (!item) throw new NotFoundException();
      const c = { ...ctx, itemId, batchId: item.batchId };
      for await (const part of req.parts({ limits: { fileSize: maxZip, files: 1 } })) {
        if (part.type !== 'file') continue;
        const done = await this.intake.storedResults(itemId);
        if (done) {
          part.file.resume(); // nothing to process; let the upload finish
          return { results: done };
        }
        const f = await read(part);
        return { results: await take(c, { ...f, filename: f.filename || item.filename }) };
      }
      throw new BadRequestException('No file received');
    }

    const results: IntakeResult[] = [];
    let n = 0;
    for await (const part of req.parts({ limits: { fileSize: maxZip, files: MAX_FILES } })) {
      if (part.type !== 'file') continue;
      n++;
      results.push(...(await take(ctx, await read(part))));
    }
    if (n === 0) throw new BadRequestException('No files received');
    return { results };
  }

  /** "3 skipped, see which": every file that was not taken in, and why. */
  @Get('vacancies/:id/skipped')
  async skipped(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    // The record is append-only; what is shown is the current picture: each file once (latest
    // reason), and not a file that was uploaded again later and taken in.
    const { rows } = await this.db.query<{ filename: string; reason: string; at: Date }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (COALESCE(s.upload_item_id, s.filename)) s.filename, s.reason, s.skipped_at AS at, s.id
           FROM intake_skip s
          WHERE s.vacancy_id = $1
            AND (s.upload_item_id IS NOT NULL OR NOT EXISTS (
              SELECT 1 FROM cv_document d
               WHERE d.vacancy_id = s.vacancy_id
                 AND d.filename = regexp_replace(s.filename, '^.* › ', '')
                 AND d.uploaded_at > s.skipped_at))
            AND (s.upload_item_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM upload_item i
               WHERE i.id = s.upload_item_id AND i.outcome IN ('queued', 'unreadable')))
          ORDER BY COALESCE(s.upload_item_id, s.filename), s.skipped_at DESC, s.id DESC) x
        ORDER BY at, id LIMIT 1000`,
      [vid],
    );
    return {
      skipped: rows.map((r) => ({
        filename: r.filename,
        reason: r.reason,
        at: new Date(r.at).toISOString(),
      })),
    };
  }

  /** WORK-01: the ranked candidate table for the current frozen criteria. */
  @Get('vacancies/:id/candidates')
  async candidates(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Query('band') band?: string,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    const rows = await this.candidatesSvc.rows(vid);
    const filtered = band ? rows.filter((r) => r.band === band) : rows;
    const counts = {
      total: rows.length,
      queued: rows.filter((r) => r.state === 'queued' || r.state === 'processing').length,
      stopped: rows.filter((r) => r.state === 'stopped').length,
      failed: rows.filter((r) => r.state === 'failed').length,
      manual: rows.filter((r) => r.state === 'manual').length,
      undecided: rows.filter((r) => !r.decision).length,
    };
    const ai = (await this.db.query(`SELECT 1 FROM ai_setting WHERE active_model IS NOT NULL`))
      .rowCount;
    return { counts, aiActive: Boolean(ai), candidates: filtered };
  }

  /**
   * Which names this recruiter has shown in this run (spec 6.2.6). Derived from the audit trail:
   * the latest of "revealed" / "hidden again" per candidate, so it follows the person across
   * devices and nothing extra is stored.
   */
  @Get('vacancies/:id/revealed')
  async revealed(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    return { screeningIds: await this.candidatesSvc.revealedBy(vid, p.userId) };
  }

  /**
   * Design spec 6.3: stop the scan and keep what has been scored. Files already being read finish;
   * the ones still waiting are marked, not deleted, and can be continued.
   */
  @Post('vacancies/:id/stop')
  @HttpCode(200)
  async stop(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    return this.db.withTx(async (tx) => {
      const r = await tx.query(
        `UPDATE screening sc SET cancelled_at = now()
           FROM cv_document d
          WHERE d.id = sc.document_id AND d.vacancy_id = $1
            AND sc.state = 'queued' AND sc.cancelled_at IS NULL`,
        [vid],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'screening.stopped',
        entityType: 'vacancy',
        entityId: vid,
        after: { stopped: r.rowCount },
      });
      return { stopped: r.rowCount };
    });
  }

  /** Undo a stop: the waiting files go back in the queue. */
  @Post('vacancies/:id/continue')
  @HttpCode(200)
  async continueRun(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    return this.db.withTx(async (tx) => {
      const r = await tx.query(
        `UPDATE screening sc SET cancelled_at = NULL, run_after = now()
           FROM cv_document d
          WHERE d.id = sc.document_id AND d.vacancy_id = $1
            AND sc.state = 'queued' AND sc.cancelled_at IS NOT NULL`,
        [vid],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'screening.continued',
        entityType: 'vacancy',
        entityId: vid,
        after: { continued: r.rowCount },
      });
      return { continued: r.rowCount };
    });
  }

  /** Re-queue screenings against the latest frozen criteria for documents that lack one. */
  @Post('vacancies/:id/rescreen')
  @HttpCode(200)
  async rescreen(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    return this.db
      .withTx(async (tx) => {
        const set = (
          await tx.query<{ id: string }>(
            `SELECT id FROM requirement_set WHERE vacancy_id = $1 AND frozen_at IS NOT NULL ORDER BY version DESC LIMIT 1`,
            [vid],
          )
        ).rows[0];
        if (!set) throw new ConflictException('No frozen criteria');
        const docs = await tx.query<{ id: string }>(
          `SELECT d.id FROM cv_document d
          WHERE d.vacancy_id = $1 AND d.erased_at IS NULL AND d.parse_status = 'parsed'
            AND NOT EXISTS (SELECT 1 FROM screening s WHERE s.document_id = d.id AND s.requirement_set_id = $2)`,
          [vid, set.id],
        );
        for (const d of docs.rows) {
          await tx.query(
            `INSERT INTO screening (id, document_id, requirement_set_id) VALUES ($1,$2,$3)`,
            [newId(), d.id, set.id],
          );
        }
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: req.ip,
          action: 'screening.rescreen',
          entityType: 'vacancy',
          entityId: vid,
          after: { queued: docs.rowCount },
        });
        return { queued: docs.rowCount };
      })
      .then((r) => {
        this.processor.nudge();
        return r;
      });
  }

  @Post('screenings/:id/retry')
  @HttpCode(200)
  async retry(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const sid = parse(ulidSchema, id);
    await this.scope.assertScreening(p, sid);
    await this.db.withTx(async (tx) => {
      const r = await tx.query(
        `UPDATE screening SET state = 'queued', attempts = 0, run_after = now(), error = NULL,
                claim_id = NULL, lease_until = NULL
          WHERE id = $1 AND state = 'failed'`,
        [sid],
      );
      if (!r.rowCount) throw new ConflictException('Only failed screenings can be retried');
      // S2-BE4: a retry is on the record, like every other change to a screening.
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'screening.retried',
        entityType: 'screening',
        entityId: sid,
        after: { scope: 'one', count: 1 },
      });
    });
    this.processor.nudge();
    return { queued: true };
  }

  /** The original file, for the recruiter's own review. */
  @Get('documents/:id/file')
  async file(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const did = parse(ulidSchema, id);
    await this.scope.assertDocument(p, did);
    const { rows } = await this.db.query<{
      filename: string;
      mime: string;
      content: Buffer | null;
    }>(`SELECT filename, mime, content FROM cv_document WHERE id = $1`, [did]);
    const d = rows[0];
    if (!d?.content) throw new NotFoundException();
    // Every download is on the audit trail before the bytes leave (Stage 2, decision 5).
    await this.db.withTx((tx) =>
      this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'document.downloaded',
        entityType: 'document',
        entityId: did,
        after: { via: 'file' },
      }),
    );
    void reply
      .header('content-type', d.mime)
      .header(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
      )
      .header('x-content-type-options', 'nosniff')
      .send(d.content);
  }

  /**
   * GDPR Art. 17 / retention: wipes the file, extracted text, AI-extracted identity and quoted
   * evidence. The fact of the decision and its reason remain in the append-only record.
   */
  @Post('documents/:id/erase')
  @HttpCode(200)
  async erase(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const did = parse(ulidSchema, id);
    await this.scope.assertDocument(p, did);
    return this.db.withTx(async (tx) => {
      if (!(await eraseDocumentData(tx, this.reports, did, p.userId)))
        throw new ConflictException('Already erased');
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'document.erase',
        entityType: 'document',
        entityId: did,
      });
      return { erased: true };
    });
  }

  @Get('vacancies/:id/export.xlsx')
  async export(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Res() reply: FastifyReply,
  ) {
    const vid = parse(ulidSchema, id);
    const vac = await this.scope.assert(p, vid);
    const rows = await this.candidatesSvc.rows(vid);
    const buf = await this.xlsx.build(vac.title, vid, rows, p);
    await this.db.withTx((tx) =>
      this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        action: 'vacancy.export',
        entityType: 'vacancy',
        entityId: vid,
        after: { rows: rows.length },
      }),
    );
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="candidates-${vid}.xlsx"`)
      .send(buf);
  }
}
