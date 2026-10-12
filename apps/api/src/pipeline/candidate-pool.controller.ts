import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  GoneException,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  MARKS,
  MARK_LABEL,
  MARK_ORDER,
  POOL_BANDS,
  BAND_LABEL,
  azCollator,
  markToStored,
  newId,
  type Mark,
} from '@cv/shared';
import ExcelJS from 'exceljs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { CandidateViewService } from './candidate-view.service';
import { PoolService, type PoolRow } from './pool.service';
import { mirrorFor } from './mirror';

const NOT_FOUND = 'We could not find this candidate.';
const CURSOR_MINUTES = 15;
const SORTS = ['match', 'updated', 'candidate', 'vacancy', 'decision'] as const;

const list = (s: string | undefined) =>
  s
    ? s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

const query = z.object({
  vacancy: z.string().optional(),
  band: z.string().optional(),
  decision: z.string().optional(),
  outOfDate: z.enum(['true', 'false']).optional(),
  archived: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(SORTS).default('match'),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
});

const markBody = z.object({
  mark: z.enum(MARKS),
  note: z.string().trim().max(2000).nullish(),
  expectedVersion: z.number().int().min(0),
});

const bulkBody = z.object({
  matchIds: z.array(ulidSchema).min(1).max(100),
  mark: z.enum(MARKS),
  note: z.string().trim().max(2000).nullish(),
});

interface Cursor {
  offset: number;
  at: number;
  sig: string;
}
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
const decode = (s: string): Cursor | null => {
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Cursor;
    return typeof c.offset === 'number' && typeof c.at === 'number' ? c : null;
  } catch {
    return null;
  }
};

/**
 * The Candidate pool (Development Plan WP 3.1 to 3.6). Every row is a resume analyzed for one
 * vacancy; the server writes the counts, the order and the marks, and nothing identifying leaves
 * here except through the two recorded reveals.
 */
