import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IMPORT_ERROR_MESSAGE,
  IMPORT_ERROR_UNKNOWN,
  IMPORT_WAIT_MESSAGE,
  IMPORT_WAIT_UNKNOWN,
} from '@cv/shared';
import { api, ApiError } from './api';

/**
 * Stage 3, S3-INT-14: shapes and calls for the Oracle import, all to Parallax's own API. Nothing here
 * calls Oracle, nothing runs on a schedule, and this file holds no Oracle host, path or secret.
 */

export interface RunView {
  runId: string;
  mode: 'import' | 'refresh';
  state: 'queued' | 'running' | 'awaiting_confirm' | 'completed' | 'failed' | 'cancelled';
  phase: 'listing' | 'fetching';
  batchId: string | null;
  listed: number;
  estimate: number | null;
  counts: Partial<Record<CountKey, number>>;
  waitReason: string | null;
  errorCode: string | null;
  confirmReason: 'above_estimate' | 'above_room' | 'above_estimate_and_room' | null;
  pauseEndsAt: string | null;
  startedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  cancelRequested: boolean;
}
export type CountKey =
  | 'seen'
  | 'filtered'
  | 'preNotice'
  | 'noFile'
  | 'withheld'
  | 'already'
  | 'listed'
  | 'fetched'
  | 'gone';

export interface OracleLinkView {
  ref: string;
  state: 'proposed' | 'approved' | null;
  linkedBy: string | null;
  linkedAt: string | null;
  canUnlink: boolean;
}
export interface OracleState {
  available: boolean;
  link: OracleLinkView | null;
  run: RunView | null;
  lastRun: RunView | null;
  goneCount: number;
  staleDays: number | null;
  linkPolicy: 'open' | 'lead_approval';
  /** CVs that still fit in the vacancy. */
  room: number;
}
export interface LookupAnswer {
  found: boolean;
  number?: string;
  title?: string;
  state?: string;
  estimate?: number;
  room?: number;
}

export const oracleApi = {
  /** One request per page load; null hides the feature (switch off, 404 or a failed request). */
  state: async (vacancyId: string): Promise<OracleState | null> => {
    try {
      return await api.get<OracleState>(`/vacancies/${vacancyId}/oracle`);
    } catch {
      return null;
    }
  },
  lookup: (vacancyId: string, ref: string) =>
    api.post<LookupAnswer>(`/vacancies/${vacancyId}/oracle/lookup`, { ref }),
  start: (vacancyId: string, body: { ref?: string; estimate?: number }) =>
    api.post<{ runId: string }>(`/vacancies/${vacancyId}/oracle/imports`, body),
  unlink: (vacancyId: string) =>
    api.del<{ unlinked: boolean }>(`/vacancies/${vacancyId}/oracle/link`),
  confirm: (runId: string) => api.post<{ confirmed: boolean }>(`/import-runs/${runId}/confirm`),
  cancel: (runId: string) => api.post<{ cancelled: boolean }>(`/import-runs/${runId}/cancel`),
};

// ------------------------------------------------------------------ admin

export type ActivateCode =
  'ok' | 'auth_failed' | 'empty_scope' | 'unreachable' | 'not_oracle_address';
export const ACTIVATE_CODES: readonly ActivateCode[] = [
  'ok',
  'auth_failed',
  'empty_scope',
  'unreachable',
  'not_oracle_address',
];
export interface AdvancedSettings {
  linkPolicy: 'open' | 'lead_approval';
  requireEuAi: boolean;
  goneInSource: 'flag' | 'erase';
  categories: string[];
  clientId: string | null;
  scope: string | null;
  /** OAuth JWT assertion: the certificate alias (kid). */
  keyId: string | null;
  /** How a file is read: Oracle's FileContents download (default), inline, or the FileUrl link. */
  downloadRoute: 'enclosure' | 'inline' | 'fileUrl';
  /** Read a CV from the candidate profile when the application has none. */
  profileFallback: boolean;
}
export interface CategoryCheck {
  found: boolean;
  applicationsChecked: number;
  categories: { name: string; files: number; counted: boolean }[];
}
export interface AdminConnection {
  address: string;
  user: string;
  authMode: 'basic' | 'oauth_client_credentials' | 'oauth_jwt_assertion';
  tokenUrl: string | null;
  enabled: boolean;
  enabledAt: string | null;
  authFailedAt: string | null;
  lastTestAt: string | null;
  lastTestCode: string | null;
  passwordSaved: boolean;
  passwordSetAt: string | null;
  passwordExpiresOn: string | null;
  clientSecretSaved: boolean;
  privateKeySaved?: boolean;
  notice: { by: string | null; at: string; effectiveFrom: string | null } | null;
}
export interface AdminView {
  available: true;
  example: string;
  suffix: string;
  notOracleAddress: string;
  /** Own Oracle host names the operator allowed on the server (besides the suffix). */
  ownHosts?: string[];
  settings: AdvancedSettings;
  connection: AdminConnection | null;
}
export interface ActivateAnswer {
  code: ActivateCode;
  enabled: boolean;
  message?: string;
}
export interface AdminRun {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  externalRef: string | null;
  mode: string;
  state: string;
  phase: string;
  listed: number;
  fetched: number;
  waitReason: string | null;
  errorCode: string | null;
  startedBy: string | null;
  createdAt: string;
  progressAt: string | null;
  finishedAt: string | null;
  stalled: boolean;
  stalledMinutes: number | null;
}

