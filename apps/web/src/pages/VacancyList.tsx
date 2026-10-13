import { useCallback, useEffect, useRef, useState } from 'react';
import type { VacancyStatus } from '@cv/shared';
import { api } from '../api';
import { go } from '../route';
import { useT } from '../i18n';
import { ago, MARK_STYLE, markName, STATUS_STYLE, statusName, type VacancyListItem } from '../pool';
import { btnPrimary, errMsg, input, Notice, UndoBar, useUndoToast } from '../ui';

/**
 * The Vacancy pool (Development Plan, Phase 1; UAT-01): every vacancy the person may see, with the
 * numbers that matter at a glance. Chips for status, search, Azerbaijani sort order, a row menu with
 * Open, Duplicate and Archive (undo for ten seconds).
 */

type Chip = 'all' | VacancyStatus | 'archived';
const CHIPS: [Chip, string][] = [
  ['all', 'All'],
  ['draft', 'Draft'],
  ['open', 'Open'],
  ['on_hold', 'On hold'],
  ['closed', 'Closed'],
  ['archived', 'Archived'],
];
type Sort = 'updated' | 'title';
const KEY = 'cv-vacancy-list';

function remembered(): { chip: Chip; q: string; sort: Sort } {
  try {
    const j = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Partial<{
      chip: Chip;
      q: string;
      sort: Sort;
    }>;
    return {
      chip: CHIPS.some(([c]) => c === j.chip) ? j.chip! : 'all',
      q: typeof j.q === 'string' ? j.q : '',
      sort: j.sort === 'title' ? 'title' : 'updated',
    };
  } catch {
    return { chip: 'all', q: '', sort: 'updated' };
  }
}

function RowMenu({
  v,
  canCreate,
  onDuplicate,
  onArchive,
  onRestore,
}: {
  v: VacancyListItem;
  canCreate: boolean;
  onDuplicate: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDetailsElement>(null);
  const item = 'block w-full rounded px-2 py-1.5 text-left hover:bg-hover';
  const close = () => ref.current?.removeAttribute('open');
  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={t('Actions for {title}', { title: v.title })}
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded text-ink-2 hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        <span aria-hidden="true">⋯</span>
      </summary>
      <div
        className="absolute right-0 z-10 mt-1 w-44 rounded-2xl border border-line bg-card p-1 text-sm shadow-lg"
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <a className={item} href={`#/vacancies/${v.id}`}>
          {t('Open')}
        </a>
        {canCreate && !v.archived && (
          <button
            type="button"
            className={item}
            onClick={() => {
              close();
              onDuplicate();
            }}
          >
            {t('Duplicate')}
          </button>
        )}
        {v.canEdit && !v.archived && (
          <button
            type="button"
            className={item}
            onClick={() => {
              close();
              onArchive();
            }}
          >
            {t('Archive')}
          </button>
        )}
        {v.canEdit && v.archived && (
          <button
            type="button"
            className={item}
            onClick={() => {
              close();
              onRestore();
            }}
          >
            {t('Restore')}
          </button>
        )}
      </div>
    </details>
  );
}