@Roles('TA_PARTNER', 'TA_LEAD', 'GOVERNANCE')
@Controller('candidates')
export class CandidatePoolController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly pool: PoolService,
    private readonly view: CandidateViewService,
  ) {}

  @Get()
  async list(@Query() raw: unknown, @CurrentPrincipal() p: Principal) {
    const q = parse(query, raw);
    const filtered = await this.select(p, q);
    // The cursor carries the position and when the list was opened; after 15 minutes the list
    // is not continued, because rows may have moved (spec 6.8).
    const sig = JSON.stringify([
      q.vacancy,
      q.band,
      q.decision,
      q.outOfDate,
      q.archived,
      q.q,
      q.sort,
      q.order,
    ]);
    let offset = 0;
    let at = Date.now();
    if (q.cursor) {
      const c = decode(q.cursor);
      if (!c || c.sig !== sig) throw new BadRequestException('This page link is not valid.');
      if (Date.now() - c.at > CURSOR_MINUTES * 60_000) {
        throw new GoneException('This list was opened a while ago. Reload it to continue.');
      }
      offset = c.offset;
      at = c.at;
    }
    const page = filtered.slice(offset, offset + q.limit);
    const next =
      offset + q.limit < filtered.length ? encode({ offset: offset + q.limit, at, sig }) : null;
    const byMark: Record<Mark, number> = { new: 0, shortlist: 0, maybe: 0, not_now: 0 };
    for (const r of filtered) byMark[r.decision]++;
    return {
      rows: page.map(({ skills: _s, ...r }) => (void _s, r)),
      total: filtered.length,
      counts: {
        byMark,
        outOfDate: filtered.filter((r) => r.outOfDate).length,
        strong: filtered.filter((r) => r.band === 'strong').length,
      },
      nextCursor: next,
      asOf: new Date().toISOString(),
    };
  }

  /** The filtered, ordered rows for a query: shared by the list, the Excel export and the summary. */
  private async select(p: Principal, q: z.infer<typeof query>): Promise<PoolRow[]> {
    const ids = await this.scope.visibleIds(p, q.archived === 'true');
    const want = list(q.vacancy);
    const rows = await this.pool.rows(want.length ? ids.filter((i) => want.includes(i)) : ids, {
      withSkills: !!q.q,
    });
    const bands = list(q.band).filter((b) => (POOL_BANDS as readonly string[]).includes(b));
    const marks = list(q.decision).filter((m) => (MARKS as readonly string[]).includes(m));
    const filtered = rows.filter(
      (r) =>
        (q.archived === 'true' || !r.vacancyArchived) &&
        (!bands.length || bands.includes(r.band)) &&
        (!marks.length || marks.includes(r.decision)) &&
        (q.outOfDate === undefined || r.outOfDate === (q.outOfDate === 'true')) &&
        (!q.q || PoolService.matches(r, q.q)),
    );
    const dir =
      (q.order ?? (q.sort === 'match' || q.sort === 'updated' ? 'desc' : 'asc')) === 'asc' ? 1 : -1;
    const cmp = (a: PoolRow, b: PoolRow): number => {
      switch (q.sort) {
        case 'updated':
          return a.updatedAt.localeCompare(b.updatedAt) || PoolService.byMatch(b, a);
        case 'candidate':
          return azCollator.compare(a.label, b.label) || a.documentId.localeCompare(b.documentId);
        case 'vacancy':
          return azCollator.compare(a.vacancyTitle, b.vacancyTitle) || PoolService.byMatch(a, b);
        case 'decision':
          return MARK_ORDER[a.decision] - MARK_ORDER[b.decision] || PoolService.byMatch(a, b);
        default:
          // "match" ascending is the exact reverse of the default order.
          return PoolService.byMatch(b, a);
      }
    };
    filtered.sort((a, b) => dir * cmp(a, b) || a.documentId.localeCompare(b.documentId));

    return filtered;
  }

  /** The filtered pool as a spreadsheet: what is on the screen, not more. */
  @Get('export')
  async exportXlsx(
    @Query() raw: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const q = parse(query, raw);
    const rows = await this.select(p, q);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Candidates');
    ws.columns = [
      { header: 'Candidate', key: 'c', width: 28 },
      { header: 'Vacancy', key: 'v', width: 34 },
      { header: 'Match %', key: 's', width: 10 },
      { header: 'Match', key: 'b', width: 12 },
      { header: 'Must-haves found', key: 'm', width: 18 },
      { header: 'Mark', key: 'd', width: 12 },
      { header: 'Note', key: 'n', width: 40 },
      { header: 'Marked by', key: 'by', width: 20 },
      { header: 'Analyzed', key: 'a', width: 14 },
      { header: 'Out of date', key: 'o', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    // A cell that starts with = + - @ would be run as a formula by a spreadsheet; never let it.
    const safe = (v: string | null) => (v && /^[=+\-@\t\r]/.test(v) ? `'${v}` : (v ?? ''));
    for (const r of rows) {
      ws.addRow({
        c: safe(r.label),
        v: safe(r.vacancyTitle),
        s: Math.round(r.score),
        b: BAND_LABEL[r.band],
        m: `${r.mustFound} of ${r.mustTotal}`,
        d: MARK_LABEL[r.decision],
        n: safe(r.decisionNote),
        by: safe(r.decidedBy),
        a: r.analyzedAt.slice(0, 10),
        o: r.outOfDate ? 'Yes' : '',
      });
    }
    await this.db.withTx((tx) =>
      this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'candidates.exported',
        entityType: 'candidate_pool',
        entityId: p.userId,
        after: { rows: rows.length },
      }),
    );
    res.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('content-disposition', 'attachment; filename="candidates.xlsx"');
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  /** The Shortlist of one vacancy as text for the hiring manager. The recruiter sends it; nothing is sent from here. */
  @Get('shortlist-summary')
  async shortlistSummary(
    @Query('vacancy') vacancy: string | undefined,
    @CurrentPrincipal() p: Principal,
  ) {
    const vid = parse(ulidSchema, vacancy);
    const v = await this.scope.assert(p, vid).catch(() => {
      throw new NotFoundException(NOT_FOUND);
    });
    const rows = (await this.pool.rows([vid]))
      .filter((r) => r.decision === 'shortlist')
      .sort(PoolService.byMatch);
    const date = new Date().toISOString().slice(0, 10);
    const lines = rows.map((r, i) => {
      const flag = r.outOfDate ? ' (scored against earlier requirements)' : '';
      const note = r.decisionNote ? ` Note: ${r.decisionNote}` : '';
      return `${i + 1}. ${r.label}: ${Math.round(r.score)}% (${BAND_LABEL[r.band]}), must-haves ${r.mustFound} of ${r.mustTotal}.${flag}${note}`;
    });
    return {
      vacancy: { id: v.id, title: v.title },
      count: rows.length,
      subject: `Shortlist for ${v.title} (${date})`,
      body: rows.length
        ? `Shortlist for ${v.title}, as of ${date}\n\n${lines.join('\n')}\n\nScores compare each resume with the requirements. They help you read the resumes; they do not decide.`
        : `No candidates are on the Shortlist for ${v.title} yet.`,
    };
  }

  /** A mark: New, Shortlist, Maybe or Not now. Optional note. Undo is a mark that restores the old one. */
  @Put(':matchId/decision')
  @Roles('TA_PARTNER', 'TA_LEAD')
  async mark(
    @Param('matchId') matchId: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const b = parse(markBody, body);
    const sid = parse(ulidSchema, matchId);
    return this.db.withTx((tx) =>
      this.setMark(tx, p, req.ip, sid, b.mark, b.note ?? null, b.expectedVersion),
    );
  }

  /** Up to 100 resumes at once. A row that cannot be changed is reported; the others still are. */
  @Post('decisions')
  @Roles('TA_PARTNER', 'TA_LEAD')
  @HttpCode(200)
  async bulk(@Body() body: unknown, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    const b = parse(bulkBody, body);
    const results: {
      matchId: string;
      ok: boolean;
      version?: number;
      previous?: { mark: Mark; note: string | null; version: number };
      error?: string;
    }[] = [];
    for (const sid of [...new Set(b.matchIds)]) {
      try {
        const r = await this.db.withTx((tx) =>
          this.setMark(tx, p, req.ip, sid, b.mark, b.note ?? null, null),
        );
        results.push({ matchId: sid, ok: true, version: r.version, previous: r.previous });
      } catch (e) {
        const m = (e as { message?: string }).message ?? 'Could not change this row.';
        results.push({ matchId: sid, ok: false, error: m });
      }
    }
    return { results, changed: results.filter((r) => r.ok).length };
  }

  @Get(':matchId/report')
  async report(@Param('matchId') matchId: string, @CurrentPrincipal() p: Principal) {
    const row = await this.resolve(p, parse(ulidSchema, matchId));
    return this.view.report(row);
  }

  @Get(':matchId/resume')
  async resume(@Param('matchId') matchId: string, @CurrentPrincipal() p: Principal) {
    const row = await this.resolve(p, parse(ulidSchema, matchId));
    return this.view.resume(row);
  }

  // ----------------------------------------------------------------------------------------

  /** The pool row for the resume this screening belongs to, or a plain 404 (never a 403). */
  private async resolve(p: Principal, sid: string): Promise<PoolRow> {
    const { rows } = await this.db.query<{ documentId: string; vacancyId: string }>(
      `SELECT d.id AS "documentId", d.vacancy_id AS "vacancyId"
         FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE s.id = $1`,
      [sid],
    );
    const hit = rows[0];
    if (!hit) throw new NotFoundException(NOT_FOUND);
    try {
      await this.scope.assert(p, hit.vacancyId);
    } catch {
      throw new NotFoundException(NOT_FOUND);
    }
    const row = (await this.pool.rows([hit.vacancyId])).find(
      (r) => r.documentId === hit.documentId,
    );
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async setMark(
    tx: Parameters<Parameters<DbService['withTx']>[0]>[0],
    p: Principal,
    ip: string,
    sid: string,
    mark: Mark,
    note: string | null,
    expectedVersion: number | null,
  ) {
    if (p.actorType !== 'human') throw new BadRequestException('Only a person can set a mark.');
    const hit = (
      await tx.query<{
        documentId: string;
        vacancyId: string;
        state: string;
        erased: boolean;
        archived: boolean;
        status: string;
      }>(
        `SELECT d.id AS "documentId", d.vacancy_id AS "vacancyId", s.state, d.erased_at IS NOT NULL AS erased,
                v.archived_at IS NOT NULL AS archived, v.status
           FROM screening s JOIN cv_document d ON d.id = s.document_id JOIN vacancy v ON v.id = d.vacancy_id
          WHERE s.id = $1 FOR UPDATE OF d`,
        [sid],
      )
    ).rows[0];
    if (!hit) throw new NotFoundException(NOT_FOUND);
    try {
      await this.scope.assert(p, hit.vacancyId);
    } catch {
      throw new NotFoundException(NOT_FOUND);
    }
    if (hit.erased) throw new ConflictException('This candidate was erased.');
    if (hit.archived)
      throw new ConflictException('This vacancy is archived. Restore it to change marks.');
    if (hit.state !== 'completed')
      throw new ConflictException('This resume is still being analyzed.');

    const cur = (
      await tx.query<{ outcome: string; reason: string | null; by: string; at: Date; n: number }>(
        `SELECT x.outcome, x.reason, u.display_name AS by, x.decided_at AS at,
                (SELECT count(*)::int FROM decision y JOIN screening s2 ON s2.id = y.screening_id
                  WHERE s2.document_id = $1) AS n
           FROM decision x JOIN screening s ON s.id = x.screening_id JOIN app_user u ON u.id = x.decided_by
          WHERE s.document_id = $1 ORDER BY x.decided_at DESC, x.id DESC LIMIT 1`,
        [hit.documentId],
      )
    ).rows[0];
    const version = cur?.n ?? 0;
    const previous = {
      mark: (cur ? markFromStoredSafe(cur.outcome) : 'new') as Mark,
      note: cur?.reason ?? null,
      version,
    };
    if (expectedVersion !== null && expectedVersion !== version) {
      throw new ConflictException({
        message: cur
          ? `${cur.by} already changed this to ${MARK_LABEL[previous.mark]}.`
          : 'This candidate was changed by someone else.',
        code: 'STALE_VERSION',
        changedBy: cur?.by ?? null,
        changedAt: cur ? new Date(cur.at).toISOString() : null,
        mark: previous.mark,
        version,
      });
    }
    const id = newId();
    await tx.query(
      `INSERT INTO decision (id, screening_id, outcome, reason, decided_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, sid, markToStored(mark), note && note.length ? note : null, p.userId],
    );
    await this.audit.record(tx, {
      actorId: p.userId,
      actorType: 'human',
      sourceIp: ip,
      action: `decision.${markToStored(mark)}`,
      entityType: 'screening',
      entityId: sid,
      after: { decisionId: id, mark, previous: previous.mark },
    });
    // The consistency mirror: private, once per pair, never blocks the mark.
    const mirror = await mirrorFor(
      tx,
      p.userId,
      hit.documentId,
      hit.vacancyId,
      mark,
      note && note.length ? note : null,
    );
    return {
      mark,
      note: note && note.length ? note : null,
      version: version + 1,
      previous,
      ...(mirror ? { mirror } : {}),
    };
  }
}

import { markFromStored } from '@cv/shared';
const markFromStoredSafe = (s: string): Mark => markFromStored(s);
