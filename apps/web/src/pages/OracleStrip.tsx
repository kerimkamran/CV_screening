import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { adoptBatch } from '../intake';
import {
  countRows,
  oracleApi,
  runSentence,
  type LookupAnswer,
  type OracleState,
  type RunView,
} from '../oracle';
import { type VacancyView } from '../pool';
import { btnPrimary, btnSecondary, errMsg, Notice, when } from '../ui';
import { ImportDialog } from './OracleLink';

const ACTIVE = new Set(['queued', 'running', 'awaiting_confirm']);

/**
 * Stage 3, S3-INT-14 (B7-B19): the strip above the batch panel while a vacancy is linked to Oracle.
 * Listing, fetching, paused, finished, empty, error, the 30-day reminder; read-only when archived.
 * Never more than two buttons at once. It announces a change of step, never every poll.
 */
export function OracleStrip({
  vacancy,
  oracle,
  reload,
  focus,
}: {
  vacancy: VacancyView;
  oracle: OracleState;
  reload: () => Promise<unknown>;
  /** The import was just started in this tab: focus goes to the strip heading. */
  focus: boolean;
}) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState<(LookupAnswer & { ref: string }) | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const refreshBtn = useRef<HTMLButtonElement>(null);
  const link = oracle.link;
  const run = oracle.run;
  const last = oracle.lastRun;
  const readOnly = !vacancy.canEdit || vacancy.archived;

  // The run's batch appears in the batch panel at once, with no reload (B8).
  // Also the batch of a run that ended between two polls, so the panel never misses it.
  const batchId = run?.batchId ?? last?.batchId ?? null;
  useEffect(() => {
    if (batchId) adoptBatch(vacancy.id, batchId);
  }, [batchId, vacancy.id]);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  if (!link) return null;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const report = (id: string) =>
    void api
      .download(`/upload-batches/${id}/report.csv`, `upload-report-${id}.csv`)
      .catch((e) => setError(errMsg(e)));
  const openRefresh = () =>
    void act(async () => {
      const a = await oracleApi.lookup(vacancy.id, link.ref);
      if (!a.found)
        throw new Error(t('No Oracle vacancy has this ID. Check the number and try again.'));
      setRefresh({ ...a, ref: link.ref });
    });

  // What the strip says, as one announcement per step (C6).
  const step = run
    ? `${run.state}:${run.phase}:${run.waitReason ?? ''}`
    : last
      ? `end:${last.runId}:${last.state}`
      : '';
  const lines: React.ReactNode[] = [];
  const buttons: React.ReactNode[] = [];
  let stateWord = '';

  const cancelButton = run && !readOnly && !asking && (
    <button
      key="cancel"
      type="button"
      className={btnSecondary}
      disabled={busy}
      onClick={() => setAsking(true)}
    >
      {t('Cancel import')}
    </button>
  );

  if (run && ACTIVE.has(run.state)) {
    if (run.state === 'awaiting_confirm') {
      stateWord = t('Waiting for you');
      lines.push(...pausedLines(run, oracle.room, t));
      if (!readOnly && !asking)
        buttons.push(
          <button
            key="go"
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={() => void act(() => oracleApi.confirm(run.runId))}
          >
            {t('Continue')}
          </button>,
        );
    } else {
      stateWord = t('Importing');
      const waiting = runSentence(run);
      if (waiting) lines.push(<p key="wait">{t(waiting)}</p>);
      else if (run.phase === 'listing')
        lines.push(
          <p key="list">
            {t('Reading the application list from Oracle… {n} read so far.', {
              n: run.counts.seen ?? 0,
            })}
          </p>,
        );
      else
        lines.push(
          <p key="fetch" className="tabular-nums">
            {t('Fetched {sent} of {total}', { sent: run.counts.fetched ?? 0, total: run.listed })}
          </p>,
        );
      lines.push(
        <p key="leave" className="text-ink-3">
          {t('You can leave this page. The import continues.')}
        </p>,
      );
    }
    if (cancelButton) buttons.push(cancelButton);
  } else if (last) {
    lines.push(...endLines(last, t));
    if (last.finishedAt)
      lines.unshift(
        <p key="when" className="text-ink-3">
          {t('Last refreshed {when} by {name}', {
            when: when(last.finishedAt),
            name: last.startedBy ?? '',
          })}
        </p>,
      );
    if (last.batchId) {
      const id = last.batchId;
      buttons.push(
        <button key="rep" type="button" className={btnSecondary} onClick={() => report(id)}>
          {t('Download report')}
        </button>,
      );
    }
    if (!readOnly)
      buttons.push(
        <button
          key="ref"
          ref={refreshBtn}
          type="button"
          className={btnSecondary}
          disabled={busy}
          onClick={openRefresh}
        >
          {t('Refresh')}
        </button>,
      );
  }
  if (!run && oracle.staleDays !== null && oracle.staleDays >= 30)
    lines.push(
      <p key="stale">
        {t('Last refreshed {n} days ago. Refresh to see who has applied or withdrawn since.', {
          n: oracle.staleDays,
        })}
      </p>,
    );
  if (oracle.goneCount > 0)
    lines.push(
      <p key="gone">
        {t('{n} imported applicants are no longer active in Oracle.', { n: oracle.goneCount })}
      </p>,
    );

  return (
    <section
      aria-labelledby="oracle-strip-title"
      className="space-y-2 rounded-2xl border border-line bg-card p-4 text-sm"
      data-testid="oracle-strip"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="oracle-strip-title"
          ref={heading}
          tabIndex={-1}
          className="font-semibold outline-none"
        >
          {t('Oracle vacancy {ref}', { ref: link.ref })}
        </h2>
        {stateWord && <span className="rounded-full bg-sel px-2 py-0.5 text-xs">{stateWord}</span>}
      </div>
      <div className="sr-only" role="status" aria-live="polite" key={step}>
        {step ? (run ? stateWord : t('Completed')) : ''}
      </div>
      {lines}
      {asking && run && (
        <div className="flex flex-wrap items-center gap-2" role="group">
          <span>
            {t(
              'Cancel the import? CVs already copied stay and are analyzed. The rest are not copied.',
            )}
          </span>
          <button
            ref={keepRef}
            type="button"
            className={btnSecondary}
            onClick={() => setAsking(false)}
          >
            {t('Keep importing')}
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() =>
              void act(async () => {
                await oracleApi.cancel(run.runId);
                setAsking(false);
              })
            }
          >
            {t('Cancel import')}
          </button>
        </div>
      )}
      {buttons.length > 0 && <div className="flex flex-wrap gap-2">{buttons.slice(0, 2)}</div>}
      {error && <Notice kind="error">{error}</Notice>}
      {refresh && (
        <ImportDialog
          mode="refresh"
          answer={refresh}
          room={refresh.room ?? oracle.room}
          onClose={() => {
            setRefresh(null);
            refreshBtn.current?.focus();
          }}
          onStart={async () => {
            await oracleApi.start(vacancy.id, { estimate: refresh.estimate });
            setRefresh(null);
            await reload();
            heading.current?.focus();
          }}
        />
      )}
    </section>
  );
}

