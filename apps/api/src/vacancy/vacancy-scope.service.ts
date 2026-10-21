import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VacancyStatus } from '@cv/shared';
import { ENV, type Env } from '../config/env';
import { DbService } from '../db/db.service';
import type { Principal } from '../auth/principal';

export interface VacancyRow {
  id: string;
  title: string;
  candidateNoticeConfirmedAt: Date | null;
  ownerId: string;
  status: VacancyStatus;
  archivedAt: Date | null;
}

/**
 * IAM-04 and design spec 6.10 in one place.
 *
 * Visibility (item 25): with VACANCY_VISIBILITY=all (the default) every recruiter sees every
 * vacancy; with `granted` a TA_PARTNER sees only vacancies granted to them. TA_LEAD and GOVERNANCE
 * always see all. Out of scope is a 404, never a 403, so existence is not disclosed.
 *
 * Changing a vacancy (edit, upload, archive, restore, status): with VACANCY_EDIT=everyone (the
 * default since 21 Oct 2026) every recruiter and team lead who can see it; with `owner` only its
 * owner or a TA_LEAD (6.10). Anyone who can see a vacancy may set decisions on its candidates.
 */
@Injectable()
export class VacancyScope {
  constructor(
    private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  seesAll(p: Principal) {
    return (
      this.env.VACANCY_VISIBILITY === 'all' ||
      p.roles.includes('TA_LEAD') ||
      p.roles.includes('GOVERNANCE')
    );
  }

  canEdit(p: Principal, ownerId: string) {
    if (this.env.VACANCY_EDIT === 'owner')
      return p.userId === ownerId || p.roles.includes('TA_LEAD');
    return p.roles.includes('TA_PARTNER') || p.roles.includes('TA_LEAD');
  }

  async assert(p: Principal, vacancyId: string): Promise<VacancyRow> {
    const { rows } = await this.db.query<VacancyRow>(
      `SELECT v.id, v.title, v.candidate_notice_confirmed_at AS "candidateNoticeConfirmedAt",
              v.created_by AS "ownerId", v.status, v.archived_at AS "archivedAt"
         FROM vacancy v
        WHERE v.id = $1 AND ($3::boolean OR EXISTS (
              SELECT 1 FROM vacancy_access a
               WHERE a.vacancy_id = v.id AND a.user_id = $2 AND a.revoked_at IS NULL))`,
      [vacancyId, p.userId, this.seesAll(p)],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  /** The vacancy, and a 403 with a plain message if the caller may see it but not change it. */
  async assertEdit(p: Principal, vacancyId: string): Promise<VacancyRow> {
    const v = await this.assert(p, vacancyId);
    if (!this.canEdit(p, v.ownerId)) {
      throw new ForbiddenException('Only the owner or a recruiting lead can change this vacancy.');
    }
    return v;
  }

  /** Resolve a screening to its vacancy, applying the same scope. */
  async assertScreening(p: Principal, screeningId: string): Promise<{ vacancyId: string }> {
    const { rows } = await this.db.query<{ vacancy_id: string }>(
      `SELECT d.vacancy_id FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE s.id = $1`,
      [screeningId],
    );
    if (!rows[0]) throw new NotFoundException();
    await this.assert(p, rows[0].vacancy_id);
    return { vacancyId: rows[0].vacancy_id };
  }

  async assertDocument(p: Principal, documentId: string): Promise<{ vacancyId: string }> {
    const { rows } = await this.db.query<{ vacancy_id: string }>(
      `SELECT vacancy_id FROM cv_document WHERE id = $1`,
      [documentId],
    );
    if (!rows[0]) throw new NotFoundException();
    await this.assert(p, rows[0].vacancy_id);
    return { vacancyId: rows[0].vacancy_id };
  }

  /** The ids of every vacancy this person may see, for list queries. */
  async visibleIds(p: Principal, includeArchived: boolean): Promise<string[]> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT v.id FROM vacancy v
        WHERE ($3::boolean OR v.archived_at IS NULL)
          AND ($2::boolean OR EXISTS (
              SELECT 1 FROM vacancy_access a
               WHERE a.vacancy_id = v.id AND a.user_id = $1 AND a.revoked_at IS NULL))`,
      [p.userId, this.seesAll(p), includeArchived],
    );
    return rows.map((r) => r.id);
  }
}
