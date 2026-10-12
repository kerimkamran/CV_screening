import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  azCollator,
  EXPERIENCE_RANGES,
  foldText,
  newId,
  VACANCY_STATUSES,
  type ExperienceRange,
  type VacancyStatus,
} from '@cv/shared';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { parse } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { CriteriaSets } from './criteria-sets';
import { LINK_READER } from './link-reader.token';
import { LinkProblem, type LinkReader } from './link-reader';
import { PoolService, type PoolRow } from './pool.service';
import { requirementsInput } from './schemas';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable();

export const vacancyPatch = z
  .object({
    expectedVersion: z.number().int().min(1),
    title: z.string().trim().min(2).max(200).optional(),
    status: z.enum(VACANCY_STATUSES).optional(),
    experienceRange: z.enum(EXPERIENCE_RANGES).optional(),
    department: text(120).optional(),
    location: text(120).optional(),
    openings: z.number().int().min(1).max(1000).nullable().optional(),
    closingDate: date.optional(),
    hiringManager: text(120).optional(),
    notes: text(4000).optional(),
    description: z.string().max(20_000, 'That text is over 20,000 characters.').optional(),
    sourceType: z.enum(['typed', 'pasted', 'file', 'url']).optional(),
    sourceFileName: text(200).optional(),
    linkUrl: z.string().trim().max(2000).nullable().optional(),
    /** Hash of the text the server read from the link (returned by read-link). */
    linkHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    requirements: requirementsInput.optional(),
  })
  .strict();

export interface ListQuery {
  status?: string;
  archived?: string;
  q?: string;
  sort?: string;
  order?: string;
}

export const hashText = (s: string) =>
  createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex');

const httpUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch {
    return false;
  }
};

interface VRow {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  status: VacancyStatus;
  archivedAt: Date | null;
  ownerId: string;
  ownerName: string | null;
  updatedAt: Date;
  createdAt: Date;
  lastAnalysis: Date | null;
  documents: number;
  running: number;
  stopped: number;
  version: number;
  requirementsVersion: number;
}

