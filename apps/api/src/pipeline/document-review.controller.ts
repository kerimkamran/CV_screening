import {
  Controller,
  ConflictException,
  Get,
  NotFoundException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { cvStatus, pseudonym, type CvStatus, type Mark, markFromStored } from '@cv/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { CandidateViewService } from './candidate-view.service';
import { PoolService } from './pool.service';

/** What a CV is, from its name: the review screen shows each kind differently. */
export type DocKind = 'pdf' | 'docx' | 'txt';
export const kindOf = (filename: string, mime: string): DocKind =>
  /\.pdf$/i.test(filename) || mime === 'application/pdf'
    ? 'pdf'
    : /\.docx$/i.test(filename) || /wordprocessingml/.test(mime)
      ? 'docx'
      : 'txt';

export type OriginalView = 'pdf' | 'pending' | 'failed' | 'none' | 'unavailable';

/**
 * One CV, in any state (Stage 2, S2-BE5 and S2-BE6): identity, file facts, status and the analysis in
 * one answer keyed by the document id; the resume text; and the original for the recruiter's own
 * eyes. Recruiters and team leads only (decision 6). A CV the person may not see is a 404, never a
 * 403. Every open and every download is written to the audit trail before the bytes are sent.
 */
@Roles('TA_PARTNER', 'TA_LEAD')
@Controller('documents')
export class DocumentReviewController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly pool: PoolService,
    private readonly view: CandidateViewService,
  ) {}

  private async visible(p: Principal, id: string): Promise<string> {
    const did = parse(ulidSchema, id);
    try {
      return (await this.scope.assertDocument(p, did)).vacancyId;
    } catch {
      throw new NotFoundException();
    }
  }

  @Get(':id')
  async one(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const did = parse(ulidSchema, id);
    const vid = await this.visible(p, did);
    const d = (
      await this.db.query<{
        filename: string;
        mime: string;
        size: number;
        uploadedAt: Date;
        erased: boolean;
        hasContent: boolean;
        hasText: boolean;
        parseError: string | null;
        title: string;
        vstatus: string;
        archived: boolean;
        ordinal: number;
        total: number;
      }>(
        `SELECT d.filename, d.mime, d.size_bytes AS size, d.uploaded_at AS "uploadedAt",
                d.erased_at IS NOT NULL AS erased, d.content IS NOT NULL AS "hasContent",
                (d.text IS NOT NULL AND length(d.text) > 0) AS "hasText", d.parse_error AS "parseError",
                v.title, v.status AS vstatus, v.archived_at IS NOT NULL AS archived,
                x.ordinal, x.total
           FROM cv_document d JOIN vacancy v ON v.id = d.vacancy_id
           JOIN (SELECT id, row_number() OVER (ORDER BY uploaded_at, id)::int AS ordinal,
                        count(*) OVER ()::int AS total
                   FROM cv_document WHERE vacancy_id = $2) x ON x.id = d.id
          WHERE d.id = $1`,
        [did, vid],
      )
    ).rows[0];
    if (!d) throw new NotFoundException();

    const sc = (
      await this.db.query<{
        id: string;
        state: 'queued' | 'processing' | 'completed' | 'failed' | 'manual';
        cancelled: boolean;
        band: string | null;
        scored: boolean;
        error: string | null;
        name: string | null;
        knockout: boolean;
        injection: boolean;
      }>(
        `SELECT s.id, s.state, s.cancelled_at IS NOT NULL AS cancelled, s.band, s.score IS NOT NULL AS scored,
                s.error, s.candidate_name AS name, s.knockout_triggered AS knockout,
                s.injection_suspected AS injection
           FROM screening s
          WHERE s.document_id = $1 AND s.requirement_set_id = (
                SELECT q.id FROM requirement_set q WHERE q.vacancy_id = $2 AND q.frozen_at IS NOT NULL
                 ORDER BY q.version DESC LIMIT 1)`,
        [did, vid],
      )
    ).rows[0];

    const status: CvStatus = cvStatus({
      erased: d.erased,
      screening: sc
        ? { state: sc.state, cancelled: sc.cancelled, band: sc.band, scored: sc.scored }
        : null,
    });
    const row = d.erased ? null : await this.pool.rowForDocument(vid, did);
    const analysis = row ? await this.view.report(row) : null;

    const dec = (
      await this.db.query<{
        outcome: string;
        reason: string | null;
        at: Date;
        by: string;
        n: number;
      }>(
        `SELECT x.outcome, x.reason, x.decided_at AS at, u.display_name AS by,
                (SELECT count(*)::int FROM decision y JOIN screening s2 ON s2.id = y.screening_id
                  WHERE s2.document_id = $1) AS n
           FROM decision x JOIN screening s ON s.id = x.screening_id JOIN app_user u ON u.id = x.decided_by
          WHERE s.document_id = $1 ORDER BY x.decided_at DESC, x.id DESC LIMIT 1`,
        [did],
      )
    ).rows[0];
    const decision = {
      mark: (dec ? markFromStored(dec.outcome) : 'new') as Mark,
      note: dec?.reason ?? null,
      version: dec?.n ?? 0,
      decidedAt: dec ? new Date(dec.at).toISOString() : null,
      decidedBy: dec?.by ?? null,
    };

    const kind = kindOf(d.filename, d.mime);
    const view: OriginalView = !d.hasContent
      ? 'unavailable'
      : kind === 'pdf'
        ? 'pdf'
        : kind === 'txt'
          ? 'none'
          : 'unavailable';
    const reason =
      status === 'needs_look'
        ? sc?.knockout
          ? 'A knockout rule matched. A person decides.'
          : sc?.injection
            ? 'The text looked like it contained instructions to the AI. A person should read it.'
            : 'No score could be given. A person should read this CV.'
        : status === 'unreadable'
          ? (d.parseError ?? 'No text could be read from this file.')
          : undefined;
    const name = analysis?.name ?? sc?.name?.trim() ?? null;
    return {
      documentId: did,
      vacancy: { id: vid, title: d.title, status: d.vstatus, archived: d.archived },
      filename: d.filename,
      kind,
      sizeBytes: d.size,
      uploadedAt: new Date(d.uploadedAt).toISOString(),
      name: name || null,
      pseudonym: pseudonym(d.ordinal, d.total),
      pseudonymNo: d.ordinal,
      status,
      statusDetail: {
        error: status === 'failed' ? (sc?.error ?? undefined) : undefined,
        reason,
        retryable: status === 'failed',
      },
      screeningId: sc?.id ?? null,
      // Marks go to a screening that has finished or has no text to read.
      matchId:
        analysis?.matchId ??
        (sc && (sc.state === 'manual' || sc.state === 'completed') ? sc.id : null),
      original: { available: d.hasContent && !d.erased, view },
      text: { available: d.hasText && !d.erased },
      decision,
      analysis,
    };
  }

  @Get(':id/text')
  async text(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const did = parse(ulidSchema, id);
    await this.visible(p, did);
    return this.view.textOf(did);
  }

  /** The original as pages: the PDF itself. Word is shown through its PDF rendition (S2-BE7). */
  @Get(':id/view')
  async open(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const did = parse(ulidSchema, id);
    const vid = await this.visible(p, did);
    const d = (
      await this.db.query<{ filename: string; mime: string; content: Buffer | null }>(
        `SELECT filename, mime, content FROM cv_document WHERE id = $1 AND erased_at IS NULL`,
        [did],
      )
    ).rows[0];
    if (!d?.content) throw new NotFoundException();
    const kind = kindOf(d.filename, d.mime);
    if (kind === 'txt')
      throw new ConflictException({
        message: 'A text file has no pages to show.',
        code: 'NO_PREVIEW',
      });
    if (kind === 'docx')
      throw new ConflictException({
        message: 'This Word file cannot be shown as pages.',
        code: 'RENDITION_FAILED',
      });
    await this.db.withTx((tx) =>
      this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'document.opened',
        entityType: 'document',
        entityId: did,
        after: { as: 'pdf', vacancyId: vid },
      }),
    );
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.filename)}`)
      .header('x-content-type-options', 'nosniff')
      // Even opened directly in a tab, the file may not run anything or load anything.
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('x-frame-options', 'DENY')
      .header('cache-control', 'no-store')
      .send(d.content);
  }
}
