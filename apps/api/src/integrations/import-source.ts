/**
 * Stage 3 (plan 15.4 step 2): the runner reads applications and files through this small interface,
 * so Phase 2 is tested with an in-memory source and no Oracle code. The Oracle client implements it
 * in Phase 3 (`oracle/oracle-source.ts`).
 */
export interface SourceAttachment {
  attachmentId: string;
  fileName: string;
  /** Size stated by the source, in bytes (may be missing or wrong; the download is capped anyway). */
  size: number | null;
  category: string | null;
}

export interface SourceApplication {
  applicationId: string;
  personId: string;
  appliedAt: Date | null;
  /** `active` is imported; anything else is counted as filtered and leaves no row. */
  eligibility: 'active' | 'filtered';
  internal: boolean;
  /** Attachments that count as a CV, newest first. Empty: counted as "without a CV file". */
  attachments: SourceAttachment[];
}

export interface ListPage {
  applications: SourceApplication[];
  /** The cursor to resume after this page (the last application ID read). */
  cursor: string | null;
  /** True when Oracle says there is nothing after this page. */
  done: boolean;
}

export interface SourceRun {
  runId: string;
  vacancyId: string;
  /** The requisition number the recruiter typed, and Oracle's ID for it. */
  externalRef: string;
  externalId: string;
  signal: AbortSignal;
}

export interface Downloaded {
  bytes: Buffer;
  /** The file name the source gave (stored only on cv_document; never in a permanent list). */
  fileName: string;
}

/**
 * The ways a source call can fail, each with one runner reaction (plan 5.5, 15.2):
 * - `unavailable`: 429, 5xx, a time-out or a refused connection: the run parks, no attempt spent.
 * - `budget`: the daily call budget is spent: the run parks until the next day.
 * - `auth`: Oracle refused the sign-in: the run fails `sign_in`.
 * - `schema_changed`: an answer lacks a field the client needs: the run fails, not retried.
 * - `vacancy_gone`: the requisition is no longer returned: the run fails.
 * - `too_large`: the file passed the size cap: the item ends `rejected/too_large`.
 * - `link_forbidden`: a 401 or 403 on a file link: read the link again once.
 */
export type SourceErrorCode =
  | 'unavailable'
  | 'budget'
  | 'auth'
  | 'schema_changed'
  | 'vacancy_gone'
  | 'too_large'
  | 'link_forbidden';

export class SourceError extends Error {
  constructor(
    readonly code: SourceErrorCode,
    /** Seconds the source asked to wait (Retry-After), when it said. */
    readonly retryAfter?: number,
  ) {
    super(`source: ${code}`);
  }
}

export interface ImportSource {
  readonly system: 'oracle_hcm';
  listPage(run: SourceRun, cursor: string | null): Promise<ListPage>;
  download(
    run: SourceRun,
    ref: { applicationId: string; attachmentId: string },
  ): Promise<Downloaded>;
}
