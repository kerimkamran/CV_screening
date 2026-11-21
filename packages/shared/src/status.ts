/**
 * One status vocabulary for every CV (Stage 2, S2-BE1).
 *
 * The API (lists, batch, document view) and the web (lists, batch panel, review screen, waiting
 * screen, summary strip) use only this table. Each document is counted once, in exactly one status.
 * Scores never travel with a status: a score only ever appears together with its breakdown.
 */

export const CV_STATUSES = [
  'not_sent',
  'sending',
  'waiting_to_send',
  'could_not_send',
  'rejected',
  'duplicate',
  'vacancy_full',
  'cancelled',
  'not_fetched',
  'analyzing',
  'stopped',
  'failed',
  'unreadable',
  'needs_look',
  'analyzed',
  'not_analyzed',
  'erased',
] as const;
export type CvStatus = (typeof CV_STATUSES)[number];

/** Statuses only the browser can know (a file in this tab, not yet or no longer on the server). */
export const CLIENT_ONLY_STATUSES: readonly CvStatus[] = [
  'sending',
  'waiting_to_send',
  'could_not_send',
];

/** English labels. The Azerbaijani and Russian texts live in the web i18n files under the same key. */
export const CV_STATUS_LABEL: Record<CvStatus, string> = {
  not_sent: 'Not sent',
  sending: 'Sending…',
  waiting_to_send: 'Waiting to send',
  could_not_send: 'Could not send',
  rejected: 'Not accepted',
  duplicate: 'Already in this vacancy',
  vacancy_full: 'Vacancy full',
  cancelled: 'Cancelled',
  not_fetched: 'Not fetched',
  analyzing: 'Being analyzed',
  stopped: 'Stopped',
  failed: 'Analysis failed',
  unreadable: 'No readable text',
  needs_look: 'Needs a human look',
  analyzed: 'Analyzed',
  not_analyzed: 'Not analyzed for the current criteria',
  erased: 'Erased',
};

/** What a recruiter can do about a status (for buttons; the server decides what is allowed). */
export const CV_STATUS_ACTION: Record<
  CvStatus,
  'resend' | 'open' | 'retry' | 'reanalyze' | 'continue' | null
> = {
  not_sent: 'resend',
  sending: null,
  waiting_to_send: null,
  could_not_send: 'resend',
  rejected: null,
  duplicate: 'open',
  vacancy_full: 'resend',
  cancelled: null,
  // An Oracle file that was not fetched has no button of its own: Refresh in the Oracle strip fetches it.
  not_fetched: null,
  analyzing: null,
  stopped: 'continue',
  failed: 'retry',
  unreadable: 'open',
  needs_look: 'open',
  analyzed: 'open',
  not_analyzed: 'reanalyze',
  erased: null,
};

/** Statuses that are final for the upload step: nothing more will arrive for that file. */
export const isUploadFinal = (s: CvStatus) =>
  !['not_sent', 'sending', 'waiting_to_send', 'could_not_send', 'vacancy_full'].includes(s);

/** Statuses that count as "needs a human look" in the summary: unreadable plus needs_look. */
export const needsHumanLook = (s: CvStatus) => s === 'unreadable' || s === 'needs_look';

/** Statuses that keep the analysis moving (the 4 s poll stays alive only for these). */
export const isInProgress = (s: CvStatus) => s === 'analyzing';

/** Upload item outcomes the server stores (`upload_item.outcome`), and the reason codes. */
export const UPLOAD_OUTCOMES = [
  'queued',
  'duplicate',
  'unreadable',
  'rejected',
  'skipped',
] as const;
export type UploadOutcome = (typeof UPLOAD_OUTCOMES)[number];

export const UPLOAD_CODES = [
  'wrong_type',
  'old_word_format',
  'empty',
  'too_large',
  'bad_zip',
  'bad_zip_entry',
  'zip_too_large',
  'too_many_entries',
  'unsafe_path',
  'nested_archive',
  'suspicious_ratio',
  'no_cvs_in_zip',
  'vacancy_full',
  'duplicate',
  'no_text',
  'read_failed',
  'server_error',
  'cancelled',
  // Stage 3, Oracle import (S3-INT-05, S3-INT-12).
  'source_unavailable',
  'source_gone',
  'superseded',
  'crash_limit',
] as const;
export type UploadCode = (typeof UPLOAD_CODES)[number];

