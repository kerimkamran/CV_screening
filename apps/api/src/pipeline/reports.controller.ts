import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { newId, type SharedReportSnapshot } from '@cv/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AnyAuthenticated, CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { ReportService } from './report.service';

const HUMAN = ['TA_PARTNER', 'TA_LEAD'] as const;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

const shareSchema = z.object({
  viewerIds: z.array(ulidSchema).min(1).max(50),
  expiresInDays: z.number().int().min(1).max(MAX_DAYS).default(DEFAULT_DAYS),
  includeNames: z.boolean().default(false),
  includeQuotes: z.boolean().default(true),
});

type ShareState = 'active' | 'expired' | 'revoked';
const stateOf = (s: { revoked_at: Date | null; expires_at: Date }): ShareState =>
  s.revoked_at ? 'revoked' : new Date(s.expires_at).getTime() <= Date.now() ? 'expired' : 'active';

/**
 * Design spec 6.5, share link rules. A share is a snapshot, login-only (named people), with an
 * expiry, revocable, and every open is recorded. Viewers need no role: opening a share is the only
 * thing a person without a role can do besides `/me`.
 */
@Controller()
export class ReportsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly reports: ReportService,
  ) {}

  /** People the recruiter can choose from: active, signed-in-capable accounts in the group. */
  @Roles(...HUMAN)
  @Get('reports/people')
  async people(@CurrentPrincipal() p: Principal, @Query('q') q?: string) {
    const term = (q ?? '').trim().slice(0, 80);
    const { rows } = await this.db.query<{ id: string; displayName: string; email: string | null }>(
      `SELECT id, COALESCE(display_name, email, id) AS "displayName", email
         FROM app_user
        WHERE status = 'active' AND actor_kind = 'human' AND id <> $1
          AND ($2 = '' OR display_name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
        ORDER BY lower(COALESCE(display_name, email)) LIMIT 200`,
      [p.userId, term.replace(/[%_\\]/g, '')],
    );
    return { people: rows };
  }

  /** Create a snapshot and share it with named people. */
  @Roles(...HUMAN)
  @Post('vacancies/:id/shares')
  @HttpCode(200)
  async create(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    const b = parse(shareSchema, body);
    const vacancy = await this.scope.assert(p, vid);
    if (p.actorType !== 'human') throw new ForbiddenException('Only a person can share a report');
    const viewerIds = [...new Set(b.viewerIds)];
    const found = await this.db.query<{ id: string }>(
      `SELECT id FROM app_user WHERE id = ANY($1::text[]) AND status = 'active' AND actor_kind = 'human'`,
      [viewerIds],
    );
    if (found.rowCount !== viewerIds.length) {
      throw new ConflictException('One of the chosen people cannot be given access.');
    }
    const me = (
      await this.db.query<{ name: string }>(
        `SELECT COALESCE(display_name, email, id) AS name FROM app_user WHERE id = $1`,
        [p.userId],
      )
    ).rows[0]!;
    const snapshot = await this.reports.build(
      vid,
      vacancy.title,
      { includeNames: b.includeNames, includeQuotes: b.includeQuotes },
      p,
      me.name,
    );
    const shareId = newId();
    const expiresAt = new Date(Date.now() + b.expiresInDays * 86_400_000);
    await this.db.withTx(async (tx) => {
      await tx.query(
        `INSERT INTO report_share (id, vacancy_id, created_by, expires_at, include_names, include_quotes, snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          shareId,
          vid,
          p.userId,
          expiresAt,
          b.includeNames,
          b.includeQuotes,
          JSON.stringify(snapshot),
        ],
      );
      for (const u of viewerIds) {
        await tx.query(`INSERT INTO report_share_viewer (share_id, user_id) VALUES ($1,$2)`, [
          shareId,
          u,
        ]);
      }
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: 'human',
        sourceIp: req.ip,
        action: 'report.shared',
        entityType: 'report_share',
        entityId: shareId,
        after: {
          vacancyId: vid,
          viewers: viewerIds,
          expiresAt: expiresAt.toISOString(),
          includeNames: b.includeNames,
          includeQuotes: b.includeQuotes,
          namesShown: snapshot.candidates.filter((c) => c.name).length,
        },
      });
    });
    return { id: shareId, expiresAt: expiresAt.toISOString() };
  }

  /** The recruiter's view of what has been shared, with who opened it and when. */
  @Roles(...HUMAN)
  @Get('vacancies/:id/shares')
  async list(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    const { rows } = await this.db.query<{
      id: string;
      created_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
      include_names: boolean;
      include_quotes: boolean;
      created_by_name: string;
    }>(
      `SELECT s.id, s.created_at, s.expires_at, s.revoked_at, s.include_names, s.include_quotes,
              COALESCE(u.display_name, u.email) AS created_by_name
         FROM report_share s JOIN app_user u ON u.id = s.created_by
        WHERE s.vacancy_id = $1 ORDER BY s.created_at DESC, s.id DESC LIMIT 50`,
      [vid],
    );
    const ids = rows.map((r) => r.id);
    const viewers = ids.length
      ? (
          await this.db.query<{ share_id: string; id: string; name: string; email: string | null }>(
            `SELECT v.share_id, u.id, COALESCE(u.display_name, u.email) AS name, u.email
               FROM report_share_viewer v JOIN app_user u ON u.id = v.user_id
              WHERE v.share_id = ANY($1::text[]) ORDER BY lower(COALESCE(u.display_name, u.email))`,
            [ids],
          )
        ).rows
      : [];
    const opens = ids.length
      ? (
          await this.db.query<{
            share_id: string;
            name: string;
            opened_at: Date;
            outcome: string;
          }>(
            `SELECT o.share_id, COALESCE(u.display_name, u.email) AS name, o.opened_at, o.outcome
               FROM report_share_open o JOIN app_user u ON u.id = o.user_id
              WHERE o.share_id = ANY($1::text[]) ORDER BY o.opened_at DESC, o.id DESC`,
            [ids],
          )
        ).rows
      : [];
    return {
      shares: rows.map((s) => {
        const mine = opens.filter((o) => o.share_id === s.id);
        return {
          id: s.id,
          createdAt: new Date(s.created_at).toISOString(),
          expiresAt: new Date(s.expires_at).toISOString(),
          revokedAt: s.revoked_at ? new Date(s.revoked_at).toISOString() : null,
          state: stateOf(s),
          sharedBy: s.created_by_name,
          includeNames: s.include_names,
          includeQuotes: s.include_quotes,
          viewers: viewers
            .filter((v) => v.share_id === s.id)
            .map((v) => ({ id: v.id, name: v.name, email: v.email })),
          openCount: mine.filter((o) => o.outcome === 'ok').length,
          opens: mine.slice(0, 20).map((o) => ({
            by: o.name,
            at: new Date(o.opened_at).toISOString(),
            outcome: o.outcome,
          })),
        };
      }),
    };
  }

  @Roles(...HUMAN)
  @Post('shares/:id/revoke')
  @HttpCode(200)
  async revoke(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const sid = parse(ulidSchema, id);
    const s = (
      await this.db.query<{ vacancy_id: string; revoked_at: Date | null }>(
        `SELECT vacancy_id, revoked_at FROM report_share WHERE id = $1`,
        [sid],
      )
    ).rows[0];
    if (!s) throw new NotFoundException();
    await this.scope.assert(p, s.vacancy_id);
    if (s.revoked_at) return { revoked: true };
    await this.db.withTx(async (tx) => {
      await tx.query(
        `UPDATE report_share SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL`,
        [sid, p.userId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'report.revoked',
        entityType: 'report_share',
        entityId: sid,
      });
    });
    return { revoked: true };
  }

  /** What has been shared with me, newest first. Works for an account with no role. */
  @AnyAuthenticated()
  @Get('reports/mine')
  async mine(@CurrentPrincipal() p: Principal) {
    const { rows } = await this.db.query<{
      id: string;
      title: string;
      created_at: Date;
      expires_at: Date;
      shared_by: string;
    }>(
      `SELECT s.id, s.snapshot->>'title' AS title, s.created_at, s.expires_at,
              COALESCE(u.display_name, u.email) AS shared_by
         FROM report_share s
         JOIN report_share_viewer v ON v.share_id = s.id AND v.user_id = $1
         JOIN app_user u ON u.id = s.created_by
        WHERE s.revoked_at IS NULL AND s.expires_at > now()
        ORDER BY s.created_at DESC, s.id DESC LIMIT 100`,
      [p.userId],
    );
    return {
      reports: rows.map((r) => ({
        id: r.id,
        title: r.title,
        sharedBy: r.shared_by,
        sharedAt: new Date(r.created_at).toISOString(),
        expiresAt: new Date(r.expires_at).toISOString(),
      })),
    };
  }

  /**
   * Open a shared report. The link alone is never enough: the signed-in person must be named on
   * it. Every attempt is recorded, including the ones that were refused.
   */
  @AnyAuthenticated()
  @Get('reports/:id')
  async open(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const sid = parse(ulidSchema, id);
    const s = (
      await this.db.query<{
        id: string;
        created_by: string;
        created_at: Date;
        expires_at: Date;
        revoked_at: Date | null;
        include_names: boolean;
        include_quotes: boolean;
        snapshot: SharedReportSnapshot;
        shared_by: string;
        named: boolean;
      }>(
        `SELECT s.id, s.created_by, s.created_at, s.expires_at, s.revoked_at, s.include_names,
                s.include_quotes, s.snapshot, COALESCE(u.display_name, u.email) AS shared_by,
                EXISTS (SELECT 1 FROM report_share_viewer v WHERE v.share_id = s.id AND v.user_id = $2) AS named
           FROM report_share s JOIN app_user u ON u.id = s.created_by
          WHERE s.id = $1`,
        [sid, p.userId],
      )
    ).rows[0];
    if (!s) throw new NotFoundException({ message: 'Report not found', code: 'REPORT_GONE' });
    const log = (outcome: 'ok' | 'denied' | 'expired' | 'revoked') =>
      this.db.query(
        `INSERT INTO report_share_open (id, share_id, user_id, outcome) VALUES ($1,$2,$3,$4)`,
        [newId(), sid, p.userId, outcome],
      );
    if (!s.named && s.created_by !== p.userId) {
      await log('denied');
      throw new ForbiddenException({ message: 'No access to this report', code: 'REPORT_DENIED' });
    }
    const state = stateOf(s);
    if (state !== 'active') {
      await log(state);
      throw new GoneException({ message: 'Report no longer available', code: 'REPORT_GONE' });
    }
    await log('ok');
    return {
      id: s.id,
      sharedBy: s.shared_by,
      sharedAt: new Date(s.created_at).toISOString(),
      expiresAt: new Date(s.expires_at).toISOString(),
      // The internal key used to scrub erased resumes is not for viewers.
      report: {
        ...s.snapshot,
        candidates: s.snapshot.candidates.map(({ documentId: _d, ...c }) => c),
        decisions: s.snapshot.decisions.map(({ documentId: _d, ...c }) => c),
      },
    };
  }
}
