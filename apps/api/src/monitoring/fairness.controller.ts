import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { DbService } from '../db/db.service';
import { detectLanguage, fairnessReport, formatOf, lengthBucket, type FairRow } from './fairness';

/** Aggregate fairness signals for the people responsible for the tool (never individuals). */
@Roles('ADMIN', 'GOVERNANCE')
@Controller('admin/fairness')
export class FairnessController {
  constructor(private readonly db: DbService) {}

  @Get()
  async report() {
    const { rows } = await this.db.query<{
      mime: string;
      len: number;
      head: string | null;
      parse_status: string;
      state: string | null;
      score: number | null;
      band: string | null;
    }>(
      `SELECT d.mime, char_length(coalesce(d.text, '')) AS len, left(d.text, 6000) AS head,
              d.parse_status, sc.state::text AS state, sc.score::float AS score, sc.band::text AS band
         FROM cv_document d LEFT JOIN screening sc ON sc.document_id = d.id
        WHERE d.erased_at IS NULL
        ORDER BY d.uploaded_at DESC LIMIT 20000`,
    );
    const data: FairRow[] = rows
      .filter((r) => r.state !== 'queued' && r.state !== 'processing' && r.state !== 'stopped')
      .map((r) => ({
        language: r.head ? detectLanguage(r.head) : null,
        format: formatOf(r.mime),
        length: r.head ? lengthBucket(r.len) : null,
        scored: r.state === 'completed' && r.score !== null,
        unread: r.parse_status !== 'parsed',
        score: r.score,
        band: r.band,
      }));
    return { generatedAt: new Date().toISOString(), ...fairnessReport(data) };
  }
}