/** English texts for each code. `{n}` placeholders are filled by the caller. */
export const UPLOAD_CODE_MESSAGE: Record<UploadCode, string> = {
  wrong_type: 'Not a CV file type',
  old_word_format: 'Old Word format: save it as .docx or PDF',
  empty: 'The file is empty',
  too_large: 'Over {n} MB',
  bad_zip: 'The ZIP could not be opened',
  bad_zip_entry: 'A file inside the ZIP could not be read',
  zip_too_large: 'The ZIP is over {n} MB',
  too_many_entries: 'The ZIP holds more than {n} files',
  unsafe_path: 'Unsafe file path',
  nested_archive: 'An archive inside the ZIP is not opened',
  suspicious_ratio: 'Unusually compressed, not opened',
  no_cvs_in_zip: 'No CVs found in this ZIP',
  vacancy_full: 'Vacancy full',
  duplicate: 'Already in this vacancy',
  no_text: 'No readable text',
  read_failed: 'The text could not be read',
  server_error: 'The server could not process this file',
  cancelled: 'Cancelled',
  source_unavailable: 'Oracle did not answer',
  source_gone: 'No longer in Oracle',
  superseded: 'Replaced by a newer import',
  crash_limit: 'Failed twice, so it was left out',
};

/**
 * The only list of codes that may be sent again (S3-UP-02). A `skipped` item with one of these codes
 * is not final: the browser may send the file again and the server processes it. Every other stored
 * outcome is final. `source_unavailable` (S3-INT-05) is an Oracle file the runner could not fetch.
 */
export const RETRYABLE_CODES: readonly UploadCode[] = [
  'vacancy_full',
  'server_error',
  'source_unavailable',
];

/** Where a batch came from: the recruiter's browser, or the Oracle import (S3-INT-05). */
export type BatchSource = 'browser' | 'oracle_hcm';

/**
 * Stage 3, S3-INT-05 (8): the codes the import runner writes to `import_run.error_code` or
 * `wait_reason`. Each one has exactly one sentence on screen (plan 16.4).
 */
export const IMPORT_RUN_CODES = [
  'oracle_unavailable',
  'oracle_budget',
  'capacity_unavailable',
  'storage_low',
  'sign_in',
  'vacancy_gone',
  'schema_changed',
  'actor_revoked',
  'did_not_finish',
  'not_confirmed',
  'switched_off',
  'abandoned',
  'archived',
] as const;
export type ImportRunCode = (typeof IMPORT_RUN_CODES)[number];

/** One English sentence per run error code; anything else reads as `IMPORT_ERROR_UNKNOWN`. */
export const IMPORT_ERROR_MESSAGE: Record<ImportRunCode, string> = {
  oracle_unavailable:
    'Oracle did not answer for 2 hours, so the import stopped. Try Refresh later.',
  oracle_budget:
    "Today's limit of calls to Oracle is used up. The import waits and goes on by itself tomorrow.",
  capacity_unavailable:
    'The service was too busy for 2 hours, so the import stopped. Try Refresh later.',
  storage_low:
    'There is not enough storage room for these CVs, so nothing was copied. Tell an administrator.',
  sign_in:
    'Sign-in to Oracle failed, so the import stopped. Ask an administrator to check the Oracle connection.',
  vacancy_gone: 'Oracle no longer has this vacancy. Check the ID in Oracle.',
  schema_changed:
    'Oracle answered in a form this version does not understand. Tell an administrator.',
  actor_revoked:
    'The import stopped because the person who started it can no longer change this vacancy.',
  did_not_finish:
    'The import stopped 5 times without moving on. Tell an administrator before you try again.',
  not_confirmed: 'Nobody answered within 2 hours, so the import was cancelled. Nothing was copied.',
  switched_off: 'The Oracle import was switched off, so the import was cancelled.',
  abandoned: 'An administrator stopped this import.',
  archived:
    'The import stopped because the vacancy was archived. Restore the vacancy, then refresh.',
};
export const IMPORT_ERROR_UNKNOWN =
  'The import did not finish. Try Refresh, or tell an administrator.';

