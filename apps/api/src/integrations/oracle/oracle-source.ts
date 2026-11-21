import {
  SourceError,
  type ImportSource,
  type ListPage,
  type SourceApplication,
  type SourceRun,
} from '../import-source';
import { AuthCircuitOpen, OracleConnectionService } from './oracle-connection.service';

/** Oracle flags arrive as booleans or as 'Y'/'N' (to confirm on the Oracle test environment). */
export const flag = (v: unknown) => v === true || v === 'Y' || v === 'y' || v === 'true';
/** State names that mean the applicant withdrew (not documented: to confirm on the test environment). */
export const WITHDRAWN_STATE = /withdraw/i;

/**
 * Stage 3, S3-INT-11 and S3-INT-12: the runner's source for Oracle. One page of applications
 * (call D), then the attachments of each active one (call E); a file through call F. Only active
 * applicants are imported: confirmed, not disqualified, not withdrawn. Only attachments that are
 * files in a CV category count; the newest one is taken.
 */
export class OracleSource implements ImportSource {
  readonly system = 'oracle_hcm' as const;

  constructor(private readonly conns: OracleConnectionService) {}

  private async call<T>(
    run: SourceRun,
    fn: Parameters<OracleConnectionService['call']>[0],
  ): Promise<T> {
    try {
      return (await this.conns.call(fn, run.runId)) as T;
    } catch (e) {
      if (e instanceof AuthCircuitOpen) throw new SourceError('auth');
      throw e;
    }
  }

  async listPage(run: SourceRun, cursor: string | null): Promise<ListPage> {
    const client = this.conns.client;
    const page = await this.call<{ items: Record<string, unknown>[]; hasMore: boolean }>(run, (t) =>
      client.listApplications(t, run.externalId, cursor, run.signal),
    );
    const row = await this.conns.row();
    const categories = new Set(this.conns.settings(row).categories.map((c) => c.toLowerCase()));
    const applications: SourceApplication[] = [];
    for (const it of page.items) {
      const active =
        flag(it['ConfirmedFlag']) &&
        !flag(it['DisqualifiedFlag']) &&
        !WITHDRAWN_STATE.test(String(it['StateName'] ?? ''));
      const app: SourceApplication = {
        applicationId: String(it['JobApplicationId']),
        personId: String(it['CandidatePersonId']),
        appliedAt: it['JobApplicationDate'] ? new Date(String(it['JobApplicationDate'])) : null,
        eligibility: active ? 'active' : 'filtered',
        internal: flag(it['InternalFlag']),
        attachments: [],
      };
      if (active) {
        const atts = await this.call<Record<string, unknown>[]>(run, (t) =>
          client.attachments(t, app.applicationId, run.signal),
        );
        app.attachments = atts
          .filter(
            (a) =>
              (a['DatatypeCode'] === undefined || a['DatatypeCode'] === 'FILE') &&
              categories.has(String(a['CategoryName'] ?? '').toLowerCase()),
          )
          .sort((a, b) =>
            String(b['LastUpdateDate'] ?? '').localeCompare(String(a['LastUpdateDate'] ?? '')),
          )
          .map((a) => ({
            attachmentId: String(a['AttachedDocumentId']),
            fileName: String(a['FileName'] ?? ''),
            size: Number.isFinite(Number(a['UploadedFileLength']))
              ? Number(a['UploadedFileLength'])
              : null,
            category: String(a['CategoryName'] ?? ''),
          }));
      }
      applications.push(app);
    }
    return {
      applications,
      cursor: applications.at(-1)?.applicationId ?? cursor,
      done: !page.hasMore || applications.length === 0,
    };
  }

  async download(run: SourceRun, ref: { applicationId: string; attachmentId: string }) {
    const client = this.conns.client;
    return this.call<{ bytes: Buffer; fileName: string }>(run, (t) =>
      client.downloadFile(t, ref.applicationId, ref.attachmentId, run.signal),
    );
  }
}
