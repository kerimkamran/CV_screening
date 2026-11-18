import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CV_STATUS_LABEL, type CvStatus, type Mark } from '@cv/shared';
import { api, ApiError } from '../api';
import { go } from '../route';
import { clock } from '../dates';
import { tr, useT } from '../i18n';
import {
  ago,
  BAND_NAME,
  BAND_STYLE,
  BANDS,
  MARKS,
  markName,
  type Band,
  isRanked,
  type MarkResult,
  type PoolItem,
  type PoolPage,
  type PoolRow,
  type VacancyListItem,
  mirrorNote,
} from '../pool';
import { openCv, reviewHref } from '../review';
import {
  DOWNLOAD_MAX,
  downloadCvs,
  downloadNotice,
  filterKey,
  loadSelection,
  MARK_MAX,
  saveSelection,
  type Selection,
} from '../selection';
import { btnPrimary, btnSecondary, errMsg, input, Notice, UndoBar, useUndoToast } from '../ui';
import { CandidatePreview, DECISION_KEY, useWide } from './CandidatePreview';
import { MarkSelect } from './MarkSelect';

/**
 * The Candidate pool (Development Plan, Phase 3; UAT-02): every analyzed resume, for every vacancy
 * the person may see, in one list. Marks, bulk marks, filters, search, sort and paging; the state is
 * remembered for the tab, and the order is handed to the report so Previous and Next follow it.
 */

const PAGE = 50;
const BULK_MAX = 100;
type SortKey = 'match' | 'updated' | 'candidate' | 'vacancy' | 'decision';
type Order = 'asc' | 'desc';

/** Which CVs the list shows: the ranked ones (default), every CV, or one kind that has no result. */
export type ShowKey =
  '' | 'all' | 'attention' | 'failed' | 'analyzing' | 'stopped' | 'not_analyzed';
export const SHOW_STATUSES: Record<Exclude<ShowKey, '' | 'all'>, CvStatus[]> = {
  attention: ['needs_look', 'unreadable'],
  failed: ['failed'],
  analyzing: ['analyzing'],
  stopped: ['stopped'],
  not_analyzed: ['not_analyzed'],
};
const SHOW_LABEL: Record<Exclude<ShowKey, ''>, string> = {
  all: 'All CVs',
  attention: CV_STATUS_LABEL.needs_look,
  failed: CV_STATUS_LABEL.failed,
  analyzing: CV_STATUS_LABEL.analyzing,
  stopped: CV_STATUS_LABEL.stopped,
  not_analyzed: CV_STATUS_LABEL.not_analyzed,
};
const isShow = (v: unknown): v is ShowKey =>
  v === '' || v === 'all' || (typeof v === 'string' && v in SHOW_STATUSES);

interface State {
  /** The CV that was open when the person left (the row to come back to). */
  active: string;
  show: ShowKey;
  vacancy: string;
  /** "Latest upload": only the CVs of one upload batch (Stage 2, S2-FE8). */
  batch: string;
  bands: Band[];
  marks: Mark[];
  outOfDate: boolean;
  q: string;
  sort: SortKey;
  order: Order;
  scroll: number;
  /** How many rows were on screen, so coming back from a CV brings them all back (CP-24). */
  loaded: number;
}
const DEFAULT: State = {
  active: '',
  show: '',
  vacancy: '',
  batch: '',
  bands: [],
  marks: [],
  outOfDate: false,
  q: '',
  sort: 'match',
  order: 'desc',
  scroll: 0,
  loaded: 0,
};
const stateKey = (vacancyId?: string) => `cv-pool:${vacancyId ?? 'all'}`;
function remembered(vacancyId?: string): State {
  try {
    const j = JSON.parse(sessionStorage.getItem(stateKey(vacancyId)) ?? '{}') as Partial<State>;
    return {
      active: typeof j.active === 'string' ? j.active : '',
      show: isShow(j.show) ? j.show : '',
      vacancy: typeof j.vacancy === 'string' ? j.vacancy : '',
      batch: typeof j.batch === 'string' ? j.batch : '',
      bands: Array.isArray(j.bands) ? j.bands.filter((b) => BANDS.includes(b)) : [],
      marks: Array.isArray(j.marks) ? j.marks.filter((m) => MARKS.includes(m)) : [],
      outOfDate: j.outOfDate === true,
      q: typeof j.q === 'string' ? j.q : '',
      sort: (['match', 'updated', 'candidate', 'vacancy', 'decision'] as const).includes(
        j.sort as SortKey,
      )
        ? (j.sort as SortKey)
        : 'match',
      order: j.order === 'asc' ? 'asc' : 'desc',
      scroll: typeof j.scroll === 'number' ? j.scroll : 0,
      loaded:
        typeof j.loaded === 'number' && Number.isFinite(j.loaded)
          ? Math.min(Math.max(Math.floor(j.loaded), 0), 1000)
          : 0,
    };
  } catch {
    return DEFAULT;
  }
}

