import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CV_STATUS_ACTION,
  CV_STATUS_LABEL,
  UPLOAD_CODE_MESSAGE,
  type CvStatus,
  type UploadCode,
} from '@cv/shared';
import { api } from '../api';
import { useAssistantConfig } from '../assistant';
import {
  cvHref,
  firstNameOf,
  getBatchView,
  progressOf,
  setBatchView,
  type BatchView as ViewState,
} from '../coffeebay-logic';
import { stopTracking, trackBatch } from '../done-signals';
import { tr, useT } from '../i18n';
import { trServer } from '../i18n/server';
import {
  attachFiles,
  cancelRun,
  fetchIntakeInfo,
  kickBatch,
  matchOpenItems,
  retryFailedFiles,
  retryRunItem,
  retryCancel,
  runActive,
  useBatchStatus,
  useAdopted,
  useRun,
  type BatchItemView,
  type IntakeInfo,
} from '../intake';
import { type VacancyView } from '../pool';
import { btnSecondary, errMsg, Notice, when } from '../ui';
import { Coffeebay } from './Coffeebay';

/**
 * The one batch panel (Stage 2, S2-FE8): the latest upload of this vacancy. For the person who
 * started it, the running state is the coffeebay waiting screen; a team lead looking at a colleague's
 * vacancy sees the same counts and file list without the scene. Everything on it comes from the
 * server's batch, so a reload or a second device shows the same picture.
 */

const NEEDS_ATTENTION: CvStatus[] = [
  'failed',
  'could_not_send',
  'not_sent',
  'vacancy_full',
  'rejected',
  'unreadable',
  'needs_look',
  'stopped',
  // An Oracle file that was not fetched: Refresh in the Oracle strip fetches it (no row button).
  'not_fetched',
];
const OPEN_FOR_SEND: CvStatus[] = ['not_sent', 'could_not_send', 'vacancy_full'];

/** The number a rejection text names: the server's own limit for that code, not a fixed 10. */
function limitFor(code: string, info: IntakeInfo | null): number {
  // The server examines at most twice the vacancy cap of entries in one ZIP (1,000 by default).
  if (code === 'too_many_entries') return (info?.limit ?? 500) * 2;
  if (code === 'zip_too_large') return info?.maxZipMb ?? 100;
  return info?.maxFileMb ?? 10;
}

function label(status: CvStatus, code: string | null, info: IntakeInfo | null): string {
  if (status === 'rejected' && code && code in UPLOAD_CODE_MESSAGE)
    return tr(UPLOAD_CODE_MESSAGE[code as UploadCode], { n: limitFor(code, info) });
  return tr(CV_STATUS_LABEL[status]);
}

