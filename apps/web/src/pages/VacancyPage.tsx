import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { setAssistantScope } from '../assistant';
import { tr, useT } from '../i18n';
import { go } from '../route';
import { ago, STATUS_STYLE, statusName, type VacancyView } from '../pool';
import { btnSecondary, errMsg, Notice, when } from '../ui';
import { CandidatePool } from './CandidatePool';
import { Report } from './Report';
import { ResumesCard } from './ResumesCard';
import { Results } from './Results';
import { RoleCard } from './RoleCard';
import { CriteriaTab } from './Vacancy';

/**
 * One vacancy (Development Plan, Phase 1 and 2): the Role card and the Resumes card side by side,
 * a "Last run" line with the History link, and tabs for what the analysis found. A vacancy that
 * does not exist yet shows only the Role card; saving it opens the page for the new vacancy.
 */

export type Tab = 'candidates' | 'results' | 'report' | 'runs' | 'criteria';
export const TABS: Tab[] = ['candidates', 'results', 'report', 'runs', 'criteria'];
const TAB_LABEL: Record<Tab, string> = {
  candidates: 'Candidates',
  results: 'Results',
  report: 'Report',
  runs: 'Runs',
  criteria: 'Criteria',
};

interface Run {
  id: string;
  version: number;
  requirementsVersion: number;
  frozenAt: string;
  total: number;
  read: number;
  scored: number;
  running: number;
  finishedAt: string | null;
}
interface HistoryRow {
  id: string;
  requirementsVersion: number;
  cause: string;
  changes: { field?: string; requirement?: string; from?: string | null; to?: string | null }[];
  description: string | null;
  changedAt: string;
  changedBy: string;
}

function describe(c: HistoryRow['changes'][number]): string {
  if (c.field === 'requirement') {
    if (!c.from) return tr('Added “{text}” as {to}', { text: c.requirement ?? '', to: c.to ?? '' });
    if (!c.to) return tr('Removed “{text}”', { text: c.requirement ?? '' });
    return tr('“{text}”: {from} to {to}', { text: c.requirement ?? '', from: c.from, to: c.to });
  }
  if (c.field === 'experience')
    return tr('Experience changed from {from} to {to}', { from: c.from ?? '', to: c.to ?? '' });
  if (c.field === 'description') return tr('The role text changed');
  return c.field ?? '';
}

