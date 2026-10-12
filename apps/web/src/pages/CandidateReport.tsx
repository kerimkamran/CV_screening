import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mark } from '@cv/shared';
import { api, ApiError } from '../api';
import { go } from '../route';
import { registerAssistantTarget, useAssistantConfig } from '../assistant';
import { tr, useT } from '../i18n';
import {
  ago,
  BAND_NAME,
  BAND_STYLE,
  markName,
  type CandidateReportData,
  type MarkResult,
  type PoolPage,
  type ReportAnchor,
  type ReportRequirement,
  type ResumeData,
} from '../pool';
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
import { ORIGIN_KEY, type Origin } from './CandidatePool';
import { MarkSelect } from './MarkSelect';

/**
 * The candidate report (Development Plan WP 3.5 and 3.6): the stored match on one side, the resume
 * as written on the other. A skill's "Show in resume" jumps to the lines it was found in. Previous
 * and Next follow the list the person came from; Back returns to it as they left it.
 */

const SPLIT_KEY = 'cv-report-split';
const MIN = 28;
const MAX = 72;

function readOrigin(): Origin | null {
  try {
    const o = JSON.parse(sessionStorage.getItem(ORIGIN_KEY) ?? 'null') as Origin | null;
    return o && Array.isArray(o.ids) ? o : null;
  } catch {
    return null;
  }
}

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

/** The resume as text with the chosen lines marked and page numbers in the margin. */
function ResumeText({
  data,
  anchors,
  focus,
}: {
  data: ResumeData;
  anchors: ReportAnchor[];
  focus: number;
}) {
  const t = useT();
  const first = useRef<HTMLElement | null>(null);
  const text = data.text;
  const ranges = useMemo(() => {
    const r = anchors
      .map((a) => [a.start, a.end] as [number, number])
      .filter(([a, b]) => b > a && a >= 0 && a < text.length)
      .map(([a, b]) => [a, Math.min(b, text.length)] as [number, number])
      .sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const x of r) {
      const last = merged.at(-1);
      if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
      else merged.push([...x]);
    }
    return merged;
  }, [anchors, text.length]);

  useEffect(() => {
    first.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [focus, ranges]);

  // Cut points: highlight edges and page starts.
  const cuts = new Set<number>([0, text.length]);
  for (const [a, b] of ranges) {
    cuts.add(a);
    cuts.add(b);
  }
  const pages = new Map<number, number>();
  data.pageStarts?.forEach((o, i) => {
    if (o > 0 && o < text.length) {
      cuts.add(o);
      pages.set(o, i + 1);
    }
  });
  const pts = [...cuts].sort((a, b) => a - b);
  const inRange = (o: number) => ranges.some(([a, b]) => o >= a && o < b);
  let setFirst = false;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const piece = text.slice(a, b);
    if (pages.has(a))
      out.push(
        <span
          key={`p${a}`}
          className="my-2 block border-t border-dashed border-line pt-1 text-xs text-ink-3"
        >
          {t('Page {n}', { n: pages.get(a)! })}
        </span>,
      );
    if (inRange(a)) {
      const isFirst = !setFirst;
      setFirst = true;
      out.push(
        <mark
          key={a}
          ref={isFirst ? (el) => void (first.current = el) : undefined}
          className="rounded bg-warn px-0.5 text-warn-ink"
        >
          {piece}
        </mark>,
      );
    } else out.push(<span key={a}>{piece}</span>);
  }
  return (
    <div
      tabIndex={0}
      aria-label={t('Resume')}
      className="max-h-[calc(100vh-14rem)] min-h-[20rem] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-card p-4 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
    >
      {out}
      {data.truncated && (
        <p className="mt-3 text-xs text-ink-3">
          {t('Only the first part of this resume is shown.')}
        </p>
      )}
    </div>
  );
}