export function VacancyList({ canCreate }: { canCreate: boolean }) {
  const t = useT();
  const [start] = useState(remembered);
  const [chip, setChip] = useState<Chip>(start.chip);
  const [q, setQ] = useState(start.q);
  const [sort, setSort] = useState<Sort>(start.sort);
  const [rows, setRows] = useState<VacancyListItem[] | null>(null);
  const [error, setError] = useState('');
  const { toast, show, dismiss } = useUndoToast();

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ chip, q, sort }));
    } catch {
      /* the list state is a convenience only */
    }
  }, [chip, q, sort]);

  const load = useCallback(
    async (query: string) => {
      const p = new URLSearchParams();
      if (chip === 'archived') p.set('archived', 'true');
      else if (chip !== 'all') p.set('status', chip);
      if (query.trim()) p.set('q', query.trim());
      p.set('sort', sort);
      p.set('order', sort === 'title' ? 'asc' : 'desc');
      try {
        setRows(await api.get<VacancyListItem[]>(`/vacancies?${p}`));
        setError('');
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [chip, sort],
  );
  // Typing waits a moment so the list does not jump on every key.
  useEffect(() => {
    const h = setTimeout(() => void load(q), q ? 250 : 0);
    return () => clearTimeout(h);
  }, [load, q]);

  // Scans in progress move the numbers: look again every few seconds, and when the tab returns.
  const anyRunning = rows?.some((v) => v.running > 0) ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const h = setInterval(() => void load(q), 5000);
    return () => clearInterval(h);
  }, [anyRunning, load, q]);
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible') void load(q);
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [load, q]);

  async function act(path: string, v: VacancyListItem, undo?: { path: string; text: string }) {
    try {
      await api.post(`/vacancies/${v.id}/${path}`);
      await load(q);
      if (undo)
        show(undo.text, async () => {
          try {
            await api.post(`/vacancies/${v.id}/${undo.path}`);
          } catch (e) {
            setError(errMsg(e));
          }
          await load(q);
        });
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function duplicate(v: VacancyListItem) {
    try {
      const r = await api.post<{ id: string }>(`/vacancies/${v.id}/duplicate`);
      go(`/vacancies/${r.id}`);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const empty = rows !== null && rows.length === 0;
  const filtered = chip !== 'all' || q.trim() !== '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('Vacancies')}</h1>
        {canCreate && (
          <a href="#/vacancies/new" className={btnPrimary}>
            {t('New vacancy')}
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('Status')} className="flex flex-wrap gap-1.5">
          {CHIPS.map(([c, label]) => (
            <button
              key={c}
              type="button"
              aria-pressed={chip === c}
              onClick={() => setChip(c)}
              className={`rounded-full border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${chip === c ? 'border-accent bg-accent text-on-accent' : 'border-edge bg-card text-ink hover:bg-hover'}`}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            type="search"
            className={`${input} w-72!`}
            aria-label={t('Search vacancies')}
            placeholder={t('Search by title, department or place')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-1 text-sm">
            <span className="sr-only">{t('Sort by')}</span>
            <select
              className={input}
              aria-label={t('Sort by')}
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="updated">{t('Recently updated')}</option>
              <option value="title">{t('Title A to Z')}</option>
            </select>
          </label>
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {rows === null && !error && <p className="text-sm text-ink-3">{t('Loading…')}</p>}

      {empty && !filtered && (
        <div className="rounded-2xl border border-dashed border-edge bg-card p-10 text-center">
          <p className="text-base font-medium">{t('No vacancies yet. Add the first one.')}</p>
          {canCreate && (
            <a href="#/vacancies/new" className={`${btnPrimary} mt-4`}>
              {t('New vacancy')}
            </a>
          )}
        </div>
      )}
      {empty && filtered && (
        <p className="rounded-2xl border border-line bg-card p-6 text-center text-sm text-ink-2">
          {t('No vacancies match.')}{' '}
          <button
            type="button"
            className="text-link underline"
            onClick={() => {
              setChip('all');
              setQ('');
            }}
          >
            {t('Clear the filters')}
          </button>
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="rounded-2xl border border-line bg-card">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[minmax(0,2.4fr)_6rem_minmax(0,1.6fr)_5rem_minmax(0,1.6fr)_minmax(0,1.2fr)_6rem_2rem] gap-3 border-b border-line px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-3 lg:grid"
          >
            <span>{t('Title')}</span>
            <span>{t('Status')}</span>
            <span>{t('Analyzed')}</span>
            <span>{t('Strong')}</span>
            <span>{t('Decisions')}</span>
            <span>{t('Owner')}</span>
            <span>{t('Updated')}</span>
            <span />
          </div>
          <ul className="divide-y divide-line" aria-label={t('Vacancies')}>
            {rows.map((v) => (
              <li
                key={v.id}
                className="grid grid-cols-2 items-center gap-x-3 gap-y-1 px-4 py-3.5 text-sm transition-colors hover:bg-hover lg:grid-cols-[minmax(0,2.4fr)_6rem_minmax(0,1.6fr)_5rem_minmax(0,1.6fr)_minmax(0,1.2fr)_6rem_2rem]"
              >
                <div className="col-span-2 min-w-0 lg:col-span-1">
                  <a
                    href={`#/vacancies/${v.id}`}
                    className="block truncate text-[15px] font-semibold text-link hover:underline"
                  >
                    {v.title}
                  </a>
                  {(v.department || v.location) && (
                    <span className="block truncate text-xs text-ink-3">
                      {[v.department, v.location].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
                <span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${v.archived ? 'bg-neutral text-ink-2' : STATUS_STYLE[v.status]}`}
                  >
                    {v.archived ? t('Archived') : statusName(v.status)}
                  </span>
                </span>
                <span>
                  <span className="lg:hidden text-ink-3">{t('Analyzed')}: </span>
                  {v.analyzed === 0 && v.running === 0
                    ? '—'
                    : v.running > 0
                      ? t('{n} analyzed, {m} running', { n: v.analyzed, m: v.running })
                      : t('{a} of {b}', { a: v.analyzed, b: Math.max(v.documents, v.analyzed) })}
                  {(v.analyzed > 0 || v.running > 0) && v.documents > 0 && (
                    <span
                      aria-hidden="true"
                      className="mt-1 block h-1.5 w-full max-w-28 overflow-hidden rounded-full bg-neutral"
                    >
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{
                          width: `${Math.min(100, Math.round((v.analyzed / Math.max(v.documents, 1)) * 100))}%`,
                        }}
                      />
                    </span>
                  )}
                  {v.outOfDate > 0 && (
                    <a
                      href={`#/vacancies/${v.id}`}
                      className="mt-1 block w-fit whitespace-nowrap rounded bg-warn px-1.5 py-0.5 text-xs text-warn-ink hover:underline"
                    >
                      {t('{n} out of date', { n: v.outOfDate })} · {t('Re-analyze')}
                    </a>
                  )}
                </span>
                <span>
                  <span className="lg:hidden text-ink-3">{t('Strong')}: </span>
                  {v.analyzed ? v.strong : '—'}
                </span>
                <span className="flex flex-wrap gap-1 text-ink-2">
                  {v.decisions.shortlist + v.decisions.maybe + v.decisions.notNow === 0
                    ? '—'
                    : (
                        [
                          ['shortlist', v.decisions.shortlist],
                          ['maybe', v.decisions.maybe],
                          ['not_now', v.decisions.notNow],
                        ] as const
                      )
                        .filter(([, n]) => n > 0)
                        .map(([m, n]) => (
                          <span
                            key={m}
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${MARK_STYLE[m]}`}
                          >
                            {n} {markName(m)}
                          </span>
                        ))}
                </span>
                <span className="truncate text-ink-2">{v.owner.name ?? ''}</span>
                <span className="text-ink-3">{ago(v.updatedAt)}</span>
                <RowMenu
                  v={v}
                  canCreate={canCreate}
                  onDuplicate={() => void duplicate(v)}
                  onArchive={() =>
                    void act('archive', v, {
                      path: 'restore',
                      text: t('Archived “{title}”.', { title: v.title }),
                    })
                  }
                  onRestore={() => void act('restore', v)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      <UndoBar toast={toast} onDone={dismiss} label={t('Undo')} />
    </div>
  );
}
