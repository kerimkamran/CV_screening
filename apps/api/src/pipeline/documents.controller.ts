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
import { eraseAssistantForDocument } from '../assistant/assistant-erase';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ENV, type Env } from '../config/env';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { Inject } from '@nestjs/common';
import {
  extractText,
  MAX_TEXT_CHARS,
  MIN_READABLE_CHARS,
  MIME,
  readVacancyDocx,
  sha256,
  sniff,
  VacancyFileProblem,
} from './documents';
import { AdjustmentService } from './adjustments.service';
import { CandidatesService } from './candidates.service';
import { ReportService } from './report.service';
import { ExportService } from './export.service';
import { LinkProblem, LinkReader } from './link-reader';
import { unpackZip, ZipProblem } from './zip-intake';

const HUMAN = ['TA_PARTNER', 'TA_LEAD'] as const;
const MAX_FILES = 50;

export interface UploadOutcome {
  filename: string;
  status: 'queued' | 'duplicate' | 'unreadable' | 'rejected' | 'skipped';
  documentId?: string;
  message?: string;
}

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
      return r;
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

  /** DOC-01..04: bulk upload. Per-file outcomes; one bad file never fails the batch. */
  @Post('vacancies/:id/documents')
  @HttpCode(200)
  async upload(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ): Promise<{ results: UploadOutcome[] }> {
    const vid = parse(ulidSchema, id);
    const vac = await this.scope.assert(p, vid);
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
    if (!req.isMultipart()) throw new BadRequestException('Expected multipart/form-data');

    const results: UploadOutcome[] = [];
    const maxZip = this.env.MAX_ZIP_MB * 1024 * 1024;
    const maxFile = this.env.MAX_UPLOAD_MB * 1024 * 1024;
    const have = Number(
      (
        await this.db.query<{ n: string }>(
          `SELECT count(*) AS n FROM cv_document WHERE vacancy_id = $1`,
          [vid],
        )
      ).rows[0]!.n,
    );
    let room = Math.max(this.env.MAX_RESUMES_PER_RUN - have, 0);
    let n = 0;
    /** Take one resume in, unless the run is full. */
    const take = async (filename: string, buf: Buffer) => {
      if (room <= 0) {
        results.push({
          filename,
          status: 'skipped',
          message: `A run holds at most ${this.env.MAX_RESUMES_PER_RUN} resumes`,
        });
        return;
      }
      const r = await this.ingest(p, vid, frozen.id, filename, buf, req.ip);
      if (r.status === 'queued' || r.status === 'unreadable') room--;
      results.push(r);
    };
    // The part limit is the larger ZIP limit; ordinary files are held to their own limit below.
    for await (const part of req.parts({ limits: { fileSize: maxZip, files: MAX_FILES } })) {
      if (part.type !== 'file') continue;
      n++;
      const filename = (part.filename || 'cv').slice(0, 200);
      const buf = await part.toBuffer();
      const isZip = /\.zip$/i.test(filename) && buf[0] === 0x50 && buf[1] === 0x4b;
      if (part.file.truncated) {
        results.push({
          filename,
          status: 'rejected',
          message: `Larger than ${isZip ? this.env.MAX_ZIP_MB : this.env.MAX_UPLOAD_MB} MB`,
        });
        continue;
      }
      if (isZip) {
        try {
          const u = await unpackZip(buf, {
            maxEntries: this.env.MAX_RESUMES_PER_RUN * 2,
            maxEntryBytes: maxFile,
            maxTotalBytes: maxZip * 2,
            maxRatio: 200,
          });
          for (const s of u.skipped) {
            results.push({
              filename: `${filename} › ${s.name}`,
              status: 'skipped',
              message: s.reason,
            });
          }
          for (const f of u.files) await take(`${f.name}`, f.data);
          if (u.files.length === 0 && u.skipped.length === 0) {
            results.push({
              filename,
              status: 'skipped',
              message: 'No resumes found in this ZIP',
            });
          }
        } catch (e) {
          if (!(e instanceof ZipProblem)) throw e;
          results.push({ filename, status: 'rejected', message: e.message });
        }
        continue;
      }
      if (buf.length > maxFile) {
        results.push({
          filename,
          status: 'rejected',
          message: `Larger than ${this.env.MAX_UPLOAD_MB} MB`,
        });
        continue;
      }
      await take(filename, buf);
    }
    if (n === 0) throw new BadRequestException('No files received');
    // Skipped files are never dropped silently: keep the list with the vacancy (spec 6.1.4).
    const skipped = results.filter((r) => r.status !== 'queued' && r.status !== 'unreadable');
    for (const r of skipped) {
      await this.db.query(
        `INSERT INTO intake_skip (id, vacancy_id, filename, reason, skipped_by) VALUES ($1,$2,$3,$4,$5)`,
        [newId(), vid, r.filename.slice(0, 300), (r.message ?? 'Skipped').slice(0, 300), p.userId],
      );
    }
    return { results };
  }

  /** "3 skipped, see which": every file that was not taken in, and why. */
  @Get('vacancies/:id/skipped')
  async skipped(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    const { rows } = await this.db.query<{ filename: string; reason: string; at: Date }>(
      `SELECT filename, reason, skipped_at AS at FROM intake_skip
        WHERE vacancy_id = $1 ORDER BY skipped_at, id LIMIT 1000`,
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

  private async ingest(
    p: Principal,
    vid: string,
    setId: string,
    filename: string,
    buf: Buffer,
    ip: string,
  ): Promise<UploadOutcome> {
    const kind = sniff(buf, filename);
    if (!kind) {
      return { filename, status: 'rejected', message: 'Only PDF, DOCX and TXT files are accepted' };
    }
    const hash = sha256(buf);
    const dup = await this.db.query<{ id: string }>(
      `SELECT id FROM cv_document WHERE vacancy_id = $1 AND sha256 = $2`,
      [vid, hash],
    );
    if (dup.rows[0]) {
      return {
        filename,
        status: 'duplicate',
        documentId: dup.rows[0].id,
        message: 'Already uploaded for this vacancy',
      };
    }

    let text = '';
    let parseStatus: 'parsed' | 'empty' | 'failed' = 'parsed';
    let parseError: string | null = null;
    try {
      text = await extractText(buf, kind);
      if (text.length < MIN_READABLE_CHARS) parseStatus = 'empty'; // e.g. a scanned PDF: no OCR in the MVP
    } catch (e) {
      this.log.warn(`parse failed (${kind}): ${(e as Error).message}`);
      parseStatus = 'failed';
      parseError = 'The file could not be read';
    }
    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS);
    const readable = parseStatus === 'parsed';

    const docId = newId();
    await this.db.withTx(async (tx) => {
      await tx.query(
        `INSERT INTO cv_document
           (id, vacancy_id, filename, mime, size_bytes, sha256, content, text, text_truncated,
            parse_status, parse_error, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          docId,
          vid,
          filename,
          MIME[kind],
          buf.length,
          hash,
          buf,
          readable ? text : null,
          truncated,
          parseStatus,
          parseError,
          p.userId,
        ],
      );
      await tx.query(
        `INSERT INTO screening (id, document_id, requirement_set_id, state) VALUES ($1,$2,$3,$4)`,
        [newId(), docId, setId, readable ? 'queued' : 'manual'],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'document.upload',
        entityType: 'document',
        entityId: docId,
        after: { vacancyId: vid, sha256: hash, parseStatus },
      });
    });
    return readable
      ? { filename, status: 'queued', documentId: docId }
      : {
          filename,
          status: 'unreadable',
          documentId: docId,
          message: 'No readable text (scanned or protected file). Review the original manually.',
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
    return this.db.withTx(async (tx) => {
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
    });
  }

  @Post('screenings/:id/retry')
  @HttpCode(200)
  async retry(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const sid = parse(ulidSchema, id);
    await this.scope.assertScreening(p, sid);
    const r = await this.db.query(
      `UPDATE screening SET state = 'queued', attempts = 0, run_after = now(), error = NULL
        WHERE id = $1 AND state = 'failed'`,
      [sid],
    );
    if (!r.rowCount) throw new ConflictException('Only failed screenings can be retried');
    return { queued: true };
  }

  /** The original file, for the recruiter's own review. */
  @Get('documents/:id/file')
  async file(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
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
      const r = await tx.query(
        `UPDATE cv_document SET content = NULL, text = NULL, erased_at = now(), erased_by = $2
          WHERE id = $1 AND erased_at IS NULL`,
        [did, p.userId],
      );
      if (!r.rowCount) throw new ConflictException('Already erased');
      await tx.query(
        `DELETE FROM requirement_assessment WHERE screening_id IN (SELECT id FROM screening WHERE document_id = $1)`,
        [did],
      );
      await tx.query(
        `UPDATE screening SET candidate_name = NULL, candidate_email = NULL, summary = NULL,
                state = CASE WHEN state IN ('queued','processing') THEN 'manual'::screening_state ELSE state END
          WHERE document_id = $1`,
        [did],
      );
      // Shared reports must not keep what was erased (spec 6.5).
      const vac = await tx.query<{ vacancy_id: string }>(
        `SELECT vacancy_id FROM cv_document WHERE id = $1`,
        [did],
      );
      await this.reports.scrubDocument(tx, vac.rows[0]!.vacancy_id, did);
      await eraseAssistantForDocument(tx, did);
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