/** The sentence for a wait reason while a run is parked (plan 16.4, `wait.*`). */
export const IMPORT_WAIT_MESSAGE: Record<string, string> = {
  oracle_unavailable: 'Oracle is not answering. The import waits and tries again by itself.',
  capacity_unavailable: 'The service is busy. The import waits and goes on by itself.',
  storage_low: 'Storage room is low. The import waits and tries again by itself.',
  oracle_budget:
    "Today's limit of calls to Oracle is used up. The import waits and goes on by itself tomorrow.",
};
export const IMPORT_WAIT_UNKNOWN = 'The import is waiting. It goes on by itself.';

export const importErrorMessage = (code: string | null | undefined) =>
  (code && (IMPORT_ERROR_MESSAGE as Record<string, string>)[code]) || IMPORT_ERROR_UNKNOWN;

/** One upload announces at most this many files (S3-UP-01). The API and the web share it. */
export const MAX_ANNOUNCE_FILES = 500;

/** True when an upload item's stored outcome is final: nothing about it may change any more. */
export const isFinalItem = (outcome: string | null, code: string | null | undefined) =>
  outcome !== null &&
  !(outcome === 'skipped' && code != null && (RETRYABLE_CODES as readonly string[]).includes(code));

/**
 * Map an upload outcome to the status the file shows before any analysis exists. On an Oracle batch
 * (S3-INT-05) a file that was not fetched shows `not_fetched` (Refresh fetches it), and a file the
 * runner closed shows `cancelled`.
 */
export function uploadStatus(
  outcome: UploadOutcome | null,
  code?: string | null,
  source: BatchSource = 'browser',
): CvStatus {
  const oracle = source === 'oracle_hcm';
  switch (outcome) {
    case null:
      return oracle ? 'not_fetched' : 'not_sent';
    case 'rejected':
      return 'rejected';
    case 'duplicate':
      return 'duplicate';
    case 'unreadable':
      return 'unreadable';
    case 'skipped':
      if (code === 'cancelled' || code === 'superseded' || code === 'source_gone')
        return 'cancelled';
      if (code === 'vacancy_full') return 'vacancy_full';
      if (oracle && (code === 'source_unavailable' || code === 'server_error'))
        return 'not_fetched';
      if (code != null && (RETRYABLE_CODES as readonly string[]).includes(code)) return 'not_sent';
      return 'rejected';
    case 'queued':
      return 'analyzing';
  }
}

export interface CvStatusInput {
  /** `cv_document.erased_at IS NOT NULL` */
  erased?: boolean | null;
  /** The screening on the CURRENT frozen criteria, or null/undefined when there is none. */
  screening?: {
    state: 'queued' | 'processing' | 'completed' | 'failed' | 'manual';
    /** `cancelled_at IS NOT NULL` */
    cancelled?: boolean | null;
    band?: string | null;
    /** True when a score (with its breakdown) was stored. */
    scored?: boolean | null;
  } | null;
}

/**
 * The status of one stored CV. Every document gets exactly one.
 * - No screening on the current criteria (for example after a criteria change) is `not_analyzed`,
 *   never `analyzing`, so nothing keeps polling for work that is not coming.
 * - `manual` means no text could be read.
 * - A completed screening in the `needs_review` band (knockout or suspected injection) is `needs_look`.
 */
export function cvStatus(input: CvStatusInput): CvStatus {
  if (input.erased) return 'erased';
  const sc = input.screening;
  if (!sc) return 'not_analyzed';
  switch (sc.state) {
    case 'queued':
      return sc.cancelled ? 'stopped' : 'analyzing';
    case 'processing':
      return 'analyzing';
    case 'failed':
      return 'failed';
    case 'manual':
      return 'unreadable';
    case 'completed':
      if (sc.band === 'needs_review') return 'needs_look';
      return sc.scored === false ? 'needs_look' : 'analyzed';
  }
}

/** Counts per status; the sum equals the number of documents (each counted once). */
export function countByStatus(statuses: Iterable<CvStatus>): Record<CvStatus, number> {
  const out = Object.fromEntries(CV_STATUSES.map((s) => [s, 0])) as Record<CvStatus, number>;
  for (const s of statuses) out[s] += 1;
  return out;
}
