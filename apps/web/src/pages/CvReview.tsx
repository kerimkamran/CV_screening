import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CV_STATUS_LABEL, type CvStatus, type Mark } from '@cv/shared';
import { api, ApiError } from '../api';
import { registerAssistantTarget, useAssistantConfig } from '../assistant';
import { go } from '../route';
import { navDirection } from '../motion';
import {
  autoNext,
  carry,
  clearTally,
  recordDecision,
  setAutoNext,
  takeCarried,
  tallyOf,
} from '../sprint';
import { ScoreDial } from '../ScoreDial';
import { Segmented } from '../Segmented';
import { tr, useT } from '../i18n';
import {
  ago,
  BAND_NAME,
  BAND_STYLE,
  MARK_STYLE,
  markName,
  mirrorNote,
  type CvReviewData,
  type MarkResult,
  type PoolPage,
  type ReportRequirement,
} from '../pool';
import { getReviewList, neighbours, reviewHref, reviewRoute } from '../review';
import {
  btnPrimary,
  btnSecondary,
  errMsg,
  input,
  Notice,
  UndoBar,
  useUndoToast,
  when,
} from '../ui';
import { CandidateLinks } from './CandidateLinks';
import { CvPane } from './CvPane';
import { MarkSelect } from './MarkSelect';
import { DECISION_KEY } from './CandidatePreview';

/**
 * The review screen (Stage 2, S2-FE3): one CV, in any state, with the original beside the analysis.
 * Route `#/cv/<documentId>?l=<listId>`. Previous and Next walk the list the person came from; Back
 * returns to it as they left it.
 */

const SPLIT_KEY = 'cv-report-split';
const MIN = 28;
const MAX = 72;
const POLL_VISIBLE_MS = 4000;
const POLL_HIDDEN_MS = 15000;

// What was last seen of each CV: the next and previous CV are fetched ahead, so the move is instant.
const cache = new Map<string, CvReviewData>();
const CACHE_MAX = 8;
function remember(d: CvReviewData) {
  if (!d?.documentId) return;
  cache.delete(d.documentId);
  cache.set(d.documentId, d);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}
export const resetReviewCacheForTests = () => cache.clear();

const STATE_STYLE = {
  matched: 'bg-ok text-ok-ink',
  partly: 'bg-warn text-warn-ink',
  missing: 'bg-neutral text-ink',
} as const;
const stateName = (r: ReportRequirement) =>
  r.unclear
    ? tr('Unclear')
    : r.state === 'matched'
      ? tr('Matched')
      : r.state === 'partly'
        ? tr('Partly')
        : r.notFound
          ? tr('Not found')
          : tr('Missing');

const STATUS_TONE: Partial<Record<CvStatus, string>> = {
  analyzed: 'bg-ok text-ok-ink',
  analyzing: 'bg-sel text-ink',
  needs_look: 'bg-warn text-warn-ink',
  unreadable: 'bg-warn text-warn-ink',
  failed: 'bg-err text-err-ink',
  stopped: 'bg-neutral text-ink',
  not_analyzed: 'bg-neutral text-ink',
  erased: 'bg-neutral text-ink',
};