type T = ReturnType<typeof useT>;

function pausedLines(run: RunView, room: number, t: T): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const aboveEstimate =
    run.confirmReason === 'above_estimate' || run.confirmReason === 'above_estimate_and_room';
  out.push(
    <p key="cause" className="font-medium">
      {aboveEstimate
        ? t(
            'Oracle has more applications than the estimate you confirmed (about {n}). Nothing is copied yet.',
            {
              n: run.estimate ?? 0,
            },
          )
        : t('There are more new CVs than this vacancy has room for. Nothing is copied yet.')}
    </p>,
  );
  const c = countRows(run.counts, 'paused');
  out.push(<p key="total">{t('{n} applications in Oracle', { n: c.total })}</p>);
  out.push(
    <ul key="lines" className="list-disc pl-5">
      {c.lines.map((l) => (
        <li key={l.key}>{t(l.text, { n: l.n })}</li>
      ))}
    </ul>,
  );
  out.push(
    <p key="room">
      {run.listed > room
        ? t('Room for {r}. The oldest applications come first; {n} will not fit.', {
            r: room,
            n: run.listed - room,
          })
        : t('Room for {r}.', { r: room })}
    </p>,
  );
  if (run.pauseEndsAt)
    out.push(
      <p key="deadline" className="text-ink-3">
        {t('If nobody answers by {time}, the import is cancelled and nothing is copied.', {
          time: new Date(run.pauseEndsAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        })}
      </p>,
    );
  return out;
}

function endLines(run: RunView, t: T): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const c = run.counts;
  if (run.state === 'completed') {
    const seen = c.seen ?? 0;
    if (seen === 0) {
      out.push(
        <p key="empty">
          {t(
            'Oracle shows no applications for this vacancy. If you expect some, ask an administrator to check what the Oracle account is allowed to see.',
          )}
        </p>,
      );
      return out;
    }
    if ((run.listed ?? 0) === 0 && !c.already && !c.withheld && (c.noFile ?? 0) > 0) {
      out.push(
        <p key="empty">
          {t(
            'Oracle has {n} applications for this vacancy, but none has a CV file that can be read here. The CV may be only on the candidate profile in Oracle.',
            { n: seen },
          )}
        </p>,
      );
      return out;
    }
    if ((run.listed ?? 0) === 0) {
      out.push(<p key="empty">{t('Nothing new in Oracle since the last refresh.')}</p>);
      return out;
    }
    const rows = countRows(c, 'finished');
    out.push(
      <p key="head" className="font-medium">
        {t('{copied} CVs copied of {total} applications', {
          copied: Math.min(c.fetched ?? 0, run.listed),
          total: rows.total,
        })}
      </p>,
      <ul key="lines" className="list-disc pl-5">
        {rows.lines.map((l) => (
          <li key={l.key}>{t(l.text, { n: l.n })}</li>
        ))}
      </ul>,
    );
    return out;
  }
  if (run.state === 'cancelled' && !run.errorCode)
    out.push(<p key="c">{t('Import cancelled.')}</p>);
  else {
    const s = runSentence(run);
    if (s) out.push(<p key="err">{t(s)}</p>);
  }
  if ((c.fetched ?? 0) > 0)
    out.push(<p key="before">{t('{n} CVs were copied before that.', { n: c.fetched ?? 0 })}</p>);
  return out;
}