function Runs({ id, rows }: { id: string; rows: Run[] | null }) {
  const t = useT();
  if (!rows) return <p className="text-sm text-ink-3">{t('Loading…')}</p>;
  if (rows.length === 0)
    return <p className="text-sm text-ink-2">{t('No analysis has been run yet.')}</p>;
  return (
    <ul
      className="divide-y divide-line rounded-2xl border border-line bg-card"
      aria-label={t('Runs')}
      data-vacancy={id}
    >
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
        >
          <span className="font-medium">{t('Run {n}', { n: r.version })}</span>
          <span className="text-ink-2">{t('Started {when}', { when: when(r.frozenAt) })}</span>
          <span className="text-ink-2">
            {t('{a} of {b} read', { a: r.read, b: r.total })} · {t('{n} scored', { n: r.scored })}
            {r.running > 0 && ` · ${t('{n} running', { n: r.running })}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function VacancyPage({ id, tab }: { id: string | 'new'; tab: Tab }) {
  const t = useT();
  const creating = id === 'new';
  const [v, setV] = useState<VacancyView | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // The role and resume cards fold away once there are results; null means "decide by itself".
  const [setupChoice, setSetupChoice] = useState<boolean | null>(null);

  const reload = useCallback(async () => {
    if (creating) return;
    try {
      setV(await api.get<VacancyView>(`/vacancies/${id}`));
      setError('');
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id, creating]);
  const loadRuns = useCallback(async () => {
    if (creating) return;
    try {
      setRuns(await api.get<Run[]>(`/vacancies/${id}/runs`));
    } catch {
      setRuns([]);
    }
  }, [id, creating]);
  useEffect(() => void reload(), [reload]);
  useEffect(() => void loadRuns(), [loadRuns]);

  // While resumes are being read, the counts move: look again every few seconds.
  const running = v?.counts.running ?? 0;
  useEffect(() => {
    if (!running) return;
    const h = setInterval(() => {
      void reload();
      void loadRuns();
    }, 4000);
    return () => clearInterval(h);
  }, [running, reload, loadRuns]);

  // The Ask bar searches inside this vacancy unless the question names another.
  useEffect(() => {
    if (!v) return;
    setAssistantScope({ id: v.id, title: v.title });
    return () => setAssistantScope(null);
  }, [v?.id, v?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openHistory() {
    setShowHistory((s) => !s);
    if (history) return;
    try {
      setHistory(await api.get<HistoryRow[]>(`/vacancies/${id}/history`));
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function restore() {
    try {
      await api.post(`/vacancies/${id}/restore`);
      await reload();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (creating)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <a href="#/vacancies" className="text-sm text-link hover:underline">
          {t('← Vacancies')}
        </a>
        <h1 className="text-2xl font-bold tracking-tight">{t('New vacancy')}</h1>
        <p className="text-sm text-ink-2">
          {t('Only the title is needed. You can add the rest now or later.')}
        </p>
        <RoleCard
          vacancy={null}
          onReload={async () => undefined}
          onSaved={(saved) => go(`/vacancies/${saved.id}`)}
        />
      </div>
    );

  if (error && !v)
    return (
      <div className="space-y-3">
        <a href="#/vacancies" className="text-sm text-link hover:underline">
          {t('← Vacancies')}
        </a>
        <Notice kind="error">{error}</Notice>
      </div>
    );
  if (!v) return <p className="text-sm text-ink-3">{t('Loading…')}</p>;

  const last = runs?.[0];
  const c = v.counts;
  const hasResults = c.analyzed + c.running > 0;
  const setupOpen = setupChoice ?? (!hasResults || dirty);
  const showSetup = (focus = false) => {
    setSetupChoice(true);
    if (focus)
      window.setTimeout(
        () => document.getElementById('vacancy-setup')?.scrollIntoView?.({ behavior: 'smooth' }),
        0,
      );
  };
  return (
    <div className="space-y-5">
      <div>
        <a href="#/vacancies" className="text-sm text-link hover:underline">
          {t('← Vacancies')}
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{v.title}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${v.archived ? 'bg-neutral text-ink-2' : STATUS_STYLE[v.status]}`}
          >
            {v.archived ? t('Archived') : statusName(v.status)}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-3">
          {[
            v.department,
            v.location,
            v.owner.name ? t('Owner: {name}', { name: v.owner.name }) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="mt-1 text-sm text-ink-2" data-testid="last-run">
          {last ? (
            <>
              {t('Last run')}: {ago(last.finishedAt ?? last.frozenAt)} ·{' '}
              {t('{a} of {b} read', { a: last.read, b: last.total })}
              {v.counts.outOfDate > 0 && ` · ${t('{n} out of date', { n: v.counts.outOfDate })}`}
            </>
          ) : (
            t('Last run') + ': ' + t('none yet')
          )}
          {' · '}
          <button
            type="button"
            className="text-link underline"
            aria-expanded={showHistory}
            onClick={() => void openHistory()}
          >
            {t('History')}
          </button>
        </p>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {v.archived && (
        <Notice kind="warn">
          {t('This vacancy is archived. Marks and edits are off.')}{' '}
          {v.canEdit && (
            <button type="button" className="underline" onClick={() => void restore()}>
              {t('Restore')}
            </button>
          )}
        </Notice>
      )}

      {showHistory && (
        <section
          aria-label={t('History')}
          className="rounded-2xl border border-line bg-card p-4 text-sm"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">{t('Changes to the requirements')}</h2>
            <button type="button" className={btnSecondary} onClick={() => setShowHistory(false)}>
              {t('Close')}
            </button>
          </div>
          {!history ? (
            <p className="text-ink-3">{t('Loading…')}</p>
          ) : history.length === 0 ? (
            <p className="text-ink-2">{t('No changes since the first run.')}</p>
          ) : (
            <ul className="space-y-3">
              {history.map((h) => (
                <li key={h.id}>
                  <p className="font-medium">
                    {t('Version {n}', { n: h.requirementsVersion })} · {when(h.changedAt)} ·{' '}
                    {h.changedBy}
                  </p>
                  <ul className="list-disc pl-5 text-ink-2">
                    {h.changes.length === 0 && <li>{t('Created')}</li>}
                    {h.changes.slice(0, 8).map((c, i) => (
                      <li key={i}>{describe(c)}</li>
                    ))}
                    {h.changes.length > 8 && (
                      <li>{t('and {n} more', { n: h.changes.length - 8 })}</li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {hasResults && (
        <section
          aria-label={t('Summary')}
          className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-card px-4 py-3 text-sm"
        >
          {(
            [
              [c.documents, t('Resumes')],
              [c.analyzed, t('Analyzed')],
              [c.strong, t('Strong')],
              ...(c.needsLook > 0 ? [[c.needsLook, t('Need a look')]] : []),
              ...(c.failed > 0 ? [[c.failed, t('Analysis failed')]] : []),
              ...(c.running > 0 ? [[c.running, t('Reading now')]] : []),
            ] as [number, string][]
          ).map(([n, label]) => (
            <span key={label} className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold tabular-nums">{n}</span>
              <span className="text-ink-2">{label}</span>
            </span>
          ))}
          <button
            type="button"
            className={`${btnSecondary} ml-auto`}
            aria-expanded={setupOpen}
            aria-controls="vacancy-setup"
            onClick={() => setSetupChoice(!setupOpen)}
          >
            {setupOpen ? t('Hide role and resumes') : t('Role and resumes')}
          </button>
        </section>
      )}
      {hasResults && c.outOfDate > 0 && (
        <Notice kind="warn">
          {t('{n} results were scored against earlier requirements.', { n: c.outOfDate })}{' '}
          <button type="button" className="font-semibold underline" onClick={() => showSetup(true)}>
            {t('Review and re-analyze')}
          </button>
        </Notice>
      )}

      <div id="vacancy-setup" hidden={!setupOpen} className="grid items-start gap-4 xl:grid-cols-2">
        <RoleCard vacancy={v} onSaved={setV} onReload={reload} onDirty={setDirty} />
        <ResumesCard
          vacancy={v}
          roleDirty={dirty}
          onStarted={() => {
            void reload();
            void loadRuns();
            go(`/vacancies/${v.id}/candidates`);
          }}
        />
      </div>

      <div
        role="tablist"
        aria-label={t('Vacancy views')}
        className="flex gap-1 overflow-x-auto border-b"
      >
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => go(`/vacancies/${v.id}/${k}`)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-accent text-link' : 'border-transparent text-ink-2 hover:text-ink'}`}
          >
            {t(TAB_LABEL[k])}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'candidates' ? (
          <CandidatePool vacancyId={v.id} vacancyTitle={v.title} canMark />
        ) : tab === 'results' ? (
          <Results vacancyId={v.id} onTable={() => go(`/vacancies/${v.id}/candidates`)} />
        ) : tab === 'report' ? (
          <Report vacancyId={v.id} title={v.title} createdAt={v.createdAt} />
        ) : tab === 'runs' ? (
          <Runs id={v.id} rows={runs} />
        ) : (
          <CriteriaTab id={v.id} />
        )}
      </div>
    </div>
  );
}
