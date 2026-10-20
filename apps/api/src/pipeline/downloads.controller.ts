import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  GoneException,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { newId, pseudonym } from '@cv/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Public, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { ENV, type Env } from '../config/env';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { kindOf } from './document-review.controller';
import { safeName, uniqueNames, zipLength, ZipStream } from './zip-writer';

export const DOWNLOAD_MAX_FILES = 500;
export const DOWNLOAD_MAX_BYTES = 1024 ** 3;
export const TICKET_SECONDS = 120;

const bodySchema = z.object({ documentIds: z.array(ulidSchema).min(1) });
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** At most N streams at once; the next waits its turn (S2-OPS6). */
export class Gate {
  private running = 0;
  private readonly queue: (() => void)[] = [];
  constructor(readonly max: number) {}
  get inUse() {
    return this.running;
  }
  async take(): Promise<() => void> {
    if (this.running >= this.max) await new Promise<void>((r) => this.queue.push(r));
    else this.running++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.queue.shift();
      if (next) next();
      else this.running--;
    };
  }
}

/** The day in Baku, for archive names. */
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baku' });

/** Tickets the server hands out: the token travels in the URL; only its hash is stored. */
@Controller('downloads')
export class DownloadsController {
  private readonly gate: Gate;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    @Inject(ENV) env: Env,
  ) {
    this.gate = new Gate(env.DOWNLOAD_MAX_CONCURRENT);
  }

  /**
   * "Download CVs" (S2-BE8, S2-FE6). Explicit ids only: "Select all" resolves them on the client, so
   * what is downloaded is exactly what was ticked. CVs the person may not see, or that do not exist,
   * are left out as "not found"; erased ones as "erased".
   */
  @Post()
  @HttpCode(201)
  @Roles('TA_PARTNER', 'TA_LEAD')
  async create(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const ids = [...new Set(parse(bodySchema, body).documentIds)];
    if (ids.length > DOWNLOAD_MAX_FILES)
      throw new HttpException(
        { message: `Up to ${DOWNLOAD_MAX_FILES} CVs per download.`, code: 'DOWNLOAD_TOO_MANY' },
        413,
      );
    const rows = (
      await this.db.query<{
        id: string;
        vacancyId: string;
        title: string;
        erased: boolean;
        has: boolean;
        size: number | null;
        ordinal: number;
        total: number;
      }>(
        `SELECT d.id, d.vacancy_id AS "vacancyId", v.title, d.erased_at IS NOT NULL AS erased,
                d.content IS NOT NULL AS has, octet_length(d.content)::int AS size, x.ordinal, x.total
           FROM cv_document d JOIN vacancy v ON v.id = d.vacancy_id
           JOIN (SELECT id, row_number() OVER (PARTITION BY vacancy_id ORDER BY uploaded_at, id)::int AS ordinal,
                        count(*) OVER (PARTITION BY vacancy_id)::int AS total
                   FROM cv_document
                  WHERE vacancy_id IN (SELECT vacancy_id FROM cv_document WHERE id = ANY($1))) x ON x.id = d.id
          WHERE d.id = ANY($1)`,
        [ids],
      )
    ).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Map<string, boolean>();
    const visible = async (vid: string) => {
      if (!seen.has(vid))
        seen.set(
          vid,
          await this.scope.assert(p, vid).then(
            () => true,
            () => false,
          ),
        );
      return seen.get(vid)!;
    };
    const take: string[] = [];
    const excluded: { documentId: string; label: string | null; reason: 'erased' | 'not_found' }[] =
      [];
    let bytes = 0;
    const vacancies = new Set<string>();
    for (const id of ids) {
      const r = byId.get(id);
      if (!r || !(await visible(r.vacancyId)))
        excluded.push({ documentId: id, label: null, reason: 'not_found' });
      else if (r.erased || !r.has)
        excluded.push({
          documentId: id,
          label: pseudonym(r.ordinal, r.total),
          reason: 'erased',
        });
      else {
        take.push(id);
        bytes += r.size ?? 0;
        vacancies.add(r.title);
      }
    }
    if (take.length === 0)
      throw new ConflictException({
        message: 'None of the chosen CVs can be downloaded.',
        code: 'NOTHING_TO_DOWNLOAD',
        excluded,
      });
    if (bytes > DOWNLOAD_MAX_BYTES)
      throw new HttpException(
        { message: 'Up to 1 GB per download. Choose fewer CVs.', code: 'DOWNLOAD_TOO_LARGE' },
        413,
      );
    const vacancy = vacancies.size === 1 ? [...vacancies][0]! : null;
    const archive = vacancy
      ? `CVs - ${safeName(vacancy, 'zip').replace(/\.zip$/, '')} - ${today()}.zip`
      : `CVs - ${today()}.zip`;
    const token = randomBytes(32).toString('base64url');
    const id = newId();
    const expires = await this.db.withTx(async (tx) => {
      const r = await tx.query<{ expires: Date }>(
        `INSERT INTO download_ticket (id, token_hash, created_by, expires_at, archive_name, document_ids)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, $6) RETURNING expires_at AS expires`,
        [id, sha(token), p.userId, TICKET_SECONDS, archive, take],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'download.requested',
        entityType: 'download_ticket',
        entityId: id,
        after: { files: take.length, bytes, excluded: excluded.length },
      });
      return r.rows[0]!.expires;
    });
    return {
      url: `/downloads/${token}`,
      files: take.length,
      bytes,
      archiveName: archive,
      expiresAt: new Date(expires).toISOString(),
      excluded,
    };
  }

  /**
   * The ZIP itself. No session: the single-use token is the credential (a recorded exception: two
   * minutes, no-referrer, redacted from the logs). Read from one snapshot, so an erase during the
   * stream cannot shorten the body; each file is on the audit trail before its bytes leave.
   */
  @Get(':token')
  @Public()
  async get(@Param('token') raw: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const ok = tokenSchema.safeParse(raw);
    const found = ok.success
      ? (
          await this.db.query<{ id: string; by: string; ids: string[]; archive: string }>(
            `UPDATE download_ticket SET used_at = now()
              WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
              RETURNING id, created_by AS by, document_ids AS ids, archive_name AS archive`,
            [sha(ok.data)],
          )
        ).rows[0]
      : undefined;
    if (!found)
      throw new GoneException({
        message: 'This download link has been used or has expired. Start the download again.',
        code: 'DOWNLOAD_EXPIRED',
      });
    const t = found;
    const release = await this.gate.take();
    try {
      await this.db.withSnapshot(async (q) => {
        const files = (
          await q.query<{ id: string; filename: string; mime: string; at: Date; size: number }>(
            `SELECT id, filename, mime, uploaded_at AS at, octet_length(content)::int AS size
               FROM cv_document
              WHERE id = ANY($1) AND erased_at IS NULL AND content IS NOT NULL
              ORDER BY array_position($1::text[], id::text)`,
            [t.ids],
          )
        ).rows;
        const names = uniqueNames(
          files.map((f) => safeName(f.filename, kindOf(f.filename, f.mime))),
        );
        const length = zipLength(
          files.map((f, i) => ({ name: names[i]!, size: f.size, modified: new Date(f.at) })),
        );
        const zip = new ZipStream();
        let sent = 0;
        const record = (action: string, entityType: string, entityId: string, after: unknown) =>
          this.db.withTx((tx) =>
            this.audit.record(tx, {
              actorId: t.by,
              actorType: 'human',
              sourceIp: req.ip,
              action,
              entityType,
              entityId,
              after,
            }),
          );
        async function* body() {
          for (let i = 0; i < files.length; i++) {
            const f = files[i]!;
            const c = (
              await q.query<{ content: Buffer }>(`SELECT content FROM cv_document WHERE id = $1`, [
                f.id,
              ])
            ).rows[0]!.content;
            await record('document.downloaded', 'document', f.id, { via: 'zip', ticketId: t.id });
            for (const b of zip.add(names[i]!, c, new Date(f.at))) yield b;
            sent++;
          }
          for (const b of zip.finish()) yield b;
        }
        const stream = Readable.from(body(), { objectMode: false });
        void reply
          .header('content-type', 'application/zip')
          .header('content-length', String(length))
          .header(
            'content-disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(t.archive)}`,
          )
          .send(stream);
        await finished(stream).catch(() => undefined);
        await record('download.sent', 'download_ticket', t.id, {
          files: sent,
          of: files.length,
          complete: sent === files.length,
        }).catch(() => undefined);
      });
    } finally {
      release();
    }
  }
}
