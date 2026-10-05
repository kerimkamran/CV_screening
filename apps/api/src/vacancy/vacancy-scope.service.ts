import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { Principal } from '../auth/principal';

export interface VacancyRow {
  id: string;
  title: string;
  candidateNoticeConfirmedAt: Date | null;
}

/**
 * IAM-04 in one place. TA_LEAD (and GOVERNANCE for vacancy-level reads) see everything; a
 * TA_PARTNER sees only vacancies granted to them. Out of scope is a 404, never a 403.
 */
@Injectable()
export class VacancyScope {
  constructor(private readonly db: DbService) {}

  seesAll(p: Principal) {
    return p.roles.includes('TA_LEAD') || p.roles.includes('GOVERNANCE');
  }

  async assert(p: Principal, vacancyId: string): Promise<VacancyRow> {
    const { rows } = await this.db.query<VacancyRow>(
      `SELECT v.id, v.title, v.candidate_notice_confirmed_at AS "candidateNoticeConfirmedAt"
         FROM vacancy v
        WHERE v.id = $1 AND ($3::boolean OR EXISTS (
              SELECT 1 FROM vacancy_access a
               WHERE a.vacancy_id = v.id AND a.user_id = $2 AND a.revoked_at IS NULL))`,
      [vacancyId, p.userId, this.seesAll(p)],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
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
}
