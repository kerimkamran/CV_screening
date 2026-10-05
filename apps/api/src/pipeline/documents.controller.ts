import {
  BadRequestException,
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
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/multipart';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ENV, type Env } from '../config/env';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { Inject } from '@nestjs/common';
import { extractText, MAX_TEXT_CHARS, MIN_READABLE_CHARS, MIME, sha256, sniff } from './documents';
import { ExportService, type CandidateRow } from './export.service';
import type { Breakdown } from './score';

const HUMAN = ['TA_PARTNER', 'TA_LEAD'] as const;
const MAX_FILES = 50;

export interface UploadOutcome {
  filename: string;
  status: 'queued' | 'duplicate' | 'unreadable' | 'rejected';
  documentId?: string;
  message?: string;
}

@Roles(...HUMAN)
@Controller()
export class DocumentsController {
  private readonly log = new Logger('documents');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly xlsx: ExportService,
    @Inject(ENV) private readonly env: Env,
  ) {}

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
    let n = 0;
    for await (const part of req.parts({
      limits: { fileSize: this.env.MAX_UPLOAD_MB * 1024 * 1024, files: MAX_FILES },
    })) {
      if (part.type !== 'file') continue;
      n++;
      const filename = (part.filename || 'cv').slice(0, 200);
      const buf = await part.toBuffer();
      if (part.file.truncated) {
        results.push({
          filename,
          status: 'rejected',
          message: `Larger than ${this.env.MAX_UPLOAD_MB} MB`,
        });
        continue;
      }
      results.push(await this.ingest(p, vid, frozen.id, filename, buf, req.ip));
    }
    if (n === 0) throw new BadRequestException('No files received');
    return { results };
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
    const rows = await this.rows(vid);
    const filtered = band ? rows.filter((r) => r.band === band) : rows;
    const counts = {
      total: rows.length,
      queued: rows.filter((r) => r.state === 'queued' || r.state === 'processing').length,
      failed: rows.filter((r) => r.state === 'failed').length,
      manual: rows.filter((r) => r.state === 'manual').length,
      undecided: rows.filter((r) => !r.decision).length,
    };
    const ai = (await this.db.query(`SELECT 1 FROM ai_setting WHERE active_model IS NOT NULL`))
      .rowCount;
    return { counts, aiActive: Boolean(ai), candidates: filtered };
  }

  private async rows(vid: string): Promise<CandidateRow[]> {
    const { rows } = await this.db.query<
      Omit<CandidateRow, 'score'> & { score: number | null; breakdown: Breakdown | null }
    >(
      `WITH cur AS (
         SELECT id FROM requirement_set WHERE vacancy_id = $1 AND frozen_at IS NOT NULL ORDER BY version DESC LIMIT 1)
       SELECT sc.id AS "screeningId", d.id AS "documentId", d.filename, d.uploaded_at AS "uploadedAt",
              d.parse_status AS "parseStatus", d.erased_at IS NOT NULL AS erased,
              COALESCE(sc.state::text, 'queued') AS state, sc.candidate_name AS "candidateName", sc.band,
              sc.score::float AS score, sc.breakdown, sc.knockout_triggered AS "knockoutTriggered",
              sc.injection_suspected AS "injectionSuspected", sc.error,
              (SELECT json_build_object('outcome', x.outcome, 'reason', x.reason, 'decidedAt', x.decided_at,
                                        'decidedBy', u.display_name)
                 FROM decision x JOIN app_user u ON u.id = x.decided_by
                WHERE x.screening_id = sc.id ORDER BY x.decided_at DESC, x.id DESC LIMIT 1) AS decision
         FROM cv_document d
         LEFT JOIN screening sc ON sc.document_id = d.id AND sc.requirement_set_id = (SELECT id FROM cur)
        WHERE d.vacancy_id = $1
        ORDER BY sc.score DESC NULLS LAST, d.uploaded_at DESC`,
      [vid],
    );
    // SCORE-03: a score is only ever serialised together with its breakdown.
    return rows.map(({ score, breakdown, ...r }) => ({
      ...r,
      score: score !== null && breakdown ? { value: score, breakdown } : null,
    }));
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
    const rows = await this.rows(vid);
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