export function BatchPanel({
  vacancy,
  user,
  onChanged,
  onWatching,
  justStarted,
}: {
  vacancy: VacancyView;
  user: { id: string; displayName: string | null };
  /** The counts moved: the page reloads its own numbers. */
  onChanged: () => void;
  /** True while the panel is polling, so the page's own 4 s poll can rest. */
  onWatching: (watching: boolean) => void;
  /** The start button was just clicked in this tab (focus goes to the greeting). */
  justStarted: boolean;
}) {
  const t = useT();
  const run = useRun(vacancy.id);
  const assistant = useAssistantConfig()?.name ?? 'parallax';
  const [info, setInfo] = useState<IntakeInfo | null>(null);
  const [view, setView] = useState<ViewState>('full');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const pickRef = useRef<HTMLInputElement>(null);
  // After "Stop sending files" the button is gone: focus goes to the line that says what stopped.
  const stopLine = useRef<HTMLParagraphElement>(null);
  const stopState = run?.stop?.state ?? null;
  useEffect(() => {
    if (stopState) stopLine.current?.focus();
  }, [stopState]);
  // Hide removes the button that was pressed: focus goes to "Show the waiting screen" (plan 4.7).
  const showRef = useRef<HTMLButtonElement>(null);
  const focusShow = useRef(false);
  useEffect(() => {
    if (view === 'hidden' && focusShow.current) {
      focusShow.current = false;
      showRef.current?.focus();
    }
  }, [view]);

  useEffect(() => {
    fetchIntakeInfo(vacancy.id).then(setInfo, () => undefined);
  }, [vacancy.id, run?.batchId]);

  // This tab's run first, then a batch the import just made (adopted without a reload), then the latest.
  const adopted = useAdopted(vacancy.id);
  useEffect(() => {
    if (adopted) fetchIntakeInfo(vacancy.id).then(setInfo, () => undefined);
  }, [adopted, vacancy.id]);
  const batchId = run?.batchId ?? adopted ?? info?.latestBatch?.id ?? null;
  const oracleBatch =
    (adopted && batchId === adopted) ||
    (info?.latestBatch?.id === batchId && info?.latestBatch?.source === 'oracle_hcm');
  // The waiting scene is for files this person sends; an Oracle import shows the plain panel.
  const mine = run ? true : !!info?.latestBatch?.mine && !oracleBatch;

  // The saved choice for this batch; a batch started in this tab always opens in full.
  useEffect(() => {
    if (!batchId) return;
    setView(run ? 'full' : getBatchView(user.id, batchId));
    if (run) setBatchView(user.id, batchId, 'full');
  }, [batchId, user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const watching = batchId && view !== 'closed' ? batchId : null;
  const { status, error: watchError } = useBatchStatus(watching, { items: detailsOpen });

  // A return visit while the batch is still being read: the "ready" signals follow it again.
  useEffect(() => {
    if (batchId && mine && view !== 'closed') {
      trackBatch({ vacancyId: vacancy.id, batchId, userId: user.id, assistant });
    }
  }, [batchId, mine, view, vacancy.id, user.id, assistant]);

  const pr = useMemo(() => (status ? progressOf(status, run) : null), [status, run]);
  const active = !!pr && pr.phase !== 'finished';
  // How much room the vacancy has left changes as the CVs are read in: ask again once it settles.
  const settled = !!pr && pr.phase === 'finished';
  useEffect(() => {
    if (settled) fetchIntakeInfo(vacancy.id).then(setInfo, () => undefined);
  }, [settled, vacancy.id]);
  useEffect(() => {
    onWatching(active);
    return () => onWatching(false);
  }, [active, onWatching]);

  // Tell the page when a number moved (analyzed count or the end), not on every poll.
  const mark = pr ? `${pr.done}:${pr.analyzing}:${pr.phase}` : '';
  const lastMark = useRef('');
  useEffect(() => {
    if (!mark || mark === lastMark.current) return;
    if (lastMark.current !== '') onChanged();
    lastMark.current = mark;
  }, [mark, onChanged]);

  const rows = useMemo(() => {
    const items = (status?.items ?? []).filter((i) => !i.container);
    return items.map((i) => withClient(i, run));
  }, [status?.items, run]);
  const shown =
    filter === 'attention' ? rows.filter((r) => NEEDS_ATTENTION.includes(r.status)) : rows;
  const attention = rows.filter((r) => NEEDS_ATTENTION.includes(r.status)).length;

  const failedHere = run ? run.items.filter((i) => i.client === 'failed' && i.file).length : 0;
  const retryCount = (status?.counts.byStatus.failed ?? 0) + failedHere;
  const canEdit = vacancy.canEdit && !vacancy.archived;

  const retryAll = useCallback(async () => {
    if (!batchId) return;
    setRetrying(true);
    setError('');
    try {
      retryFailedFiles(vacancy.id);
      const r = await api.post<{
        refresh?: { runId?: string; refused?: string; message?: string };
      }>(`/vacancies/${vacancy.id}/retry-failed`, { batchId });
      // S3-INT-13 (13): on an Oracle batch the server may start a refresh, or say why it could not.
      if (r?.refresh?.runId) window.dispatchEvent(new Event('cv-oracle-changed'));
      if (r?.refresh?.refused) setError(trServer(r.refresh.message ?? ''));
      kickBatch(batchId);
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRetrying(false);
    }
  }, [batchId, vacancy.id, onChanged]);

  async function retryRow(r: BatchItemView & { here?: boolean }) {
    if (!batchId) return;
    setError('');
    try {
      if (r.status === 'could_not_send' && retryRunItem(vacancy.id, r.itemId)) return;
      if (r.status === 'failed' && r.documentId) {
        await api.post(`/vacancies/${vacancy.id}/retry-failed`, {
          batchId,
          documentId: r.documentId,
        });
        kickBatch(batchId);
        onChanged();
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }

  // Choose the files again: only the open items are sent (matched on name and size).
  async function chosen(files: File[]) {
    if (!batchId || files.length === 0) return;
    setError('');
    try {
      const s = await api.get<{ items?: BatchItemView[] }>(`/upload-batches/${batchId}?items=1`);
      const open = (s.items ?? [])
        .filter((i) => !i.container && OPEN_FOR_SEND.includes(i.status))
        .filter((i) => !run?.items.some((x) => x.itemId === i.itemId && x.file))
        .map((i) => ({
          itemId: i.itemId,
          filename: i.filename,
          size: i.size,
          position: i.position,
        }));
      const { matched, unmatched } = matchOpenItems(open, files);
      if (matched.length) attachFiles(vacancy.id, batchId, matched);
      if (unmatched.length)
        setError(
          t(
            '{n} of the chosen files did not match a file that is waiting, so they were not sent.',
            {
              n: unmatched.length,
            },
          ),
        );
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (!batchId || view === 'closed') return null;
  if (!status || !pr) {
    return watchError ? <Notice kind="error">{watchError}</Notice> : null;
  }

  const closeIt = () => {
    setBatchView(user.id, batchId, 'closed');
    setView('closed');
    stopTracking(batchId);
  };
  const hideIt = () => {
    setBatchView(user.id, batchId, 'hidden');
    focusShow.current = true;
    setView('hidden');
  };
  const openResults = () => {
    sessionStorage.setItem(`cv-batch-filter:${vacancy.id}`, batchId);
    window.location.hash = `#/vacancies/${vacancy.id}/candidates`;
    window.dispatchEvent(new Event('cv-batch-filter'));
  };
  const toggleDetails = () => setDetailsOpen((v) => !v);
  const started = status.batch;
  const oracle = status.batch.source === 'oracle_hcm';
  // Files left out because the vacancy is full are not offered again while it is still full (SD-57).
  const stillFull = !!info && info.used >= info.limit;
  const waitingFiles = pr.notSent - (stillFull ? (status.counts.byStatus.vacancy_full ?? 0) : 0);
  const holding = !!run && run.items.some((i) => i.file && i.client !== 'sent');
  const cancelled = !!status.batch.cancelledAt;
  const sendingHere = runActive(run) && !run?.stop;
  const stopSending = () => void cancelRun(vacancy.id);
  const report = () =>
    void api
      .download(`/upload-batches/${batchId}/report.csv`, `upload-report-${batchId}.csv`)
      .catch((e) => setError(errMsg(e)));

  return (
    <div className="space-y-3" data-testid="batch-panel">
      {error && <Notice kind="error">{error}</Notice>}
      {mine && view === 'full' ? (
        <Coffeebay
          progress={pr}
          assistant={assistant}
          firstName={firstNameOf(user.displayName)}
          userId={user.id}
          focusGreeting={justStarted}
          retryCount={canEdit ? retryCount : 0}
          retrying={retrying}
          detailsOpen={detailsOpen}
          onRetry={() => void retryAll()}
          onResults={openResults}
          onDetails={toggleDetails}
          onHide={hideIt}
          onClose={closeIt}
          onStop={sendingHere ? stopSending : undefined}
        />
      ) : (
        <section
          aria-label={oracle ? t('Latest import from Oracle') : t('Latest upload')}
          className="space-y-2 rounded-2xl border border-line bg-card p-4 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {oracle ? t('Latest import from Oracle') : t('Latest upload')} ·{' '}
              {when(started.createdAt)} · {started.createdBy}
            </h2>
            {mine && view === 'hidden' && (
              <button
                ref={showRef}
                type="button"
                className={btnSecondary}
                onClick={() => setView('full')}
              >
                {t('Show the waiting screen')}
              </button>
            )}
          </div>
          <p className="tabular-nums">
            {oracle
              ? t('Fetched {sent} of {total}', { sent: pr.sent, total: pr.total })
              : t('Sent {sent} of {total}', { sent: pr.sent, total: pr.total })}{' '}
            · {t('Analyzed {done} of {total}', { done: pr.done, total: pr.total })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={openResults}>
              {pr.phase === 'finished' ? t('See results') : t('See results so far')}
            </button>
            {canEdit && retryCount > 0 && (
              <button
                type="button"
                className={btnSecondary}
                disabled={retrying}
                onClick={() => void retryAll()}
              >
                {t('Retry failed ({n})', { n: retryCount })}
              </button>
            )}
            <button
              type="button"
              className={btnSecondary}
              aria-expanded={detailsOpen}
              onClick={toggleDetails}
            >
              {t('Details')}
            </button>
            {sendingHere && (
              <button type="button" className={btnSecondary} onClick={stopSending}>
                {t('Stop sending files')}
              </button>
            )}
            {mine && pr.phase === 'finished' && (
              <button type="button" className="px-2 text-link underline" onClick={closeIt}>
                {t('Close')}
              </button>
            )}
          </div>
        </section>
      )}

      {run?.stop && (
        <Notice kind={run.stop.state === 'done' ? 'ok' : 'error'}>
          <p ref={stopLine} tabIndex={-1} className="outline-none">
            {run.stop.state === 'done'
              ? t('Sending stopped. {sent} files were sent; {n} were not sent.', {
                  sent: run.stop.sent,
                  n: run.stop.notSent,
                })
              : t('Could not tell the server to stop. Try again.')}
          </p>
          {run.stop.state === 'failed' && (
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void retryCancel(vacancy.id)}
            >
              {t('Retry')}
            </button>
          )}
        </Notice>
      )}

      {canEdit && !oracle && waitingFiles > 0 && !holding && !cancelled && (
        <Notice kind="warn">
          <span>
            {t('{n} files are not sent yet. Choose them again and only those are sent.', {
              n: waitingFiles,
            })}{' '}
          </span>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => pickRef.current?.click()}
          >
            {t('Choose files')}
          </button>
          <input
            ref={pickRef}
            type="file"
            multiple
            className="sr-only"
            aria-label={t('Choose the files that were not sent')}
            onChange={(e) => {
              void chosen(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </Notice>
      )}

      {detailsOpen && (
        <section
          aria-label={t('Details')}
          className="rounded-2xl border border-line bg-card p-4 text-sm"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t('Files in this upload')}</h3>
            <button
              type="button"
              className={btnSecondary}
              aria-label={t('Download the report of this upload (CSV)')}
              onClick={report}
            >
              {t('Download report')}
            </button>
            <div role="group" aria-label={t('Show')} className="flex gap-1">
              <button
                type="button"
                aria-pressed={filter === 'all'}
                className={`${btnSecondary} ${filter === 'all' ? 'bg-sel' : ''}`}
                onClick={() => setFilter('all')}
              >
                {t('All {n}', { n: rows.length })}
              </button>
              <button
                type="button"
                aria-pressed={filter === 'attention'}
                className={`${btnSecondary} ${filter === 'attention' ? 'bg-sel' : ''}`}
                onClick={() => setFilter('attention')}
              >
                {t('Needs attention {n}', { n: attention })}
              </button>
            </div>
          </div>
          {!status.items ? (
            <p className="text-ink-3">{t('Loading…')}</p>
          ) : shown.length === 0 ? (
            <p className="text-ink-2">{t('Nothing to show here.')}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-auto">
              {shown.map((r) => {
                const action = CV_STATUS_ACTION[r.status];
                return (
                  <li key={r.itemId} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate">
                        {r.status === 'erased' ? t('Erased') : (r.clientPath ?? r.filename)}
                      </span>
                      <span className="block text-xs text-ink-3">
                        {label(r.status, r.code, info)}
                      </span>
                    </span>
                    {action === 'open' && r.documentId && (
                      <a
                        className="shrink-0 text-link hover:underline"
                        href={cvHref(vacancy.id, r.documentId)}
                      >
                        {t('Open')}
                      </a>
                    )}
                    {canEdit &&
                      (action === 'retry' ||
                        (action === 'resend' && r.status === 'could_not_send')) && (
                        <button
                          type="button"
                          className="shrink-0 text-link hover:underline"
                          onClick={() => void retryRow(r)}
                        >
                          {t('Retry')}
                        </button>
                      )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** What THIS tab knows overrides what the server shows for a file that has not arrived yet. */
function withClient(i: BatchItemView, run: ReturnType<typeof useRun>): BatchItemView {
  const c = run?.items.find((x) => x.itemId === i.itemId);
  if (!c || i.status !== 'not_sent') return i;
  if (c.client === 'sending') return { ...i, status: 'sending' };
  if (c.client === 'waiting') return { ...i, status: 'waiting_to_send' };
  if (c.client === 'failed') return { ...i, status: 'could_not_send', message: c.error };
  if (c.client === 'stopped') return { ...i, status: 'cancelled' };
  return i;
}