@Injectable()
export class VacancyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly sets: CriteriaSets,
    private readonly pool: PoolService,
    @Inject(LINK_READER) public links: LinkReader,
  ) {}

  // ------------------------------------------------------------------ list

  /**
   * Vacancies that look like the title being typed (same words, one title inside the other, or most
   * words shared), so a recruiter is asked to use the one already in the system. Closed ones count:
   * a closed vacancy stays a position of the organisation (spec 6.7).
   */
  async similar(p: Principal, title: string) {
    const words = (t: string) =>
      foldText(t)
        .split(' ')
        .filter((w) => w.length > 1);
    const a = words(title);
    if (a.length === 0) return [];
    const ids = await this.scope.visibleIds(p, false);
    if (!ids.length) return [];
    const { rows } = await this.db.query<{
      id: string;
      title: string;
      status: VacancyStatus;
      ownerName: string;
      documents: number;
    }>(
      `SELECT v.id, v.title, v.status, u.display_name AS "ownerName",
              (SELECT count(*)::int FROM cv_document d WHERE d.vacancy_id = v.id AND d.erased_at IS NULL) AS documents
         FROM vacancy v JOIN app_user u ON u.id = v.created_by
        WHERE v.id = ANY($1::char(26)[]) ORDER BY v.updated_at DESC`,
      [ids],
    );
    const sa = new Set(a);
    const flat = a.join(' ');
    return rows
      .map((v) => {
        const b = words(v.title);
        const sb = new Set(b);
        const shared = [...sa].filter((w) => sb.has(w)).length;
        const union = new Set([...sa, ...sb]).size;
        const fb = b.join(' ');
        const same = flat === fb;
        const inside = flat.length >= 4 && (fb.includes(flat) || flat.includes(fb));
        const score = same ? 1 : inside ? 0.9 : shared / union;
        return { ...v, score };
      })
      .filter((v) => v.score >= 0.6)
      .sort((x, y) => y.score - x.score)
      .slice(0, 5)
      .map(({ score: _s, ...v }) => (void _s, v));
  }

  async list(p: Principal, q: ListQuery) {
    const archived = q.archived === 'true';
    const status = (VACANCY_STATUSES as readonly string[]).includes(q.status ?? '')
      ? (q.status as VacancyStatus)
      : null;
    const { rows } = await this.db.query<VRow>(
      `SELECT v.id, v.title, v.department, v.location, v.status, v.archived_at AS "archivedAt",
              v.created_by AS "ownerId", u.display_name AS "ownerName", v.updated_at AS "updatedAt",
              v.created_at AS "createdAt", v.version, v.requirements_version AS "requirementsVersion",
              (SELECT max(sc.completed_at) FROM screening sc JOIN cv_document d ON d.id = sc.document_id
                WHERE d.vacancy_id = v.id) AS "lastAnalysis",
              (SELECT count(*)::int FROM cv_document d WHERE d.vacancy_id = v.id AND d.erased_at IS NULL) AS documents,
              (SELECT count(*)::int FROM screening sc JOIN cv_document d ON d.id = sc.document_id
                WHERE d.vacancy_id = v.id AND d.erased_at IS NULL AND sc.state IN ('queued', 'processing')
                  AND sc.cancelled_at IS NULL) AS running,
              (SELECT count(*)::int FROM screening sc JOIN cv_document d ON d.id = sc.document_id
                WHERE d.vacancy_id = v.id AND d.erased_at IS NULL AND sc.state = 'queued'
                  AND sc.cancelled_at IS NOT NULL) AS stopped
         FROM vacancy v JOIN app_user u ON u.id = v.created_by
        WHERE (v.archived_at IS NOT NULL) = $3::boolean
          AND ($4::vacancy_status IS NULL OR v.status = $4::vacancy_status)
          AND ($2::boolean OR EXISTS (
                SELECT 1 FROM vacancy_access a
                 WHERE a.vacancy_id = v.id AND a.user_id = $1 AND a.revoked_at IS NULL))`,
      [p.userId, this.scope.seesAll(p), archived, status],
    );
    const needle = foldText(q.q ?? '');
    const kept = rows.filter(
      (v) =>
        !needle ||
        foldText(`${v.title} ${v.department ?? ''} ${v.location ?? ''}`).includes(needle),
    );
    const pooled = await this.pool.rows(kept.map((v) => v.id));
    const by = new Map<string, PoolRow[]>();
    for (const r of pooled)
      (by.get(r.vacancyId) ?? by.set(r.vacancyId, []).get(r.vacancyId)!).push(r);

    const items = kept.map((v) => {
      const mine = by.get(v.id) ?? [];
      const tally = (d: string) => mine.filter((r) => r.decision === d).length;
      const lastDecision = mine.reduce(
        (m, r) => (r.decidedAt && r.decidedAt > m ? r.decidedAt : m),
        '',
      );
      const times = [v.updatedAt, v.lastAnalysis]
        .filter(Boolean)
        .map((d) => new Date(d!).toISOString());
      if (lastDecision) times.push(lastDecision);
      return {
        id: v.id,
        title: v.title,
        department: v.department,
        location: v.location,
        status: v.status,
        archived: v.archivedAt !== null,
        owner: { id: v.ownerId, name: v.ownerName },
        canEdit: this.scope.canEdit(p, v.ownerId),
        documents: v.documents,
        analyzed: mine.length,
        outOfDate: mine.filter((r) => r.outOfDate).length,
        strong: mine.filter((r) => r.band === 'strong').length,
        decisions: {
          shortlist: tally('shortlist'),
          maybe: tally('maybe'),
          notNow: tally('not_now'),
        },
        running: v.running,
        stopped: v.stopped,
        version: v.version,
        updatedAt: times.sort().at(-1)!,
        createdAt: new Date(v.createdAt).toISOString(),
      };
    });
    const dir = q.order === 'asc' ? 1 : -1;
    if (q.sort === 'title')
      items.sort((a, b) => azCollator.compare(a.title, b.title) * (q.order === 'desc' ? -1 : 1));
    else
      items.sort(
        (a, b) => dir * a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id),
      );
    return items;
  }

  // ------------------------------------------------------------------ one

  async view(p: Principal, vid: string) {
    await this.scope.assert(p, vid);
    const v = (
      await this.db.query<
        VRow & {
          experienceRange: ExperienceRange;
          openings: number | null;
          closingDate: string | null;
          hiringManager: string | null;
          notes: string | null;
          sourceType: string;
          sourceFileName: string | null;
          linkUrl: string | null;
          linkReadAt: Date | null;
          linkStatus: string | null;
          candidateNoticeConfirmedAt: Date | null;
          updatedByName: string | null;
          legalHold: boolean;
        }
      >(
        `SELECT v.id, v.title, v.department, v.location, v.status, v.archived_at AS "archivedAt",
                v.created_by AS "ownerId", u.display_name AS "ownerName", v.updated_at AS "updatedAt",
                v.created_at AS "createdAt", v.version, v.requirements_version AS "requirementsVersion",
                v.experience_range AS "experienceRange", v.openings,
                to_char(v.closing_date, 'YYYY-MM-DD') AS "closingDate",
                v.hiring_manager AS "hiringManager", v.notes, v.source_type AS "sourceType",
                v.source_file_name AS "sourceFileName", v.link_url AS "linkUrl",
                v.link_read_at AS "linkReadAt", v.link_status AS "linkStatus",
                v.candidate_notice_confirmed_at AS "candidateNoticeConfirmedAt",
                uu.display_name AS "updatedByName", v.legal_hold AS "legalHold"
           FROM vacancy v JOIN app_user u ON u.id = v.created_by LEFT JOIN app_user uu ON uu.id = v.updated_by
          WHERE v.id = $1`,
        [vid],
      )
    ).rows[0];
    if (!v) throw new NotFoundException();
    const jd = (
      await this.db.query<{ body: string }>(
        `SELECT body FROM job_description_version WHERE vacancy_id = $1 ORDER BY version DESC LIMIT 1`,
        [vid],
      )
    ).rows[0];
    const set = (
      await this.db.query<{ id: string; version: number; frozen: boolean }>(
        `SELECT id, version, frozen_at IS NOT NULL AS frozen FROM requirement_set
          WHERE vacancy_id = $1 ORDER BY version DESC LIMIT 1`,
        [vid],
      )
    ).rows[0];
    const requirements = set
      ? (
          await this.db.query(
            `SELECT id, text, classification, weight::float AS weight, rule, extraction_conf AS confidence
               FROM requirement WHERE requirement_set_id = $1 ORDER BY position, id`,
            [set.id],
          )
        ).rows
      : [];
    const rows = await this.pool.rows([vid]);
    const counts = (
      await this.db.query<{ documents: number; running: number; stopped: number; failed: number }>(
        `SELECT (SELECT count(*)::int FROM cv_document d WHERE d.vacancy_id = $1 AND d.erased_at IS NULL) AS documents,
                count(*) FILTER (WHERE sc.state IN ('queued','processing') AND sc.cancelled_at IS NULL)::int AS running,
                count(*) FILTER (WHERE sc.state = 'queued' AND sc.cancelled_at IS NOT NULL)::int AS stopped,
                count(*) FILTER (WHERE sc.state = 'failed')::int AS failed
           FROM screening sc JOIN cv_document d ON d.id = sc.document_id
          WHERE d.vacancy_id = $1 AND d.erased_at IS NULL`,
        [vid],
      )
    ).rows[0]!;
    return {
      id: v.id,
      title: v.title,
      status: v.status,
      archived: v.archivedAt !== null,
      archivedAt: v.archivedAt,
      department: v.department,
      location: v.location,
      experienceRange: v.experienceRange,
      openings: v.openings,
      closingDate: v.closingDate,
      hiringManager: v.hiringManager,
      notes: v.notes,
      description: jd?.body ?? '',
      sourceType: v.sourceType,
      sourceFileName: v.sourceFileName,
      link: v.linkUrl ? { url: v.linkUrl, readAt: v.linkReadAt, status: v.linkStatus } : null,
      requirementsVersion: v.requirementsVersion,
      version: v.version,
      owner: { id: v.ownerId, name: v.ownerName },
      canEdit: this.scope.canEdit(p, v.ownerId),
      candidateNoticeConfirmedAt: v.candidateNoticeConfirmedAt,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      updatedBy: v.updatedByName,
      legalHold: v.legalHold,
      requirements,
      hasDraft: set ? !set.frozen : false,
      hasFrozen: set ? set.frozen || set.version > 1 : false,
      counts: {
        documents: counts.documents,
        analyzed: rows.length,
        outOfDate: rows.filter((r) => r.outOfDate).length,
        strong: rows.filter((r) => r.band === 'strong').length,
        running: counts.running,
        stopped: counts.stopped,
        failed: counts.failed,
        needsLook: Math.max(0, counts.documents - rows.length - counts.running - counts.stopped),
      },
    };
  }

  // ------------------------------------------------------------------ create

  async create(
    p: Principal,
    ip: string | undefined,
    b: { title: string; department?: string | null; location?: string | null; jdText?: string },
  ) {
    return this.db.withTx(async (tx) => {
      let org = (
        await tx.query<{ id: string }>(`SELECT id FROM organization ORDER BY created_at LIMIT 1`)
      ).rows[0]?.id;
      if (!org) {
        org = newId();
        await tx.query(`INSERT INTO organization (id, name) VALUES ($1, 'Azerconnect')`, [org]);
      }
      const id = newId();
      await tx.query(
        `INSERT INTO vacancy (id, org_id, title, department, location, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [id, org, b.title, b.department ?? null, b.location ?? null, p.userId],
      );
      await tx.query(
        `INSERT INTO job_description_version (id, vacancy_id, version, body, source_kind, created_by)
         VALUES ($1,$2,1,$3,'pasted',$4)`,
        [newId(), id, b.jdText ?? '', p.userId],
      );
      await tx.query(
        `INSERT INTO vacancy_access (id, vacancy_id, user_id, granted_by) VALUES ($1,$2,$3,$3)`,
        [newId(), id, p.userId],
      );
      await this.sets.bump(tx, id, p.userId, 'create', [], b.jdText ?? '', null);
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'vacancy.create',
        entityType: 'vacancy',
        entityId: id,
        after: { title: b.title },
      });
      return { id };
    });
  }

  // ------------------------------------------------------------------ update (the Role card's Save)

  async update(p: Principal, vid: string, ip: string | undefined, body: unknown) {
    const b = parse(vacancyPatch, body);
    await this.scope.assertEdit(p, vid);
    if (b.linkUrl && !httpUrl(b.linkUrl))
      throw new BadRequestException('The link must start with http:// or https://');
    await this.db.withTx(async (tx) => {
      const cur = (
        await tx.query<{
          version: number;
          title: string;
          status: VacancyStatus;
          experience_range: ExperienceRange;
          link_url: string | null;
          archived_at: Date | null;
          updated_by_name: string | null;
          updated_at: Date;
          department: string | null;
          location: string | null;
        }>(
          `SELECT v.version, v.title, v.status, v.experience_range, v.link_url, v.archived_at, v.updated_at,
                  v.department, v.location, uu.display_name AS updated_by_name
             FROM vacancy v LEFT JOIN app_user uu ON uu.id = v.updated_by WHERE v.id = $1 FOR UPDATE OF v`,
          [vid],
        )
      ).rows[0];
      if (!cur) throw new NotFoundException();
      if (cur.version !== b.expectedVersion) {
        throw new ConflictException({
          message: `Changed by ${cur.updated_by_name ?? 'someone else'} at ${new Date(cur.updated_at).toISOString().slice(11, 16)}. Reload to see their version.`,
          code: 'STALE_VERSION',
          changedBy: cur.updated_by_name,
          changedAt: cur.updated_at,
          version: cur.version,
        });
      }
      if (cur.archived_at) throw new ConflictException('Restore this vacancy before changing it.');

      const changed: string[] = [];
      const sets: string[] = [];
      const args: unknown[] = [];
      const put = (col: string, v: unknown, name: string, differs = true) => {
        args.push(v);
        sets.push(`${col} = $${args.length}`);
        if (differs) changed.push(name);
      };
      if (b.title !== undefined && b.title !== cur.title) put('title', b.title, 'title');
      if (b.status !== undefined && b.status !== cur.status) put('status', b.status, 'status');
      if (b.department !== undefined)
        put('department', b.department, 'department', b.department !== cur.department);
      if (b.location !== undefined)
        put('location', b.location, 'location', b.location !== cur.location);
      if (b.openings !== undefined) put('openings', b.openings, 'openings');
      if (b.closingDate !== undefined) put('closing_date', b.closingDate, 'closingDate');
      if (b.hiringManager !== undefined) put('hiring_manager', b.hiringManager, 'hiringManager');
      if (b.notes !== undefined) put('notes', b.notes, 'notes');
      if (b.sourceType !== undefined) put('source_type', b.sourceType, 'sourceType', false);
      if (b.sourceFileName !== undefined)
        put('source_file_name', b.sourceFileName, 'sourceFileName', false);
      if (b.linkUrl !== undefined) {
        put('link_url', b.linkUrl, 'link', b.linkUrl !== cur.link_url);
        if (b.linkUrl !== cur.link_url) {
          sets.push(`link_status = NULL`, `link_read_at = NULL`, `link_text_hash = NULL`);
        }
      }
      if (b.linkHash !== undefined) {
        put('link_text_hash', b.linkHash, 'link', false);
        sets.push(`link_status = 'read'`, `link_read_at = now()`);
      }

      // Requirements version: description, experience range and the requirement chips.
      const reqChanges: unknown[] = [];
      const jd = await this.sets.latestJd(tx, vid);
      let description: string | null = null;
      if (b.description !== undefined && b.description.trim() !== (jd?.body ?? '').trim()) {
        const row = await tx.query<{ v: number }>(
          `INSERT INTO job_description_version (id, vacancy_id, version, body, source_kind, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING version AS v`,
          [
            newId(),
            vid,
            (jd?.version ?? 0) + 1,
            b.description.trim(),
            b.sourceType === 'file' ? 'uploaded' : 'pasted',
            p.userId,
          ],
        );
        void row;
        description = b.description.trim();
        reqChanges.push({ field: 'description', from: null, to: null });
        changed.push('description');
      }
      if (b.experienceRange !== undefined && b.experienceRange !== cur.experience_range) {
        put('experience_range', b.experienceRange, 'experience');
        reqChanges.push({ field: 'experience', from: cur.experience_range, to: b.experienceRange });
      }
      if (b.requirements !== undefined) {
        const latest = await this.sets.latest(tx, vid);
        const before = latest ? await this.sets.requirements(tx, latest.id) : [];
        const diff = this.sets.diff(before, b.requirements);
        if (diff.length || !latest) {
          const jdNow = (await this.sets.latestJd(tx, vid))!;
          const setId = await this.sets.draftSet(tx, vid, p.userId, jdNow.id, true);
          await this.sets.replaceRequirements(tx, setId, b.requirements);
          reqChanges.push(...diff);
          if (diff.length) changed.push('requirements');
        } else if (latest && !latest.frozen) {
          // Same chips: keep the draft as it is. Weights and rules edited elsewhere are untouched.
        }
      }
      if (reqChanges.length) {
        const text = description ?? (await this.sets.latestJd(tx, vid))?.body ?? null;
        await this.sets.bump(
          tx,
          vid,
          p.userId,
          'edit',
          reqChanges,
          text,
          b.linkUrl ?? cur.link_url,
        );
      }
      if (!changed.length && !sets.length) return;
      args.push(vid, p.userId);
      await tx.query(
        `UPDATE vacancy SET ${sets.concat(['version = version + 1', 'updated_at = now()', `updated_by = $${args.length}`]).join(', ')}
          WHERE id = $${args.length - 1}`,
        args,
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'vacancy.update',
        entityType: 'vacancy',
        entityId: vid,
        after: { fields: changed },
      });
    });
    return this.view(p, vid);
  }

  // ------------------------------------------------------------------ archive, restore, duplicate

  async archive(p: Principal, vid: string, ip: string | undefined) {
    await this.scope.assertEdit(p, vid);
    await this.db.withTx(async (tx) => {
      await tx.query(`SELECT 1 FROM vacancy WHERE id = $1 FOR UPDATE`, [vid]);
      const running = await tx.query(
        `SELECT 1 FROM screening sc JOIN cv_document d ON d.id = sc.document_id
          WHERE d.vacancy_id = $1 AND sc.state IN ('queued','processing') AND sc.cancelled_at IS NULL LIMIT 1`,
        [vid],
      );
      if (running.rowCount) throw new ConflictException('Stop the running screening first');
      await tx.query(
        `UPDATE vacancy SET archived_at = COALESCE(archived_at, now()), archived_by = $2,
                version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1`,
        [vid, p.userId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'vacancy.archive',
        entityType: 'vacancy',
        entityId: vid,
      });
    });
    return this.view(p, vid);
  }

  async restore(p: Principal, vid: string, ip: string | undefined) {
    await this.scope.assertEdit(p, vid);
    await this.db.withTx(async (tx) => {
      await tx.query(
        `UPDATE vacancy SET archived_at = NULL, archived_by = NULL, version = version + 1,
                updated_at = now(), updated_by = $2 WHERE id = $1`,
        [vid, p.userId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'vacancy.restore',
        entityType: 'vacancy',
        entityId: vid,
      });
    });
    return this.view(p, vid);
  }

  /** "Copy of …": the same requirements and details, no candidates, a draft owned by the caller. */
  async duplicate(p: Principal, vid: string, ip: string | undefined) {
    await this.scope.assert(p, vid);
    const id = await this.db.withTx(async (tx) => {
      const v = (
        await tx.query<{
          org_id: string;
          title: string;
          department: string | null;
          location: string | null;
          experience_range: string;
          openings: number | null;
          hiring_manager: string | null;
          notes: string | null;
        }>(
          `SELECT org_id, title, department, location, experience_range, openings, hiring_manager, notes FROM vacancy WHERE id = $1`,
          [vid],
        )
      ).rows[0]!;
      const jd = await this.sets.latestJd(tx, vid);
      const latest = await this.sets.latest(tx, vid);
      const nid = newId();
      const title = `Copy of ${v.title.replace(/^Copy of /, '')}`.slice(0, 200);
      await tx.query(
        `INSERT INTO vacancy (id, org_id, title, department, location, experience_range, openings,
                              hiring_manager, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          nid,
          v.org_id,
          title,
          v.department,
          v.location,
          v.experience_range,
          v.openings,
          v.hiring_manager,
          v.notes,
          p.userId,
        ],
      );
      const jdId = newId();
      await tx.query(
        `INSERT INTO job_description_version (id, vacancy_id, version, body, source_kind, created_by)
         VALUES ($1,$2,1,$3,'pasted',$4)`,
        [jdId, nid, jd?.body ?? '', p.userId],
      );
      await tx.query(
        `INSERT INTO vacancy_access (id, vacancy_id, user_id, granted_by) VALUES ($1,$2,$3,$3)`,
        [newId(), nid, p.userId],
      );
      if (latest) {
        const setId = await this.sets.draftSet(tx, nid, p.userId, jdId, false);
        await this.sets.copyRequirements(tx, latest.id, setId);
      }
      await this.sets.bump(tx, nid, p.userId, 'create', [], jd?.body ?? '', null);
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'vacancy.duplicate',
        entityType: 'vacancy',
        entityId: nid,
        after: { from: vid },
      });
      return nid;
    });
    return this.view(p, id);
  }

  // ------------------------------------------------------------------ history and runs

  async history(p: Principal, vid: string) {
    await this.scope.assert(p, vid);
    const { rows } = await this.db.query(
      `SELECT h.id, h.requirements_version AS "requirementsVersion", h.cause, h.changes,
              h.description, h.link_url AS "linkUrl", h.changed_at AS "changedAt", u.display_name AS "changedBy"
         FROM vacancy_history h JOIN app_user u ON u.id = h.changed_by
        WHERE h.vacancy_id = $1 ORDER BY h.changed_at DESC, h.id DESC`,
      [vid],
    );
    return rows;
  }

  /** A run is one frozen requirement set: the resumes read against it, and how far that got. */
  async runs(p: Principal, vid: string) {
    await this.scope.assert(p, vid);
    const { rows } = await this.db.query(
      `SELECT rs.id, rs.version, rs.requirements_version AS "requirementsVersion", rs.frozen_at AS "frozenAt",
              count(sc.id)::int AS total,
              count(*) FILTER (WHERE sc.state IN ('completed','failed','manual'))::int AS read,
              count(*) FILTER (WHERE sc.state = 'completed' AND sc.score IS NOT NULL AND sc.band <> 'needs_review')::int AS scored,
              count(*) FILTER (WHERE sc.state IN ('queued','processing') AND sc.cancelled_at IS NULL)::int AS running,
              max(sc.completed_at) AS "finishedAt"
         FROM requirement_set rs
         LEFT JOIN screening sc ON sc.requirement_set_id = rs.id
         LEFT JOIN cv_document d ON d.id = sc.document_id AND d.erased_at IS NULL
        WHERE rs.vacancy_id = $1 AND rs.frozen_at IS NOT NULL
        GROUP BY rs.id ORDER BY rs.version DESC`,
      [vid],
    );
    return rows;
  }

  // ------------------------------------------------------------------ start / re-analyze

  /**
   * "Find the best fit" and "Re-analyze": freeze the draft requirements (if there is one), record
   * the candidate notice, open the vacancy, and queue every resume that has no scoring against the
   * frozen set yet. Decisions are untouched: they belong to the resume, not to a scoring.
   */
  async start(p: Principal, vid: string, ip: string | undefined, confirmNotice: boolean) {
    const v = await this.scope.assert(p, vid);
    if (v.archivedAt) throw new ConflictException('Restore this vacancy first');
    return this.db.withTx(async (tx) => {
      await tx.query(`SELECT 1 FROM vacancy WHERE id = $1 FOR UPDATE`, [vid]);
      if (confirmNotice) {
        await tx.query(
          `UPDATE vacancy SET candidate_notice_confirmed_at = COALESCE(candidate_notice_confirmed_at, now()),
                  candidate_notice_confirmed_by = COALESCE(candidate_notice_confirmed_by, $2) WHERE id = $1`,
          [vid, p.userId],
        );
      }
      const notice = (
        await tx.query<{ ok: boolean }>(
          `SELECT candidate_notice_confirmed_at IS NOT NULL AS ok FROM vacancy WHERE id = $1`,
          [vid],
        )
      ).rows[0]!.ok;
      if (!notice) throw new BadRequestException('Confirm the candidate notice first');
      let latest = await this.sets.latest(tx, vid);
      if (!latest) throw new BadRequestException('Add at least one skill first');
      if (!latest.frozen) {
        const n = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM requirement
            WHERE requirement_set_id = $1 AND classification IN ('mandatory','preferred')`,
          [latest.id],
        );
        if (n.rows[0]!.n < 1) throw new BadRequestException('Add at least one skill first');
        await tx.query(
          `UPDATE requirement_set SET frozen_at = now(),
                  requirements_version = (SELECT requirements_version FROM vacancy WHERE id = $2)
            WHERE id = $1`,
          [latest.id, vid],
        );
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: ip,
          action: 'criteria.freeze',
          entityType: 'requirement_set',
          entityId: latest.id,
          after: { vacancyId: vid, version: latest.version },
        });
        latest = { ...latest, frozen: true };
      }
      const docs = await tx.query<{ id: string }>(
        `SELECT d.id FROM cv_document d
          WHERE d.vacancy_id = $1 AND d.erased_at IS NULL AND d.parse_status = 'parsed'
            AND NOT EXISTS (SELECT 1 FROM screening s WHERE s.document_id = d.id AND s.requirement_set_id = $2)`,
        [vid, latest.id],
      );
      for (const d of docs.rows) {
        await tx.query(
          `INSERT INTO screening (id, document_id, requirement_set_id) VALUES ($1,$2,$3)`,
          [newId(), d.id, latest.id],
        );
      }
      await tx.query(
        `UPDATE vacancy SET status = CASE WHEN status = 'draft' THEN 'open'::vacancy_status ELSE status END,
                updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
        [vid, p.userId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'vacancy.start',
        entityType: 'vacancy',
        entityId: vid,
        after: { queued: docs.rowCount },
      });
      return { queued: docs.rowCount ?? 0 };
    });
  }

  // ------------------------------------------------------------------ link

  /**
   * Read the stored link again (spec 6.7). Without `apply` it only reports: unchanged, changed (with
   * the new text), or unreadable. With `apply` the new text replaces the description.
   */
  async reread(p: Principal, vid: string, ip: string | undefined, apply: boolean) {
    await this.scope.assertEdit(p, vid);
    const v = (
      await this.db.query<{
        link_url: string | null;
        link_text_hash: string | null;
        link_read_at: Date | null;
        version: number;
      }>(`SELECT link_url, link_text_hash, link_read_at, version FROM vacancy WHERE id = $1`, [vid])
    ).rows[0]!;
    if (!v.link_url) throw new BadRequestException('Add a vacancy link first');
    let r;
    try {
      r = await this.links.read(v.link_url);
    } catch (e) {
      if (!(e instanceof LinkProblem)) throw e;
      await this.db.query(`UPDATE vacancy SET link_status = 'unreadable' WHERE id = $1`, [vid]);
      return {
        status: 'unreadable' as const,
        message: "Couldn't read that page. Paste the text instead.",
      };
    }
    const hash = hashText(r.text);
    if (hash === v.link_text_hash)
      return { status: 'unchanged' as const, since: v.link_read_at, words: r.words };
    if (!apply) return { status: 'changed' as const, words: r.words, text: r.text, hash };
    await this.update(p, vid, ip, {
      expectedVersion: v.version,
      description: r.text,
      sourceType: 'url',
      linkHash: hash,
    });
    return { status: 'applied' as const, words: r.words };
  }
}