const params = (s: State, vacancyId?: string) => {
  const p = new URLSearchParams();
  const v = vacancyId ?? s.vacancy;
  if (v) p.set('vacancy', v);
  // The page of one vacancy shows its CVs even when the vacancy is archived (read-only there).
  if (vacancyId) p.set('archived', 'true');
  if (s.batch) p.set('batch', s.batch);
  if (s.show === 'all') p.set('status', 'all');
  else if (s.show) p.set('status', SHOW_STATUSES[s.show].join(','));
  if (s.bands.length) p.set('band', s.bands.join(','));
  if (s.marks.length) p.set('decision', s.marks.join(','));
  if (s.outOfDate) p.set('outOfDate', 'true');
  if (s.q.trim()) p.set('q', s.q.trim());
  p.set('sort', s.sort);
  p.set('order', s.order);
  return p;
};

const SORT_LABEL: Record<SortKey, string> = {
  match: 'Match',
  updated: 'Updated',
  candidate: 'Candidate',
  vacancy: 'Vacancy',
  decision: 'Decision',
};

/** The sort order in words, for screen readers (the arrows are not read well). */
const sortSaid = (order: string) =>
  tr(order === 'asc' ? ', sorted ascending' : ', sorted descending');

export function CandidatePool({
  vacancyId,
  vacancyTitle,
  canMark,
}: {
  /** Fixed to one vacancy (the Candidates tab of a vacancy). */
  vacancyId?: string;
  vacancyTitle?: string;
  canMark: boolean;
}) {
  const t = useT();
  const [s, setS] = useState<State>(() => remembered(vacancyId));
  const [page, setPage] = useState<PoolPage | null>(null);
  const [rows, setRows] = useState<PoolItem[]>([]);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [more, setMore] = useState(false);
  const [vacancies, setVacancies] = useState<VacancyListItem[]>([]);
  // Selected CVs by document id, with their result id when they have one (S2-FE6).
  const [selected, setSelected] = useState<Selection>(() =>
    loadSelection(stateKey(vacancyId), filterKey(params(s, vacancyId).toString())),
  );
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState('');
  const [selectingAll, setSelectingAll] = useState(false);
  const [summary, setSummary] = useState<{ subject: string; body: string; count: number } | null>(
    null,
  );
  const [copied, setCopied] = useState<'yes' | 'no' | ''>('');
  const { toast, show, dismiss } = useUndoToast();
  const restored = useRef(false);
  const wantRows = useRef(s.loaded);
  const wide = useWide();
  const [activeId, setActiveId] = useState<string | null>(() => s.active || null);
  // The whole ordered list as ids, for Previous and Next on the review screen (S2-FE5).
  const allIds = useRef<{ key: string; ids: string[]; items: [string, string | null][] } | null>(
    null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);

  // The state is kept for this tab, so coming back from a report lands where the person left.
  useEffect(() => {
    try {
      sessionStorage.setItem(stateKey(vacancyId), JSON.stringify(s));
    } catch {
      /* a convenience only */
    }
  }, [s, vacancyId]);
  useEffect(() => {
    if (rows.length === 0) return;
    setS((cur) => (cur.loaded === rows.length ? cur : { ...cur, loaded: rows.length }));
  }, [rows.length]);
  useEffect(() => {
    const keep = () => setS((cur) => ({ ...cur, scroll: window.scrollY }));
    window.addEventListener('pagehide', keep);
    return () => window.removeEventListener('pagehide', keep);
  }, []);

  useEffect(() => {
    if (vacancyId) return;
    api
      .get<VacancyListItem[]>('/vacancies?sort=title&order=asc')
      .then(setVacancies, () => undefined);
  }, [vacancyId]);

  // "See results" on the batch panel limits this list to that upload.
  useEffect(() => {
    if (!vacancyId) return;
    const take = () => {
      try {
        const b = sessionStorage.getItem(`cv-batch-filter:${vacancyId}`);
        if (b) {
          sessionStorage.removeItem(`cv-batch-filter:${vacancyId}`);
          setS((cur) => ({ ...cur, batch: b, scroll: 0 }));
        }
      } catch {
        /* a convenience only */
      }
    };
    take();
    window.addEventListener('cv-batch-filter', take);
    return () => window.removeEventListener('cv-batch-filter', take);
  }, [vacancyId]);

  const query = params(s, vacancyId).toString();
  // A reload after a failed action keeps that action's message on screen (CP-13).
  const load = useCallback(
    async (keepError = false) => {
      if (!keepError) setError('');
      setExpired(false);
      // Only the first load after arriving brings back the rows that were on screen when the person
      // left (the next pages, by cursor); a new filter or search starts again from the top.
      const want = wantRows.current;
      wantRows.current = 0;
      try {
        const r = await api.get<PoolPage>(`/candidates?${query}&limit=${PAGE}`);
        let last = r;
        const all = [...r.rows];
        while (all.length < want && last.nextCursor) {
          try {
            last = await api.get<PoolPage>(
              `/candidates?${query}&limit=${PAGE}&cursor=${encodeURIComponent(last.nextCursor)}`,
            );
          } catch {
            break; // an expired list: what was loaded is shown, 'Show more' reports it
          }
          all.push(...last.rows);
        }
        setPage(last === r ? r : { ...last, rows: [] });
        setRows(all);
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [query],
  );
  // The full ordered list, as ids only, so the review screen can walk all of it (S2-BE5).
  // Fetched after the same pause as the list, never on each key press (SD-98).
  useEffect(() => {
    let dead = false;
    allIds.current = null;
    const h = setTimeout(
      () =>
        api.get<{ items: [string, string | null][] }>(`/candidates/ids?${query}`).then(
          (r) => {
            if (!dead && Array.isArray(r?.items))
              allIds.current = { key: query, ids: r.items.map((i) => i[0]), items: r.items };
          },
          () => undefined,
        ),
      s.q ? 250 : 0,
    );
    return () => {
      dead = true;
      clearTimeout(h);
    };
  }, [query, s.q]);
  // A new filter or search starts a new selection; a new sort keeps it. It is kept for the tab, so
  // a trip to a CV and back finds it again.
  const fk = filterKey(query);
  const lastFk = useRef(fk);
  useEffect(() => {
    if (lastFk.current === fk) return;
    lastFk.current = fk;
    setSelected(new Map());
    setDownloaded('');
  }, [fk]);
  useEffect(() => saveSelection(stateKey(vacancyId), fk, selected), [selected, fk, vacancyId]);

  // Typing in the search box waits a moment.
  useEffect(() => {
    const h = setTimeout(() => void load(), s.q ? 250 : 0);
    return () => clearTimeout(h);
  }, [load, s.q]);
  useEffect(() => {
    if (page && !restored.current) {
      restored.current = true;
      if (s.scroll > 0) window.setTimeout(() => window.scrollTo(0, s.scroll), 0);
    }
  }, [page, s.scroll]);

  async function showMore() {
    if (!page?.nextCursor || more) return;
    setMore(true);
    try {
      const r = await api.get<PoolPage>(
        `/candidates?${query}&limit=${PAGE}&cursor=${encodeURIComponent(page.nextCursor)}`,
      );
      setRows((cur) => [...cur, ...r.rows]);
      setPage({ ...r, rows: [] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) setExpired(true);
      else setError(errMsg(e));
    } finally {
      setMore(false);
    }
  }

  const patch = (p: Partial<State>) => setS((cur) => ({ ...cur, ...p, scroll: 0 }));
  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const sortBy = (k: SortKey) =>
    patch(
      s.sort === k
        ? { order: s.order === 'asc' ? 'desc' : 'asc' }
        : { sort: k, order: k === 'match' || k === 'updated' ? 'desc' : 'asc' },
    );

  const ariaSort = (k: SortKey): 'ascending' | 'descending' | 'none' =>
    s.sort !== k ? 'none' : s.order === 'asc' ? 'ascending' : 'descending';

  // ---------------------------------------------------------------- marks
  const setRow = (documentId: string, f: (r: PoolRow) => PoolRow) =>
    setRows((cur) => cur.map((r) => (isRanked(r) && r.documentId === documentId ? f(r) : r)));

  async function mark(r: PoolRow, to: Mark) {
    if (to === r.decision) return;
    const before = { mark: r.decision, note: r.decisionNote, version: r.decisionVersion };
    setRow(r.documentId, (x) => ({ ...x, decision: to, decisionVersion: x.decisionVersion + 1 }));
    try {
      const res = await api.put<MarkResult>(`/candidates/${r.matchId}/decision`, {
        mark: to,
        expectedVersion: before.version,
      });
      setRow(r.documentId, (x) => ({
        ...x,
        decision: res.mark,
        decisionVersion: res.version,
        decisionNote: res.note,
      }));
      const said = mirrorNote(t, res.mirror);
      const line = t('{name}: {mark}.', { name: r.label, mark: markName(to) });
      show(said ? `${line} ${said}` : line, async () => {
        try {
          const back = await api.put<MarkResult>(`/candidates/${r.matchId}/decision`, {
            mark: before.mark,
            note: before.note,
            expectedVersion: res.version,
          });
          setRow(r.documentId, (x) => ({
            ...x,
            decision: back.mark,
            decisionVersion: back.version,
          }));
        } catch (e) {
          setError(errMsg(e));
          void load(true);
        }
      });
    } catch (e) {
      setRow(r.documentId, (x) => ({
        ...x,
        decision: before.mark,
        decisionVersion: before.version,
      }));
      setError(errMsg(e));
      if (e instanceof ApiError && e.code === 'STALE_VERSION') void load(true);
    }
  }

  async function bulk(to: Mark) {
    // Only CVs with a result can be marked from the list; the others open on their own page. More
    // than BULK_MAX are sent in parts, so no CV is ever dropped silently (CP-17, SD-10).
    const ids = [...selected.values()].flatMap((m) => (m ? [m] : []));
    if (!ids.length) return;
    type Result = {
      matchId: string;
      ok: boolean;
      version?: number;
      previous?: { mark: Mark; note: string | null; version: number };
      error?: string;
    };
    const results: Result[] = [];
    let stopped: unknown = null;
    for (let at = 0; at < ids.length; at += BULK_MAX) {
      try {
        const r = await api.post<{ results: Result[]; changed: number }>('/candidates/decisions', {
          matchIds: ids.slice(at, at + BULK_MAX),
          mark: to,
        });
        results.push(...r.results);
      } catch (e) {
        stopped = e;
        break;
      }
    }
    const done = results.filter((x) => x.ok);
    const doneIds = new Set(done.map((x) => x.matchId));
    setRows((cur) =>
      cur.map((row) => {
        if (!isRanked(row)) return row;
        const hit = done.find((x) => x.matchId === row.matchId);
        return hit
          ? { ...row, decision: to, decisionVersion: hit.version ?? row.decisionVersion }
          : row;
      }),
    );
    // The CVs that were marked leave the selection; the rest stay selected to try again.
    setSelected((cur) => {
      const n = new Map(cur);
      for (const [doc, m] of cur) if (m && doneIds.has(m)) n.delete(doc);
      return n;
    });
    const failed = results.filter((x) => !x.ok);
    if (stopped) setError(errMsg(stopped));
    else if (failed.length)
      setError(
        t('{n} could not be changed: {why}', { n: failed.length, why: failed[0]?.error ?? '' }),
      );
    if (done.length)
      show(t('{n} marked {mark}.', { n: done.length, mark: markName(to) }), async () => {
        for (const x of done) {
          try {
            await api.put(`/candidates/${x.matchId}/decision`, {
              mark: x.previous!.mark,
              note: x.previous!.note,
              expectedVersion: x.version,
            });
          } catch {
            /* a row someone else changed meanwhile stays as it is */
          }
        }
        void load();
      });
  }

  // ---------------------------------------------------------------- selection and download
  const pick = (r: PoolItem): [string, string | null] => [
    r.documentId,
    isRanked(r) ? r.matchId : null,
  ];
  const toggleOne = (r: PoolItem, on?: boolean) =>
    setSelected((cur) => {
      const n = new Map(cur);
      if (on ?? !n.has(r.documentId)) n.set(...pick(r));
      else n.delete(r.documentId);
      return n;
    });
  /** "Select all N in this list": exactly the server's list, as ids (not only the loaded rows). */
  async function selectAll() {
    setSelectingAll(true);
    try {
      const items =
        allIds.current?.key === query
          ? allIds.current.items
          : (await api.get<{ items: [string, string | null][] }>(`/candidates/ids?${query}`)).items;
      setSelected(new Map(items));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSelectingAll(false);
    }
  }
  async function download() {
    if (!selected.size || selected.size > DOWNLOAD_MAX) return;
    setDownloading(true);
    setDownloaded('');
    try {
      // In the order of the list, so the ZIP reads like the screen.
      const order =
        allIds.current?.key === query ? allIds.current.ids : rows.map((r) => r.documentId);
      const at = (d: string) => {
        const i = order.indexOf(d);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      const ids = [...selected.keys()].sort((a, b) => at(a) - at(b));
      setDownloaded(downloadNotice(await downloadCvs(ids)));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setDownloading(false);
    }
  }

  // ---------------------------------------------------------------- extras
  async function exportXlsx() {
    try {
      await api.download(`/candidates/export?${query}`, 'candidates.xlsx');
    } catch (e) {
      setError(errMsg(e));
    }
  }
  const summaryVacancy = vacancyId ?? s.vacancy;
  async function openSummary() {
    if (!summaryVacancy) return;
    try {
      setSummary(
        await api.get(
          `/candidates/shortlist-summary?vacancy=${encodeURIComponent(summaryVacancy)}`,
        ),
      );
      setCopied('');
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const leave = (r: PoolItem) => {
    const scroll = window.scrollY;
    try {
      sessionStorage.setItem(
        stateKey(vacancyId),
        JSON.stringify({ ...s, active: r.documentId, scroll }),
      );
    } catch {
      /* the CV still opens; Previous and Next just have no list */
    }
    const ids =
      allIds.current?.key === query && allIds.current.ids.includes(r.documentId)
        ? allIds.current.ids
        : rows.map((x) => x.documentId);
    openCv(
      r.documentId,
      {
        label: vacancyTitle ?? tr('Candidates'),
        back: window.location.hash.replace(/^#/, '') || '/candidates',
        ids,
        scroll,
      },
      go,
    );
  };

  const shown = rows;
  const activeRow = shown.find((r) => r.documentId === activeId) ?? null;
  const activeRanked = activeRow && isRanked(activeRow) ? activeRow : null;
  const previewRow = wide && previewOpen ? activeRanked : null;

  // Keys (J and K move, S, M and N decide, Esc closes the panel, Enter opens the report). They do
  // nothing while a field has the focus, so typing a name never marks anyone.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || summary) return;
    const el = e.target as HTMLElement | null;
    // Text fields and selects keep their keys; after a click on a chip, a pill, a checkbox or a
    // button the list keys still work (CP-12, SD-12). Enter on a focused control is that control's.
    if (el && /^(SELECT|TEXTAREA)$/.test(el.tagName)) return;
    if (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type))
      return;
    if (el?.isContentEditable) return;
    const control = !!el && /^(BUTTON|A|INPUT)$/.test(el.tagName);
    const k = e.key === 'ArrowDown' ? 'j' : e.key === 'ArrowUp' ? 'k' : e.key.toLowerCase();
    if (control && (k === 'enter' || k === ' ')) return;
    const i = shown.findIndex((r) => r.documentId === activeId);
    if (k === 'j' || k === 'k') {
      if (!shown.length) return;
      const next =
        shown[Math.max(0, Math.min(shown.length - 1, i < 0 ? 0 : i + (k === 'j' ? 1 : -1)))]!;
      setActiveId(next.documentId);
      if (wide && isRanked(next)) setPreviewOpen(true);
      else setPreviewOpen(false);
      document.getElementById(`cand-${next.documentId}`)?.scrollIntoView?.({ block: 'nearest' });
      e.preventDefault();
    } else if (k === 'x' && activeRow && canMark) {
      // X ticks or unticks the active row (S2-FE6).
      e.preventDefault();
      toggleOne(activeRow);
    } else if (k === 'escape') {
      setPreviewOpen(false);
    } else if (k === 'enter' && activeRow) {
      e.preventDefault();
      leave(activeRow);
    } else if (k in DECISION_KEY && activeRanked && canMark && !activeRanked.vacancyArchived) {
      const to = DECISION_KEY[k]!;
      e.preventDefault();
      void mark(activeRanked, activeRanked.decision === to ? 'new' : to);
    }
  };
  useEffect(() => {
    keysRef.current = onKey;
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const allSelected = shown.length > 0 && shown.every((r) => selected.has(r.documentId));
  const total = page?.total ?? 0;
  const filtered =
    s.bands.length > 0 ||
    s.marks.length > 0 ||
    s.outOfDate ||
    s.batch !== '' ||
    s.show !== '' ||
    s.q.trim() !== '' ||
    (!vacancyId && s.vacancy !== '');
  const remaining = page ? page.total - rows.length : 0;
  const nextCount = Math.min(PAGE, remaining);
  const selectedRows = useMemo(
    () => shown.filter((r) => selected.has(r.documentId)),
    [shown, selected],
  );
  const blocked = selectedRows.some((r) => r.vacancyArchived);
  const unmarkable = selected.size > 0 && [...selected.values()].every((m) => m === null);
  const tooMany = selected.size > DOWNLOAD_MAX;

  return (
    <div className="space-y-4">
      {!vacancyId && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{t('Candidates')}</h1>
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-line bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className={`${input} w-64!`}
            aria-label={t('Search candidates')}
            placeholder={t('Search by name, skill or vacancy')}
            value={s.q}
            onChange={(e) => patch({ q: e.target.value })}
          />
          {!vacancyId && (
            <select
              className={`${input} w-56!`}
              aria-label={t('Vacancy')}
              value={s.vacancy}
              onChange={(e) => patch({ vacancy: e.target.value })}
            >
              <option value="">{t('All vacancies')}</option>
              {vacancies.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
          )}
          <label className="ml-auto flex items-center gap-1 text-sm lg:hidden">
            <span className="sr-only">{t('Sort by')}</span>
            <select
              className={input}
              aria-label={t('Sort by')}
              value={`${s.sort}:${s.order}`}
              onChange={(e) => {
                const [k, o] = e.target.value.split(':') as [SortKey, Order];
                patch({ sort: k, order: o });
              }}
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).flatMap((k) => [
                <option key={`${k}:desc`} value={`${k}:desc`}>
                  {t(SORT_LABEL[k])} ↓
                </option>,
                <option key={`${k}:asc`} value={`${k}:asc`}>
                  {t(SORT_LABEL[k])} ↑
                </option>,
              ])}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <label className="flex max-w-full min-w-0 items-center gap-2">
            <span className="text-ink-3">{t('Show')}</span>
            <select
              className={`${input} w-auto! max-w-full min-w-0`}
              aria-label={t('Show')}
              value={s.show}
              onChange={(e) => patch({ show: e.target.value as ShowKey })}
            >
              <option value="">{t('Ranked CVs')}</option>
              {(Object.keys(SHOW_LABEL) as Exclude<ShowKey, ''>[]).map((k) => (
                <option key={k} value={k}>
                  {t(SHOW_LABEL[k])}
                </option>
              ))}
            </select>
          </label>
          <div role="group" aria-label={t('Match')} className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-3">{t('Match')}</span>
            {BANDS.map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={s.bands.includes(b)}
                onClick={() => patch({ bands: toggle(s.bands, b) })}
                className={`rounded-full border px-2.5 py-0.5 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${s.bands.includes(b) ? 'border-accent bg-accent text-on-accent' : 'border-edge bg-card text-ink hover:bg-hover'}`}
              >
                {t(BAND_NAME[b])}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label={t('Decision')}
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-ink-3">{t('Decision')}</span>
            {MARKS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={s.marks.includes(m)}
                onClick={() => patch({ marks: toggle(s.marks, m) })}
                className={`rounded-full border px-2.5 py-0.5 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${s.marks.includes(m) ? 'border-accent bg-accent text-on-accent' : 'border-edge bg-card text-ink hover:bg-hover'}`}
              >
                {markName(m)}
                {page && !filtered ? ` ${page.counts.byMark[m]}` : ''}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={s.outOfDate}
              onChange={(e) => patch({ outOfDate: e.target.checked })}
            />
            {t('Out of date only')}
          </label>
          {s.batch && (
            <button
              type="button"
              className="rounded-full border border-edge bg-sel px-3 py-1 text-sm"
              onClick={() => patch({ batch: '' })}
            >
              {t('Latest upload only')} ×
            </button>
          )}
          {filtered && (
            <button
              type="button"
              className="text-link underline"
              onClick={() => patch({ ...DEFAULT, vacancy: vacancyId ? '' : '' })}
            >
              {t('Clear the filters')}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
        <p>
          {/* Only the counts are announced; the time changes on every refresh and would repeat them (A11-08). */}
          <span role="status">
            {page
              ? [
                  tr(page.total === 1 ? '{n} candidate' : '{n} candidates', { n: page.total }),
                  t('{n} strong', { n: page.counts.strong }),
                  page.counts.outOfDate ? t('{n} out of date', { n: page.counts.outOfDate }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : ''}
          </span>
          {page && (
            <span className="text-ink-3">
              {' · '}
              {t('As of {time}', {
                time: clock(new Date(page.asOf)),
              })}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={() => void exportXlsx()}
            disabled={!page || page.total === 0}
          >
            {t('Export to Excel')}
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => void openSummary()}
            disabled={!summaryVacancy}
            title={summaryVacancy ? undefined : t('Choose a vacancy first')}
            aria-describedby={summaryVacancy ? undefined : 'summary-why'}
          >
            {t('Shortlist summary')}
          </button>
          {/* The reason is visible text too, so keyboard and touch users get it (SD-95). */}
          {!summaryVacancy && (
            <span id="summary-why" className="text-xs text-ink-3">
              {t('Choose a vacancy first')}
            </span>
          )}
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {expired && (
        <Notice kind="warn">
          {t('This list was opened a while ago. Reload it to continue.')}{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            {t('Reload')}
          </button>
        </Notice>
      )}

      {summary && (
        <div className="space-y-2 rounded-2xl border border-line bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{summary.subject}</h2>
            <button type="button" className={btnSecondary} onClick={() => setSummary(null)}>
              {t('Close')}
            </button>
          </div>
          <textarea
            readOnly
            aria-label={t('Shortlist summary')}
            className={`${input} h-48 font-mono text-xs`}
            value={summary.body}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                // A blocked clipboard is said, so the person copies from the box instead (SD-101).
                const done = navigator.clipboard?.writeText(summary.body);
                if (!done) return setCopied('no');
                void done.then(
                  () => setCopied('yes'),
                  () => setCopied('no'),
                );
              }}
            >
              {t('Copy')}
            </button>
            <a
              className={btnSecondary}
              href={`mailto:?subject=${encodeURIComponent(summary.subject)}&body=${encodeURIComponent(summary.body)}`}
            >
              {t('Open in e-mail')}
            </a>
            <span
              role="status"
              className={`text-sm ${copied === 'no' ? 'text-err-ink' : 'text-ok-ink'}`}
            >
              {copied === 'yes'
                ? t('Copied.')
                : copied === 'no'
                  ? t('Copying did not work. Select the text in the box and copy it.')
                  : ''}
            </span>
            <span className="text-xs text-ink-3">
              {t('Nothing is sent from here. You send it yourself.')}
            </span>
          </div>
        </div>
      )}

      {canMark && selected.size > 0 && (
        <div
          role="region"
          aria-label={t('Selected candidates')}
          className="m-rise sticky top-14 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-accent bg-sel p-2 text-sm shadow"
        >
          <span key={selected.size} className="m-pop inline-block font-medium tabular-nums">
            {t('{n} selected', { n: selected.size })}
          </span>
          <button
            type="button"
            className={btnPrimary}
            disabled={downloading || tooMany}
            title={tooMany ? t('Up to 500 CVs per download. Narrow the list.') : undefined}
            onClick={() => void download()}
          >
            {downloading ? t('Preparing…') : t('Download CVs')}
          </button>
          {tooMany && (
            <span className="text-warn-text">
              {t('Up to 500 CVs per download. Narrow the list.')}
            </span>
          )}
          <label className="flex items-center gap-2">
            <span>{t('Mark as')}</span>
            <select
              className={input}
              aria-label={t('Mark selected as')}
              value=""
              disabled={blocked || unmarkable}
              onChange={(e) => e.target.value && void bulk(e.target.value as Mark)}
            >
              <option value="">{t('Choose…')}</option>
              {MARKS.map((m) => (
                <option key={m} value={m}>
                  {markName(m)}
                </option>
              ))}
            </select>
          </label>
          {selected.size > MARK_MAX && (
            <span className="text-ink-3">{t('Up to 100 at a time.')}</span>
          )}
          {blocked && (
            <span className="text-warn-text">{t('A selected vacancy is archived.')}</span>
          )}
          {unmarkable && (
            <span className="text-ink-3">
              {t('A CV without a result is marked on its own page.')}
            </span>
          )}
          <button
            type="button"
            className="text-link underline"
            onClick={() => setSelected(new Map())}
          >
            {t('Clear selection')}
          </button>
        </div>
      )}
      {downloaded && (
        <Notice kind="info">
          <span role="status">{downloaded}</span>
        </Notice>
      )}
      {canMark && allSelected && total > shown.length && selected.size < total && (
        <p className="m-fade rounded-xl bg-info px-3 py-2 text-sm text-info-ink">
          {t('All {n} shown are selected.', { n: shown.length })}{' '}
          <button
            type="button"
            className="font-semibold underline"
            disabled={selectingAll}
            onClick={() => void selectAll()}
          >
            {t('Select all {n} in this list', { n: total })}
          </button>
        </p>
      )}
      {canMark && total > 0 && selected.size === total && total > shown.length && (
        <p className="m-fade rounded-xl bg-info px-3 py-2 text-sm text-info-ink">
          {t('All {n} in this list are selected.', { n: total })}{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => setSelected(new Map())}
          >
            {t('Clear selection')}
          </button>
        </p>
      )}

      {page && page.total === 0 && (
        <div className="rounded-2xl border border-dashed border-edge bg-card p-10 text-center text-sm text-ink-2">
          {filtered ? (
            <>
              {t('No candidates match.')}{' '}
              <button
                type="button"
                className="text-link underline"
                onClick={() => patch({ ...DEFAULT })}
              >
                {t('Clear the filters')}
              </button>
            </>
          ) : (
            t('No analyzed CVs yet. Add CVs to a vacancy and choose “Find the best fit”.')
          )}
        </div>
      )}

      {shown.length > 0 && canMark && (
        <p className="hidden text-xs text-ink-3 lg:block">
          {t('Keys: J and K move, X selects, S shortlist, M maybe, N not now, Enter opens the CV.')}
        </p>
      )}

      {shown.length > 0 && (
        <div
          className={
            previewRow ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]' : undefined
          }
        >
          <div className="min-w-0 rounded-2xl border border-line bg-card">
            {/* Column labels and sort buttons. The rows below are a list, not a table, so this is a
                labelled group; each sort button says its state in words (SD-63). */}
            <div role="table" aria-label={t('Sort the list')} className="hidden lg:block">
              <div role="rowgroup">
                <div
                  role="row"
                  className="grid grid-cols-[2rem_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.6fr)_6rem_8rem_6rem] items-center gap-3 border-b border-line px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-3"
                >
                  <span role="columnheader" aria-hidden={canMark ? undefined : true}>
                    {canMark && (
                      // A label, so the whole 44 px square toggles the box (WCAG 2.5.5).
                      <label className="-m-3 flex h-11 w-11 items-center justify-center">
                        <input
                          type="checkbox"
                          aria-label={t('Select all shown')}
                          checked={allSelected}
                          onChange={(e) =>
                            setSelected(e.target.checked ? new Map(shown.map(pick)) : new Map())
                          }
                        />
                      </label>
                    )}
                  </span>
                  {(
                    [
                      ['candidate', 'Candidate'],
                      ['vacancy', 'Vacancy'],
                      ['match', 'Match'],
                    ] as [SortKey, string][]
                  ).map(([k, label]) => (
                    <span key={k} role="columnheader" aria-sort={ariaSort(k)}>
                      <button
                        type="button"
                        onClick={() => sortBy(k)}
                        aria-pressed={s.sort === k}
                        className="text-left uppercase hover:text-ink"
                      >
                        {t(label)} {s.sort === k ? (s.order === 'asc' ? '↑' : '↓') : ''}
                        {s.sort === k && <span className="sr-only">{sortSaid(s.order)}</span>}
                      </button>
                    </span>
                  ))}
                  <span role="columnheader">{t('Must-haves')}</span>
                  <span role="columnheader" aria-sort={ariaSort('decision')}>
                    <button
                      type="button"
                      onClick={() => sortBy('decision')}
                      aria-pressed={s.sort === 'decision'}
                      className="text-left uppercase hover:text-ink"
                    >
                      {t('Decision')} {s.sort === 'decision' ? (s.order === 'asc' ? '↑' : '↓') : ''}
                      {s.sort === 'decision' && (
                        <span className="sr-only">{sortSaid(s.order)}</span>
                      )}
                    </button>
                  </span>
                  <span role="columnheader" aria-sort={ariaSort('updated')}>
                    <button
                      type="button"
                      onClick={() => sortBy('updated')}
                      aria-pressed={s.sort === 'updated'}
                      className="text-left uppercase hover:text-ink"
                    >
                      {t('Updated')} {s.sort === 'updated' ? (s.order === 'asc' ? '↑' : '↓') : ''}
                      {s.sort === 'updated' && <span className="sr-only">{sortSaid(s.order)}</span>}
                    </button>
                  </span>
                </div>
              </div>
            </div>
            {canMark && (
              <label className="flex min-h-11 items-center gap-3 border-b border-line px-4 text-sm lg:hidden">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Map(shown.map(pick)) : new Map())
                  }
                />
                {t('Select all')}
              </label>
            )}
            <ul className="divide-y divide-line" aria-label={t('Candidates')}>
              {shown.map((r, i) => {
                const ranked = isRanked(r);
                const on = r.documentId === activeId;
                return (
                  <li
                    key={r.documentId}
                    id={`cand-${r.documentId}`}
                    data-active={on ? 'true' : undefined}
                    tabIndex={-1}
                    aria-current={on ? 'true' : undefined}
                    style={{ '--i': Math.min(i % 50, 12) } as CSSProperties}
                    className={`${on ? 'bg-sel ' : ''}m-rise grid cursor-pointer grid-cols-[2rem_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-hover lg:grid-cols-[2rem_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.6fr)_6rem_8rem_6rem]`}
                    onClick={() => {
                      setActiveId(r.documentId);
                      if (wide && ranked) setPreviewOpen(true);
                      else leave(r);
                    }}
                  >
                    {/* A label, so the whole 44 px square toggles the box (a touch target, WCAG 2.5.5). */}
                    <label
                      onClick={(e) => e.stopPropagation()}
                      className="-m-3 flex h-11 w-11 items-center justify-center"
                    >
                      {canMark && (
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          aria-label={t('Select {name}', { name: r.label })}
                          checked={selected.has(r.documentId)}
                          onChange={(e) => toggleOne(r, e.target.checked)}
                        />
                      )}
                    </label>
                    <span className="min-w-0">
                      <a
                        href={reviewHref(r.documentId)}
                        className="block truncate font-medium text-link hover:underline"
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey) return;
                          e.preventDefault();
                          e.stopPropagation();
                          leave(r);
                        }}
                      >
                        {r.label}
                      </a>
                    </span>
                    <span className="col-span-3 min-w-0 truncate text-ink-2 lg:col-span-1">
                      {r.vacancyTitle}
                      {r.vacancyStatus === 'closed' && (
                        <span className="text-ink-3"> · {t('Closed')}</span>
                      )}
                      {r.vacancyArchived && <span className="text-ink-3"> · {t('Archived')}</span>}
                    </span>
                    {ranked ? (
                      <span className="col-span-3 flex flex-wrap items-center gap-1.5 lg:col-span-1">
                        <span className="font-medium tabular-nums">{Math.round(r.score)}%</span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_STYLE[r.band]}`}
                        >
                          {t(BAND_NAME[r.band])}
                        </span>
                        {r.outOfDate && (
                          <span className="rounded border border-warn-line bg-warn px-1.5 py-0.5 text-xs text-warn-ink">
                            {r.reanalyzing ? t('Re-analyzing') : t('Out of date')}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="col-span-3 lg:col-span-1">
                        <span className="rounded-full bg-neutral px-2.5 py-0.5 text-xs font-semibold text-ink">
                          {t(CV_STATUS_LABEL[r.status])}
                        </span>
                      </span>
                    )}
                    <span className="text-ink-2">
                      <span className="text-ink-3 lg:hidden">{t('Must-haves')}: </span>
                      {ranked ? t('{a} of {b}', { a: r.mustFound, b: r.mustTotal }) : '—'}
                    </span>
                    <span onClick={(e) => e.stopPropagation()}>
                      {ranked ? (
                        <MarkSelect
                          value={r.decision}
                          label={r.label}
                          disabled={!canMark || r.vacancyArchived}
                          onChange={(m) => void mark(r, m)}
                        />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </span>
                    <span className="text-ink-3">{ago(r.updatedAt)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          {previewRow && (
            <CandidatePreview
              row={previewRow}
              canMark={canMark}
              onMark={(m) => void mark(previewRow, m)}
              onOpen={() => leave(previewRow)}
              onClose={() => setPreviewOpen(false)}
            />
          )}
        </div>
      )}

      {page && remaining > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            className={btnSecondary}
            disabled={more}
            onClick={() => void showMore()}
          >
            {more ? t('Loading…') : t('Show {n} more', { n: nextCount })}
          </button>
        </div>
      )}
      <UndoBar toast={toast} onDone={dismiss} label={t('Undo')} />
    </div>
  );
}