export function CandidateReport({ id, canMark }: { id: string; canMark: boolean }) {
  const t = useT();
  const assistant = useAssistantConfig();
  const [d, setD] = useState<CandidateReportData | null>(null);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [resumeError, setResumeError] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);
  const [note, setNote] = useState('');
  const [phoneView, setPhoneView] = useState<'report' | 'resume'>('report');
  const [split, setSplit] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(SPLIT_KEY));
      return v >= MIN && v <= MAX ? v : 45;
    } catch {
      return 45;
    }
  });
  const [others, setOthers] = useState<{ screeningId: string; label: string }[]>([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const origin = useMemo(() => readOrigin(), [id]);
  const { toast, show, dismiss } = useUndoToast();
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get<CandidateReportData>(`/candidates/${id}/report`);
      setD(r);
      setNote(r.decision.note ?? '');
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);
  useEffect(() => {
    setD(null);
    setResume(null);
    setActive(null);
    void load();
    api
      .get<ResumeData>(`/candidates/${id}/resume`)
      .then(setResume, (e) => setResumeError(errMsg(e)));
  }, [id, load]);

  // Who "Compare with…" can offer: the other analyzed resumes of this vacancy.
  useEffect(() => {
    if (!d) return;
    api.get<PoolPage>(`/candidates?vacancy=${d.vacancy.id}&limit=100&sort=match`).then(
      (p) =>
        setOthers(
          p.rows
            .filter((r) => r.matchId !== id)
            .map((r) => ({ screeningId: r.matchId, label: r.label })),
        ),
      () => undefined,
    );
  }, [d?.vacancy.id, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell SenAI which candidate is open.
  useEffect(() => {
    if (!d || !assistant) return;
    registerAssistantTarget({
      target: { screeningId: id, label: d.label, band: d.band },
      others,
      onEditRequirement: () => {
        go(`/vacancies/${d.vacancy.id}/criteria`);
      },
    });
    return () => registerAssistantTarget(null);
  }, [d, assistant, id, others]);

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
  async function setMark(to: Mark, withNote?: string) {
    if (!d || !canMark) return;
    const before = d.decision;
    try {
      const res = await api.put<MarkResult>(`/candidates/${id}/decision`, {
        mark: to,
        note: withNote ?? (to === before.mark ? note || null : null),
        expectedVersion: before.version,
      });
      await load();
      if (to !== before.mark)
        show(t('Marked {mark}.', { mark: markName(to) }), async () => {
          try {
            await api.put(`/candidates/${id}/decision`, {
              mark: res.previous.mark,
              note: res.previous.note,
              expectedVersion: res.version,
            });
          } catch (e) {
            setError(errMsg(e));
          }
          await load();
        });
    } catch (e) {
      setError(errMsg(e));
      if (e instanceof ApiError && e.code === 'STALE_VERSION') await load();
    }
  }

  // ---------------------------------------------------------------- previous / next
  const at = origin ? origin.ids.indexOf(id) : -1;
  const prev = at > 0 ? origin!.ids[at - 1] : undefined;
  const next = at >= 0 && at < (origin?.ids.length ?? 0) - 1 ? origin!.ids[at + 1] : undefined;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'j' && next) go(`/candidates/${next}`);
      if (e.key === 'k' && prev) go(`/candidates/${prev}`);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [prev, next]);

  const back = origin?.back ?? '/candidates';
  const activeReq = d?.requirements.find((r) => r.requirementId === active);
  const reqGroups = useMemo(
    () => [
      ['must', t('Must-haves'), d?.requirements.filter((r) => r.kind === 'must') ?? []] as const,
      ['nice', t('Nice-to-haves'), d?.requirements.filter((r) => r.kind === 'nice') ?? []] as const,
      ['other', t('Other'), d?.requirements.filter((r) => r.kind === 'other') ?? []] as const,
    ],
    [d, t],
  );

  if (error && !d)
    return (
      <div className="space-y-3">
        <a href={`#${back}`} className="text-sm text-link hover:underline">
          {t('← Back')}
        </a>
        <Notice kind="error">{error}</Notice>
      </div>
    );
  if (!d) return <p className="text-sm text-ink-3">{t('Loading…')}</p>;

  const title = d.label;
  const report = (
    <div className="space-y-4">
      {d.outOfDate && (
        <Notice kind="warn">
          <p className="font-medium">
            {d.reanalyzing
              ? t('Re-analyzing against the new requirements…')
              : t('Out of date: this match was scored against earlier requirements.')}
          </p>
          {d.outOfDate.changes.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {d.outOfDate.changes.slice(0, 4).map((c) => (
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
      {d.summary && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink-2">{t('Summary')}</h2>
          <p className="text-sm">{d.summary}</p>
        </section>
      )}
      {reqGroups.map(([key, heading, list]) =>
        list.length === 0 ? null : (
          <section key={key} aria-label={heading}>
            <h2 className="mb-2 text-sm font-semibold text-ink-2">{heading}</h2>
            <ul className="space-y-2">
              {list.map((r) => {
                const on = active === r.requirementId;
                return (
                  <li
                    key={r.requirementId}
                    className={`rounded-md border p-3 text-sm ${on ? 'border-accent bg-sel' : 'border-line bg-card'}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-medium">{r.text}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATE_STYLE[r.state]}`}
                      >
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
                            setPhoneView('resume');
                          }}
                        >
                          {on ? t('Hide in resume') : t('Show in resume')}
                        </button>
                        {r.anchors[0]!.page && (
                          <span className="ml-2 text-xs text-ink-3">
                            {t('Page {n}', { n: r.anchors[0]!.page })}
                          </span>
                        )}
                      </div>
                    ) : (
                      r.state !== 'matched' && (
                        <p className="mt-1 text-xs text-ink-3">
                          {t('Nothing to show in the resume.')}
                        </p>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
      {d.history.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink-2">{t('Decision history')}</h2>
          <ul className="space-y-1 text-sm text-ink-2">
            {d.history.map((h, i) => (
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

  const resumePane = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <h2 className="font-semibold text-ink-2">
          {t('Resume')}
          {d.filename && <span className="ml-2 font-normal text-ink-3">{d.filename}</span>}
        </h2>
      </div>
      {resumeError && <Notice kind="error">{resumeError}</Notice>}
      {!resume && !resumeError && <p className="text-sm text-ink-3">{t('Loading…')}</p>}
      {resume && <ResumeText data={resume} anchors={activeReq?.anchors ?? []} focus={nudge} />}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <a href={`#${back}`} className="text-link hover:underline">
          {origin ? t('← Back to {list}', { list: origin.label }) : t('← Back')}
        </a>
        {origin && at >= 0 && (
          <nav aria-label={t('Previous and next')} className="flex items-center gap-2">
            <span className="text-ink-3">
              {t('{a} of {b}', { a: at + 1, b: origin.ids.length })}
            </span>
            {prev ? (
              <a className={btnSecondary} href={`#/candidates/${prev}`} title={t('Previous (K)')}>
                {t('Previous')}
              </a>
            ) : (
              <span role="link" aria-disabled="true" className={`${btnSecondary} opacity-50`}>
                {t('Previous')}
              </span>
            )}
            {next ? (
              <a className={btnSecondary} href={`#/candidates/${next}`} title={t('Next (J)')}>
                {t('Next')}
              </a>
            ) : (
              <span role="link" aria-disabled="true" className={`${btnSecondary} opacity-50`}>
                {t('Next')}
              </span>
            )}
          </nav>
        )}
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-line bg-card p-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            <a className="text-link hover:underline" href={`#/vacancies/${d.vacancy.id}`}>
              {d.vacancy.title}
            </a>
            {d.email && <> · {d.email}</>}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-lg font-semibold tabular-nums">{Math.round(d.score)}%</span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BAND_STYLE[d.band]}`}>
              {t(BAND_NAME[d.band])}
            </span>
            <span className="text-ink-2">
              {t('Must-haves {a} of {b}', { a: d.mustFound, b: d.mustTotal })}
            </span>
            <span className="text-ink-3">{t('Analyzed {when}', { when: ago(d.analyzedAt) })}</span>
          </p>
        </div>
        <div className="w-full space-y-2 sm:w-72">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-2">{t('Decision')}</span>
            <MarkSelect
              size="md"
              value={d.decision.mark}
              label={d.label}
              disabled={!canMark || d.vacancy.archived}
              onChange={(m) => void setMark(m)}
            />
          </div>
          {canMark && !d.vacancy.archived && (
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
      </header>

      <div
        role="tablist"
        aria-label={t('View')}
        className="flex gap-1 rounded-md border border-line bg-card p-1 lg:hidden"
      >
        {(['report', 'resume'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={phoneView === k}
            onClick={() => setPhoneView(k)}
            className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${phoneView === k ? 'bg-accent text-on-accent' : 'text-ink-2'}`}
          >
            {k === 'report' ? t('Report') : t('Resume')}
          </button>
        ))}
      </div>

      <div ref={box} className="flex flex-col gap-4 lg:flex-row lg:gap-0">
        <div
          className={`${phoneView === 'report' ? '' : 'hidden'} min-w-0 lg:block`}
          style={{ flexBasis: `${split}%`, flexGrow: 0, flexShrink: 0 }}
          data-testid="report-pane"
        >
          <div className="lg:pr-3">{report}</div>
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
          className="hidden w-2 shrink-0 cursor-col-resize rounded bg-line hover:bg-edge focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none lg:block"
        />
        <div
          className={`${phoneView === 'resume' ? '' : 'hidden'} min-w-0 flex-1 lg:block lg:pl-3`}
          data-testid="resume-pane"
        >
          <div className="lg:sticky lg:top-16">{resumePane}</div>
        </div>
      </div>
      <UndoBar toast={toast} onDone={dismiss} label={t('Undo')} />
    </div>
  );
}