export function CvReview({
  documentId,
  listId,
  canMark,
}: {
  documentId: string;
  listId: string | null;
  canMark: boolean;
}) {
  const t = useT();
  const assistant = useAssistantConfig();
  const [d, setD] = useState<CvReviewData | null>(() => cache.get(documentId) ?? null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);
  const [note, setNote] = useState(d?.decision.note ?? '');
  const [view, setView] = useState<'cv' | 'analysis'>('cv');
  const [retrying, setRetrying] = useState(false);
  const [split, setSplit] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(SPLIT_KEY));
      return v >= MIN && v <= MAX ? v : 50;
    } catch {
      return 50;
    }
  });
  const [others, setOthers] = useState<{ screeningId: string; label: string }[]>([]);
  const { toast, show, dismiss } = useUndoToast();
  // Review sprint: S, M and N decide; "Next CV after deciding" moves on (sprint.ts).
  const [auto, setAuto] = useState(autoNext);
  const [finished, setFinished] = useState(false);
  // A decision that changes washes the header in its colour for a moment (motion.css, m-wash).
  const [wash, setWash] = useState(0);
  const seenVersion = useRef<number | null>(null);
  useEffect(() => {
    const v = d?.decision.version ?? null;
    if (seenVersion.current !== null && v !== null && v > seenVersion.current)
      setWash((w) => w + 1);
    seenVersion.current = v;
  }, [d?.decision.version]);
  useEffect(() => {
    const c = takeCarried();
    if (c) show(c.text, c.undo);
  }, [show]);
  const box = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(new AbortController());
  const list = useMemo(() => getReviewList(listId), [listId]);
  const nav = neighbours(list, documentId);

  // ---------------------------------------------------------------- loading
  const load = useCallback(async () => {
    try {
      const r = await api.get<CvReviewData>(`/documents/${documentId}`, alive.current.signal);
      if (alive.current.signal.aborted) return;
      if (!r?.documentId) throw new Error('The CV could not be read.');
      remember(r);
      setD(r);
      setNote(r.decision.note ?? '');
      setError('');
    } catch (e) {
      if (alive.current.signal.aborted) return;
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(errMsg(e));
    }
  }, [documentId]);
  useEffect(() => {
    alive.current = new AbortController();
    void load();
    return () => alive.current.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);
  useEffect(() => {
    // Nothing moves on this page until the CV has loaded; then the name is the first thing read.
    if (d) heading.current?.focus({ preventScroll: true });
  }, [d?.documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The result (or the pages of a Word file) appear by themselves while they are still being made.
  const analyzing = d?.status === 'analyzing' || d?.original.view === 'pending';
  useEffect(() => {
    if (!analyzing) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(
        async () => {
          await load();
          if (!alive.current.signal.aborted) tick();
        },
        document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_VISIBLE_MS,
      );
    };
    tick();
    return () => clearTimeout(timer);
  }, [analyzing, load]);

  // The CVs on either side are fetched ahead (only their review data, never their files).
  useEffect(() => {
    for (const id of [nav.next, nav.prev]) {
      if (!id || cache.has(id)) continue;
      api.get<CvReviewData>(`/documents/${id}`).then(remember, () => undefined);
    }
  }, [nav.next, nav.prev]);

  // Who "Compare with…" can offer: the other analyzed CVs of this vacancy.
  const vacancyId = d?.vacancy.id;
  const matchId = d?.matchId ?? null;
  useEffect(() => {
    if (!vacancyId || !assistant) return;
    api.get<PoolPage>(`/candidates?vacancy=${vacancyId}&limit=100&sort=match`).then(
      (p) =>
        setOthers(
          p.rows.flatMap((r) =>
            r.matchId && r.matchId !== matchId ? [{ screeningId: r.matchId, label: r.label }] : [],
          ),
        ),
      () => undefined,
    );
  }, [vacancyId, matchId, assistant]);

  // Tell SenAI which candidate is open.
  useEffect(() => {
    if (!d?.analysis || !assistant || !matchId) return;
    registerAssistantTarget({
      target: { screeningId: matchId, label: d.analysis.label, band: d.analysis.band },
      others,
      onEditRequirement: () => go(`/vacancies/${d.vacancy.id}/criteria`),
    });
    return () => registerAssistantTarget(null);
  }, [d, assistant, matchId, others]);

  // ---------------------------------------------------------------- the divider
  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(split));
    } catch {
      /* ignore */
    }
  }, [split]);
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) =>
      setSplit(Math.min(MAX, Math.max(MIN, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------------------------------------------------------------- marks
  async function setMark(to: Mark, withNote?: string, advance = false) {
    if (!d || !canMark || !d.matchId) return;
    const before = d.decision;
    const mid = d.matchId;
    const who = d.analysis?.label ?? d.name ?? d.pseudonym;
    const docId = d.documentId;
    try {
      const res = await api.put<MarkResult>(`/candidates/${mid}/decision`, {
        mark: to,
        note: withNote ?? (to === before.mark ? note || null : null),
        expectedVersion: before.version,
      });
      if (listId) recordDecision(listId, docId, to);
      const said = mirrorNote(t, res.mirror);
      const undo = async () => {
        try {
          await api.put(`/candidates/${mid}/decision`, {
            mark: res.previous.mark,
            note: res.previous.note,
            expectedVersion: res.version,
          });
          if (listId) recordDecision(listId, docId, res.previous.mark);
          cache.delete(docId);
        } catch (e) {
          setError(errMsg(e));
        }
        await load();
      };
      // The sprint: the decision is made, its Undo comes along, and the next CV opens.
      if (advance && to !== 'new' && to !== before.mark) {
        cache.delete(docId);
        const line = [t('{name}: {mark}.', { name: who, mark: markName(to) }), said]
          .filter(Boolean)
          .join(' ');
        if (nav.next) {
          carry({ text: line, undo });
          toCv(nav.next, 'next');
          return;
        }
        await load();
        show(line, undo);
        setFinished(true);
        return;
      }
      await load();
      if (to !== before.mark)
        show([t('Marked {mark}.', { mark: markName(to) }), said].filter(Boolean).join(' '), undo);
      else if (said) show(said, undo);
    } catch (e) {
      setError(errMsg(e));
      if (e instanceof ApiError && e.code === 'STALE_VERSION') await load();
    }
  }

  async function retry() {
    if (!d?.screeningId) return;
    setRetrying(true);
    try {
      await api.post(`/screenings/${d.screeningId}/retry`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRetrying(false);
    }
  }

  // ---------------------------------------------------------------- previous / next
  const toCv = useCallback(
    (id: string | undefined, dir: 'next' | 'prev') => {
      if (!id) return;
      navDirection(dir);
      go(reviewRoute(id, listId));
    },
    [listId],
  );
  // Keys: J and K move; S, M and N decide (the same key again clears the mark). Nothing happens while
  // a field has the focus, so typing a note never marks anyone.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keysRef.current = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Fields that take typing; a checkbox or a button keeps the keys working.
      if (el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return;
      if (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type))
        return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'j') {
        if (nav.next) toCv(nav.next, 'next');
        else if (list && nav.at >= 0) setFinished(true);
      } else if (k === 'k') toCv(nav.prev, 'prev');
      else if (k in DECISION_KEY && d?.matchId && canMark && !d.vacancy.archived) {
        e.preventDefault();
        const to = DECISION_KEY[k]!;
        void setMark(d.decision.mark === to ? 'new' : to, undefined, auto && !!list);
      }
    };
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const back = list?.back ?? (d ? `/vacancies/${d.vacancy.id}/candidates` : '/candidates');
  const backLabel = list?.label ?? d?.vacancy.title ?? t('Candidates');
  const a = d?.analysis ?? null;
  const activeReq = a?.requirements.find((r) => r.requirementId === active);
  const reqGroups = useMemo(
    () => [
      ['must', t('Must-haves'), a?.requirements.filter((r) => r.kind === 'must') ?? []] as const,
      ['nice', t('Nice-to-haves'), a?.requirements.filter((r) => r.kind === 'nice') ?? []] as const,
      ['other', t('Other'), a?.requirements.filter((r) => r.kind === 'other') ?? []] as const,
    ],
    [a, t],
  );

  if (notFound)
    return (
      <div className="space-y-3">
        <a href={`#${back}`} className="text-sm text-link hover:underline">
          {t('← Back')}
        </a>
        <Notice kind="error">
          {t('This CV is not available to you, or it no longer exists.')}
        </Notice>
      </div>
    );
  if (error && !d)
    return (
      <div className="space-y-3">
        <a href={`#${back}`} className="text-sm text-link hover:underline">
          {t('← Back')}
        </a>
        <Notice kind="error">{error}</Notice>
        <button type="button" className={btnSecondary} onClick={() => void load()}>
          {t('Try again')}
        </button>
      </div>
    );
  if (!d) return <ReviewSkeleton label={t('Loading…')} />;

  const title = a?.label ?? d.name ?? d.pseudonym;
  const markable = canMark && !!d.matchId && !d.vacancy.archived;

  // ---------------------------------------------------------------- the analysis side
  const statusPanel = (() => {
    if (a) return null;
    switch (d.status) {
      case 'analyzing':
        return (
          <Notice kind="info">
            <p className="font-medium">{t('This CV is being analyzed.')}</p>
            <p>{t('The result appears here by itself. You can read the CV meanwhile.')}</p>
          </Notice>
        );
      case 'failed':
        return (
          <Notice kind="error">
            <p className="font-medium">{t('The analysis of this CV did not finish.')}</p>
            {d.statusDetail.error && <p className="mt-1">{d.statusDetail.error}</p>}
            {canMark && d.statusDetail.retryable && !d.vacancy.archived && (
              <button
                type="button"
                className={`${btnSecondary} mt-2`}
                disabled={retrying}
                onClick={() => void retry()}
              >
                {retrying ? t('Retrying…') : t('Retry the analysis')}
              </button>
            )}
          </Notice>
        );
      case 'unreadable':
      case 'needs_look':
        return (
          <Notice kind="warn">
            <p className="font-medium">{t(CV_STATUS_LABEL[d.status])}</p>
            <p className="mt-1">{d.statusDetail.reason}</p>
            <p className="mt-1">{t('Read the CV on the left and decide yourself.')}</p>
          </Notice>
        );
      case 'stopped':
        return (
          <Notice kind="info">
            <p className="font-medium">{t('The analysis was stopped before this CV.')}</p>
            <a className="mt-1 inline-block underline" href={`#/vacancies/${d.vacancy.id}`}>
              {t('Open the vacancy to continue')}
            </a>
          </Notice>
        );
      case 'not_analyzed':
        return (
          <Notice kind="info">
            <p className="font-medium">{t(CV_STATUS_LABEL.not_analyzed)}</p>
            <a className="mt-1 inline-block underline" href={`#/vacancies/${d.vacancy.id}`}>
              {t('Open the vacancy to re-analyze')}
            </a>
          </Notice>
        );
      case 'erased':
        return (
          <Notice kind="info">{t('This CV was erased. Its file and its text are gone.')}</Notice>
        );
      default:
        return <Notice kind="info">{t(CV_STATUS_LABEL[d.status])}</Notice>;
    }
  })();

  const analysisPane = (
    <div className="space-y-4" data-testid="analysis-pane">
      {statusPanel}
      {a && d.status === 'needs_look' && d.statusDetail.reason && (
        <Notice kind="warn">{d.statusDetail.reason}</Notice>
      )}
      {a?.outOfDate && (
        <Notice kind="warn">
          <p className="font-medium">
            {a.reanalyzing
              ? t('Re-analyzing against the new requirements…')
              : t('Out of date: this match was scored against earlier requirements.')}
          </p>
          {a.outOfDate.changes.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {a.outOfDate.changes.slice(0, 4).map((c) => (
                <li key={c.version}>
                  {when(c.at)} · {c.by}
                  {c.description ? `: ${c.description}` : ''}
                </li>
              ))}
            </ul>
          )}
          <a className="mt-1 inline-block underline" href={`#/vacancies/${d.vacancy.id}`}>
            {t('Open the vacancy to re-analyze')}
          </a>
        </Notice>
      )}
      {a?.summary && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink-2">{t('Summary')}</h2>
          <p className="text-sm">{a.summary}</p>
        </section>
      )}
      {reqGroups.map(([key, heading, items]) =>
        items.length === 0 ? null : (
          <section key={key} aria-label={heading}>
            <h2 className="mb-2 text-sm font-semibold text-ink-2">{heading}</h2>
            <ul className="space-y-2">
              {items.map((r, i) => {
                const on = active === r.requirementId;
                return (
                  <li
                    key={r.requirementId}
                    style={{ '--i': Math.min(i, 10) } as CSSProperties}
                    className={`m-rise rounded-md border p-3 text-sm transition-colors ${on ? 'border-accent bg-sel' : 'border-line bg-card'}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-medium">{r.text}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_STYLE[r.state]}`}
                      >
                        {r.state === 'matched' && !r.unclear && (
                          <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
                            <path
                              d="M2.5 6.5 5 9l4.5-6"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              pathLength={1}
                              className="m-draw"
                              style={{ '--i': Math.min(i, 10) } as CSSProperties}
                            />
                          </svg>
                        )}
                        {stateName(r)}
                      </span>
                    </div>
                    {r.rationale && <p className="mt-1 text-ink-2">{r.rationale}</p>}
                    {r.anchors.length > 0 ? (
                      <div className="mt-2">
                        <button
                          type="button"
                          className="text-link underline"
                          aria-pressed={on}
                          onClick={() => {
                            setActive(on ? null : r.requirementId);
                            setNudge((n) => n + 1);
                            setView('cv');
                          }}
                        >
                          {on ? t('Hide in CV') : t('Show in CV')}
                        </button>
                        {r.anchors[0]!.page && (
                          <span className="ml-2 text-xs text-ink-3">
                            {t('Page {n}', { n: r.anchors[0]!.page })}
                          </span>
                        )}
                      </div>
                    ) : (
                      r.state !== 'matched' && (
                        <p className="mt-1 text-xs text-ink-3">{t('Nothing to show in the CV.')}</p>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
      {a && a.history.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink-2">{t('Decision history')}</h2>
          <ul className="space-y-1 text-sm text-ink-2">
            {a.history.map((h, i) => (
              <li key={i}>
                {markName(h.mark)} · {h.by} · {ago(h.at)}
                {h.note ? ` · ${h.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  const prevNext = (cls: string) => (
    <nav aria-label={t('Previous and next')} className={cls}>
      {nav.prev ? (
        <a
          className={btnSecondary}
          href={reviewHref(nav.prev, listId)}
          onClick={() => navDirection('prev')}
          title={t('Previous CV (K)')}
        >
          {t('‹ Previous CV')}
        </a>
      ) : (
        <span role="link" aria-disabled="true" className={`${btnSecondary} opacity-50`}>
          {t('‹ Previous CV')}
        </span>
      )}
      <span className="text-ink-3" aria-hidden="true">
        {t('CV {a} of {b}', { a: nav.at + 1, b: nav.total })}
      </span>
      {nav.next ? (
        <a
          className={btnSecondary}
          href={reviewHref(nav.next, listId)}
          onClick={() => navDirection('next')}
          title={t('Next CV (J)')}
        >
          {t('Next CV ›')}
        </a>
      ) : (
        <span role="link" aria-disabled="true" className={`${btnSecondary} opacity-50`}>
          {t('Next CV ›')}
        </span>
      )}
    </nav>
  );

  return (
    <div className={`@container space-y-4 ${list && nav.at >= 0 ? 'pb-16 md:pb-0' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm md:sticky md:top-14 md:z-10 md:bg-page md:py-1">
        <a href={`#${back}`} className="text-link hover:underline">
          {t('← Back to {list}', { list: backLabel })}
        </a>
        {list && nav.at >= 0 && prevNext('hidden items-center gap-2 md:flex')}
      </div>
      {list && nav.at >= 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card px-4 py-2 md:hidden">
          {prevNext('flex items-center justify-between gap-2')}
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {list && nav.at >= 0
          ? t('CV {a} of {b}: {name}', { a: nav.at + 1, b: nav.total, name: title })
          : title}
      </p>

      {error && <Notice kind="error">{error}</Notice>}
      {finished && list && listId && (
        <SprintDone
          listId={listId}
          backHref={`#${back}`}
          backLabel={backLabel}
          onAgain={() => {
            clearTally(listId);
            setFinished(false);
            toCv(list.ids[0], 'prev');
          }}
        />
      )}

      <header className="relative isolate flex flex-wrap items-start justify-between gap-4 overflow-hidden rounded-2xl border border-line bg-card p-4">
        {wash > 0 && (
          <span
            key={wash}
            aria-hidden="true"
            className={`m-wash pointer-events-none absolute inset-0 -z-10 ${MARK_STYLE[d.decision.mark]}`}
          />
        )}
        <div className="flex min-w-0 items-start gap-4">
          {a && (
            <ScoreDial
              key={d.documentId}
              score={a.score}
              size={64}
              label={t('Match {n}%', { n: Math.round(a.score) })}
            />
          )}
          <div className="min-w-0">
            <h1
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-bold tracking-tight focus:outline-none"
            >
              {title}
            </h1>
            <p className="mt-0.5 text-sm text-ink-2">
              <a className="text-link hover:underline" href={`#/vacancies/${d.vacancy.id}`}>
                {d.vacancy.title}
              </a>
              {a?.email && <> · {a.email}</>}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[d.status] ?? 'bg-neutral text-ink'}`}
              >
                {t(CV_STATUS_LABEL[d.status])}
              </span>
              {a && (
                <>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_STYLE[a.band]}`}
                  >
                    {t(BAND_NAME[a.band])}
                  </span>
                  <span className="text-ink-2">
                    {t('Must-haves {a} of {b}', { a: a.mustFound, b: a.mustTotal })}
                  </span>
                  <span className="text-ink-3">
                    {t('Analyzed {when}', { when: ago(a.analyzedAt) })}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        {d.matchId && (
          <div className="w-full space-y-2 sm:w-72">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink-2">{t('Decision')}</span>
              <MarkSelect
                size="md"
                value={d.decision.mark}
                label={title}
                disabled={!markable}
                onChange={(m) => void setMark(m)}
              />
            </div>
            {markable && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                <span className="hidden sm:inline" aria-hidden="true">
                  <kbd className={KBD}>S</kbd> {markName('shortlist')} ·{' '}
                  <kbd className={KBD}>M</kbd> {markName('maybe')} · <kbd className={KBD}>N</kbd>{' '}
                  {markName('not_now')}
                </span>
                {list && nav.at >= 0 && (
                  <label className="flex min-h-8 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      role="switch"
                      className="peer sr-only"
                      checked={auto}
                      onChange={(e) => {
                        setAuto(e.target.checked);
                        setAutoNext(e.target.checked);
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className="relative inline-block h-4 w-7 rounded-full bg-neutral transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-focus after:absolute after:top-0.5 after:left-0.5 after:h-3 after:w-3 after:rounded-full after:bg-card after:shadow after:transition-transform peer-checked:after:translate-x-3 motion-reduce:after:transition-none"
                    />
                    {t('Next CV after a key decision')}
                  </label>
                )}
              </div>
            )}
            {markable && (
              <>
                <label className="block text-sm">
                  <span className="sr-only">{t('Note')}</span>
                  <textarea
                    className={`${input} h-16`}
                    maxLength={2000}
                    placeholder={t('Add a note (optional)')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={note === (d.decision.note ?? '')}
                  onClick={() => void setMark(d.decision.mark, note)}
                >
                  {t('Save note')}
                </button>
              </>
            )}
            {d.decision.decidedBy && (
              <p className="text-xs text-ink-3">
                {t('Marked by {name} {when}', {
                  name: d.decision.decidedBy,
                  when: ago(d.decision.decidedAt!),
                })}
              </p>
            )}
          </div>
        )}
      </header>

      {assistant?.features.linkReview && a && matchId && (
        <CandidateLinks matchId={matchId} canEdit={canMark} />
      )}

      <Segmented
        label={t('View')}
        className="@min-[60rem]:hidden"
        stretch
        value={view}
        onChange={setView}
        items={[
          { key: 'cv', label: t('CV') },
          { key: 'analysis', label: t('Analysis') },
        ]}
      />

      <div ref={box} className="flex flex-col gap-4 @min-[60rem]:flex-row @min-[60rem]:gap-0">
        <div
          className={`${view === 'cv' ? '' : 'hidden'} min-w-0 @min-[60rem]:block`}
          style={{ flexBasis: `${split}%`, flexGrow: 0, flexShrink: 0 }}
          data-testid="cv-pane"
        >
          <div className="@min-[60rem]:sticky @min-[60rem]:top-28 @min-[60rem]:pr-3">
            <CvPane
              key={d.documentId}
              data={d}
              anchors={activeReq?.anchors ?? []}
              focus={nudge}
              activeId={active}
              onPick={(id) => {
                setActive(id);
                setNudge((n) => n + 1);
              }}
            />
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('Resize the panes')}
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          aria-valuenow={Math.round(split)}
          tabIndex={0}
          onPointerDown={drag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit((s) => Math.max(MIN, s - 2));
            else if (e.key === 'ArrowRight') setSplit((s) => Math.min(MAX, s + 2));
            else if (e.key === 'Home') setSplit(MIN);
            else if (e.key === 'End') setSplit(MAX);
            else return;
            e.preventDefault();
          }}
          className="hidden w-2 shrink-0 cursor-col-resize rounded bg-line hover:bg-edge focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none @min-[60rem]:block"
        />
        <div
          className={`${view === 'analysis' ? '' : 'hidden'} min-w-0 flex-1 @min-[60rem]:block @min-[60rem]:pl-3`}
        >
          {analysisPane}
        </div>
      </div>
      <UndoBar toast={toast} onDone={dismiss} label={t('Undo')} />
    </div>
  );
}

const MARK_DOT = { shortlist: 'bg-ok-text', maybe: 'bg-warn-text', not_now: 'bg-err-ink' } as const;

const KBD =
  'rounded border border-line bg-card px-1 font-mono text-[0.7rem] leading-4 text-ink-2 shadow-[0_1px_0_var(--c-line)]';

/** The end of a review sprint: what was decided in this list, and where to go next. */
function SprintDone({
  listId,
  backHref,
  backLabel,
  onAgain,
}: {
  listId: string;
  backHref: string;
  backLabel: string;
  onAgain: () => void;
}) {
  const t = useT();
  const tally = tallyOf(listId);
  const parts = (['shortlist', 'maybe', 'not_now'] as const).filter((m) => tally[m] > 0);
  return (
    <section
      aria-labelledby="sprint-done"
      className="m-rise flex items-start gap-3 rounded-2xl border border-ok-line bg-ok p-4 text-ok-ink"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0">
        <circle
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          pathLength={1}
          className="m-draw"
        />
        <path
          d="M7.5 12.5 10.5 15.5 16.5 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="m-draw"
          style={{ '--i': 4 } as CSSProperties}
        />
      </svg>
      <div className="min-w-0 space-y-2">
        <h2 id="sprint-done" className="font-semibold" tabIndex={-1}>
          {t('That was the last CV in this list.')}
        </h2>
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
          {tally.total === 0
            ? t('No decisions were made with the keys in this review.')
            : t('Decided in this review:')}
          {parts.map((m, i) => (
            <span
              key={m}
              className="m-pop inline-flex items-center gap-1.5 rounded-full border border-ok-line bg-card px-2.5 py-0.5 text-xs font-semibold text-ink tabular-nums"
              style={{ animationDelay: `${200 + i * 120}ms` }}
            >
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${MARK_DOT[m]}`} />
              {tally[m]} {markName(m)}
            </span>
          ))}
        </p>
        <div className="flex flex-wrap gap-2">
          <a className={btnPrimary} href={backHref}>
            {t('← Back to {list}', { list: backLabel })}
          </a>
          <button type="button" className={btnSecondary} onClick={onAgain}>
            {t('Start again from the first CV')}
          </button>
        </div>
      </div>
    </section>
  );
}

/** While a CV loads: the shape of the screen, softly lit, instead of a bare "Loading…". */
function ReviewSkeleton({ label }: { label: string }) {
  const bar = 'rounded-full bg-neutral';
  return (
    <div role="status" aria-busy="true" className="@container space-y-4">
      <span className="sr-only">{label}</span>
      <div className="m-loading flex items-center gap-4 rounded-2xl border border-line bg-card p-4">
        <span className="h-16 w-16 shrink-0 rounded-full border-[6px] border-neutral" />
        <span className="flex-1 space-y-2">
          <span className={`${bar} block h-5 w-56`} />
          <span className={`${bar} block h-3 w-40`} />
          <span className={`${bar} block h-3 w-72`} />
        </span>
      </div>
      <div className="grid gap-4 @min-[60rem]:grid-cols-2">
        <div className="m-loading h-96 rounded-2xl bg-neutral/40 p-3">
          <span className="block h-full rounded-sm bg-card shadow-sm" />
        </div>
        <div className="m-loading space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="block h-20 rounded-md border border-line bg-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
