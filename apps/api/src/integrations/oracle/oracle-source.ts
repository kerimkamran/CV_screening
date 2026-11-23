import {
  SourceError,
  type ImportSource,
  type ListPage,
  type SourceApplication,
  type SourceRun,
} from '../import-source';
import { AuthCircuitOpen, categoryKey, OracleConnectionService } from './oracle-connection.service';
import type { AttachmentOwner } from './oracle-hcm.client';

/** Oracle flags arrive as booleans or as 'Y'/'N' (to confirm on the Oracle test environment). */
export const flag = (v: unknown) => v === true || v === 'Y' || v === 'y' || v === 'true';
/** State names that mean the applicant withdrew (not documented: to confirm on the test environment). */
export const WITHDRAWN_STATE = /withdraw/i;

/**
 * Gap fix (CV only on the candidate profile): an attachment read from the profile is stored as
 * `profile:<CandidateNumber>:<AttachedDocumentId>`, so the download knows where to look again.
 * A bare ID is an attachment of the application itself (every item imported before this fix).
 */
const PROFILE = 'profile:';
export function attachmentRef(
  applicationId: string,
  attachmentId: string,
): { owner: AttachmentOwner; attachmentId: string } {
  if (attachmentId.startsWith(PROFILE)) {
    const rest = attachmentId.slice(PROFILE.length);
    const cut = rest.lastIndexOf(':');
    if (cut > 0)
      return {
        owner: { kind: 'candidate', id: rest.slice(0, cut) },
        attachmentId: rest.slice(cut + 1),
      };
  }
  return { owner: { kind: 'application', id: applicationId }, attachmentId };
}

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
    const settings = this.conns.settings(row);
    const categories = new Set(settings.categories.map(categoryKey));
    const cvFiles = (atts: Record<string, unknown>[], prefix = '') =>
      atts
        .filter(
          (a) =>
            (a['DatatypeCode'] === undefined || a['DatatypeCode'] === 'FILE') &&
            categories.has(categoryKey(a['CategoryName'])),
        )
        .sort((a, b) =>
          String(b['LastUpdateDate'] ?? '').localeCompare(String(a['LastUpdateDate'] ?? '')),
        )
        .map((a) => ({
          attachmentId: `${prefix}${String(a['AttachedDocumentId'])}`,
          fileName: String(a['FileName'] ?? ''),
          size: Number.isFinite(Number(a['UploadedFileLength']))
            ? Number(a['UploadedFileLength'])
            : null,
          category: String(a['CategoryName'] ?? ''),
        }));
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
        app.attachments = cvFiles(atts);
        // Gap fix: no CV on the application, so the candidate profile is read (when switched on).
        if (!app.attachments.length && settings.profileFallback && app.personId) {
          const cand = await this.call<string | null>(run, (t) =>
            client.findCandidate(t, app.personId, run.signal),
          );
          if (cand) {
            const own = await this.call<Record<string, unknown>[]>(run, (t) =>
              client.attachmentsOf(t, { kind: 'candidate', id: cand }, run.signal),
            );
            app.attachments = cvFiles(own, `${PROFILE}${cand}:`);
          }
        }
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
    const route = this.conns.settings(await this.conns.row()).downloadRoute;
    const where = attachmentRef(ref.applicationId, ref.attachmentId);
    return this.call<{ bytes: Buffer; fileName: string }>(run, (t) =>
      client.downloadFile(t, where.owner, where.attachmentId, run.signal, route),
    );
  }
}
