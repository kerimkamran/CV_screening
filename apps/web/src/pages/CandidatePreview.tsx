import { useEffect, useState } from 'react';
import type { Mark } from '@cv/shared';
import { api } from '../api';
import { useT } from '../i18n';
import {
  BAND_NAME,
  BAND_STYLE,
  MARK_STYLE,
  markName,
  type CandidateReportData,
  type PoolRow,
  type ReportRequirement,
} from '../pool';
import { btnPrimary, errMsg } from '../ui';

/**
 * The side panel of the Candidate pool (wide screens): who this is, why the score is what it is,
 * and the decision as three buttons. Reading and deciding without leaving the list.
 * The panel only reads the stored match; it never changes a score.
 */

const STATE_STYLE = {
  matched: 'bg-ok text-ok-ink',
  partly: 'bg-warn text-warn-ink',
  missing: 'bg-neutral text-ink',
} as const;

const DECISIONS: Mark[] = ['shortlist', 'maybe', 'not_now'];
export const DECISION_KEY: Record<string, Mark> = { s: 'shortlist', m: 'maybe', n: 'not_now' };

export function useWide(min = 1024): boolean {
  const query = `(min-width: ${min}px)`;
  const read = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [query]);
  return wide;
}

export function CandidatePreview({
  row,
  canMark,
  onMark,
  onOpen,
  onClose,
}: {
  row: PoolRow;
  canMark: boolean;
  onMark: (m: Mark) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<CandidateReportData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    api.get<CandidateReportData>(`/candidates/${row.matchId}/report`).then(
      (r) => live && setData(r),
      (e) => live && setError(errMsg(e)),
    );
    return () => {
      live = false;
    };
  }, [row.matchId]);

  const must = (data?.requirements ?? []).filter((r) => r.kind === 'must');
  const stateName = (r: ReportRequirement) =>
    r.unclear
      ? t('Unclear')
      : r.state === 'matched'
        ? t('Matched')
        : r.state === 'partly'
          ? t('Partly')
          : r.notFound
            ? t('Not found')
            : t('Missing');
  const locked = !canMark || row.vacancyArchived;

  return (
    <aside
      aria-label={t('Preview of {name}', { name: row.label })}
      className="space-y-4 rounded-2xl border border-line bg-card p-4 text-sm shadow-[0_6px_20px_-12px_rgb(11_31_58/0.25)] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{row.label}</h2>
          <p className="truncate text-ink-3">{row.vacancyTitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close preview')}
          className="rounded-full px-2 py-1 text-ink-2 hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          ×
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-bold tabular-nums">{Math.round(row.score)}%</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_STYLE[row.band]}`}
        >
          {t(BAND_NAME[row.band])}
        </span>
        <span className="text-ink-2">
          {t('Must-haves')}: {t('{a} of {b}', { a: row.mustFound, b: row.mustTotal })}
        </span>
      </div>

      {data?.summary && <p className="text-ink-2">{data.summary}</p>}

      <section aria-label={t('Must-haves')}>
        <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
          {t('Must-haves')}
        </h3>
        {error ? (
          <p role="alert" className="text-err-ink">
            {error}
          </p>
        ) : !data ? (
          <p className="text-ink-3">{t('Loading…')}</p>
        ) : must.length === 0 ? (
          <p className="text-ink-3">{t('No must-haves in this vacancy.')}</p>
        ) : (
          <ul className="space-y-1.5">
            {must.map((r) => (
              <li key={r.requirementId} className="flex items-start justify-between gap-2">
                <span className="min-w-0">{r.text}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${r.unclear ? 'bg-warn text-warn-ink' : STATE_STYLE[r.state]}`}
                >
                  {stateName(r)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div role="group" aria-label={t('Decision for {name}', { name: row.label })}>
        <div className="grid grid-cols-3 gap-1.5">
          {DECISIONS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={locked}
              aria-pressed={row.decision === m}
              onClick={() => onMark(row.decision === m ? 'new' : m)}
              className={`rounded-full border px-2 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 ${row.decision === m ? `${MARK_STYLE[m]} ring-2 ring-current` : 'border-edge bg-card text-ink hover:bg-hover'}`}
            >
              {markName(m)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-3">
          {t('Keys: S shortlist, M maybe, N not now. Press again to clear it.')}
        </p>
      </div>

      <button type="button" className={`${btnPrimary} w-full`} onClick={onOpen}>
        {t('Open the full report')}
      </button>
    </aside>
  );
}