export const oracleAdmin = {
  /** null when the switch is off (404): the card is one sentence. */
  get: async (): Promise<AdminView | null> => {
    try {
      return await api.get<AdminView>('/admin/integrations/oracle');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  activate: (body: Record<string, unknown>) =>
    api.post<ActivateAnswer>('/admin/integrations/oracle/activate', body),
  test: () => api.post<ActivateAnswer>('/admin/integrations/oracle/test'),
  deactivate: () =>
    api.post<{ enabled: false; cancelled: number }>('/admin/integrations/oracle/deactivate'),
  settings: (body: Record<string, unknown>) =>
    api.put<AdminView>('/admin/integrations/oracle/settings', body),
  categories: (requisition: string) =>
    api.post<CategoryCheck>('/admin/integrations/oracle/categories', { requisition }),
  runs: () => api.get<{ runs: AdminRun[] }>('/admin/integrations/oracle/runs'),
  abandon: (runId: string) =>
    api.post<{ abandoned: boolean }>(`/admin/import-runs/${runId}/abandon`),
};

// ------------------------------------------------------------------ sentences and counts

/** The one sentence of a run that ended with a code, or of a run that waits (B15, B22). */
export function runSentence(
  run: Pick<RunView, 'state' | 'errorCode' | 'waitReason'>,
): string | null {
  if (run.state === 'queued' && run.waitReason)
    return IMPORT_WAIT_MESSAGE[run.waitReason] ?? IMPORT_WAIT_UNKNOWN;
  if (run.state === 'failed' || (run.state === 'cancelled' && run.errorCode))
    return (
      (run.errorCode && (IMPORT_ERROR_MESSAGE as Record<string, string>)[run.errorCode]) ||
      IMPORT_ERROR_UNKNOWN
    );
  return null;
}

export interface CountLine {
  key: string;
  text: string;
  n: number;
}

/**
 * The ordered count lines and their sum (B11). The first number is the applications in Oracle;
 * the lines under it add up to it. A line with 0 is not shown.
 */
export function countRows(
  c: RunView['counts'],
  phase: 'paused' | 'finished',
  opts: { internalLeftOut?: boolean } = {},
): { total: number; lines: CountLine[] } {
  const n = (k: CountKey) => Math.max(0, Math.trunc(c[k] ?? 0));
  const listed = n('listed');
  const copied = Math.min(n('fetched'), listed);
  const lines: CountLine[] =
    phase === 'paused'
      ? [{ key: 'count.new', text: '{n} new CVs', n: listed }]
      : [
          { key: 'count.copied', text: '{n} CVs copied', n: copied },
          { key: 'count.not_copied', text: '{n} not copied (see the report)', n: listed - copied },
        ];
  lines.push(
    { key: 'count.already', text: '{n} already here', n: n('already') },
    { key: 'count.withheld', text: '{n} erased earlier, not brought back', n: n('withheld') },
    {
      key: 'count.left_out',
      text: opts.internalLeftOut
        ? '{n} left out: not active, an internal applicant, or applied before the AI notice date'
        : '{n} left out: not active, or applied before the AI notice date',
      n: n('filtered') + n('preNotice'),
    },
    { key: 'count.no_file', text: '{n} without a CV file', n: n('noFile') },
  );
  const total = lines.reduce((a, l) => a + l.n, 0);
  return { total, lines: lines.filter((l) => l.n > 0) };
}

// ------------------------------------------------------------------ the hook

const ACTIVE = new Set(['queued', 'running', 'awaiting_confirm']);
export const POLL_VISIBLE_MS = 4_000;
export const POLL_HIDDEN_MS = 15_000;

/**
 * One request per page load. Only while a run is active it asks the Parallax API again: every 4 s
 * when the tab is visible, every 15 s when it is hidden, and it stops when the run ends.
 * `cv-oracle-changed` (sent after Retry failed starts a refresh) asks once more.
 */
export function useOracle(vacancyId: string | null) {
  const [state, setState] = useState<OracleState | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  // The poll schedules itself through this ref (a callback cannot name itself while it is declared).
  const again = useRef<() => void>(() => undefined);
  const load = useCallback(async () => {
    if (!vacancyId) return null;
    const s = await oracleApi.state(vacancyId);
    if (!alive.current) return s;
    setState(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (s?.run && ACTIVE.has(s.run.state)) {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      timer.current = setTimeout(() => again.current(), hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    }
    return s;
  }, [vacancyId]);
  useEffect(() => {
    again.current = () => void load();
  }, [load]);
  useEffect(() => {
    alive.current = true;
    void load();
    const onChanged = () => void load();
    window.addEventListener('cv-oracle-changed', onChanged);
    return () => {
      alive.current = false;
      window.removeEventListener('cv-oracle-changed', onChanged);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  return { state, reload: load };
}
