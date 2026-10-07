import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { api, type Adjustments, type CandidateRow, type Kind } from '../api';
import {
  BAND_LABEL,
  bandMoves,
  isPending,
  layoutStars,
  linkStars,
  matchBand,
  nextStar,
  orderCandidates,
  pseudonyms,
  STAR_COLOUR,
  STAR_SIZE,
  type MatchBand,
} from '../results-logic';
import { btnSecondary, errMsg, Notice } from '../ui';
import { setFocus, useFocus } from '../focus';
import { useIntake } from '../intake';
import { shortlistCsv, shortlistEntries, shortlistText } from '../shortlist';
import { CandidateCard, type Detail } from './CandidateCard';
import { useAssistantConfig, useAssistantOpen, setAssistantOpen } from '../assistant';
import { AssistantPanel } from './AssistantPanel';
import { RequirementsDrawer } from './RequirementsDrawer';

/**
 * Results (design spec 6.2): a plain band for each candidate, why, and the proof behind each skill,
 * with names hidden until the recruiter chooses to show them. The star map is only a picture of the
 * ranked list: a star's place carries no meaning beyond rank.
 */

interface Listing {
  counts: {
    total: number;
    queued: number;
    stopped?: number;
    failed: number;
    manual: number;
    undecided: number;
  };
  aiActive: boolean;
  candidates: CandidateRow[];
}
const PAGE = 20;
const MAP_TOP = 12;
const MAP_MAX = 79;
const LABELS_ON_MAP = 5;

export function Results({ vacancyId, onTable }: { vacancyId: string; onTable: () => void }) {
  const t = useT();
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const focusOn = useFocus();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [revealedLoaded, setRevealedLoaded] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [mapAll, setMapAll] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [details, setDetails] = useState<Record<string, Detail | 'loading' | 'error'>>({});
  const [proof, setProof] = useState<{ doc: string; req: string } | null>(null);

  const intake = useIntake(vacancyId);
  const sending = intake !== null && intake.sent < intake.total;
  const [skipped, setSkipped] = useState<{ filename: string; reason: string }[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [adj, setAdj] = useState<Adjustments | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [adjNote, setAdjNote] = useState('');
  const [adjError, setAdjError] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);
  const [drawerFocus, setDrawerFocus] = useState<string | null>(null);
  const assistant = useAssistantConfig();
  const assistantOpen = useAssistantOpen();

  const load = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([
        api.get<Listing>(`/vacancies/${vacancyId}/candidates`),
        api.get<Adjustments>(`/vacancies/${vacancyId}/adjustments`).catch(() => null),
      ]);
      setData(l);
      setAdj(a && Array.isArray(a.requirements) ? a : null);
      setError('');
    } catch (e) {
      setError(errMsg(e));
    }
  }, [vacancyId]);
  useEffect(() => void load(), [load]);
  // Files that were not taken in are listed, never dropped silently (spec 6.1.4).
  const sentCount = intake?.sent ?? 0;
  useEffect(() => {
    api
      .get<{ skipped: { filename: string; reason: string }[] }>(`/vacancies/${vacancyId}/skipped`)
      .then(
        (r) => setSkipped(Array.isArray(r?.skipped) ? r.skipped : []),
        () => undefined,
      );
  }, [vacancyId, sentCount, data?.counts.total]);
  // While files are still going up, keep looking for the ones already read.
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [sending, load]);
  const pending = data?.counts.queued ?? 0;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [pending, load]);

  const all = useMemo(() => data?.candidates ?? [], [data]);
  // Names this recruiter has already shown in this run come back from the audit trail.
  useEffect(() => {
    if (!data || revealedLoaded) return;
    setRevealedLoaded(true);
    api.get<{ screeningIds: string[] }>(`/vacancies/${vacancyId}/revealed`).then(
      (x) => {
        if (!Array.isArray(x?.screeningIds)) return;
        const bySid = new Map(data.candidates.map((r) => [r.screeningId, r.documentId]));
        setRevealed(
          (s) =>
            new Set([
              ...s,
              ...x.screeningIds.map((id) => bySid.get(id)).filter((d): d is string => !!d),
            ]),
        );
      },
      () => undefined,
    );
  }, [data, revealedLoaded, vacancyId]);
  const names = useMemo(() => pseudonyms(all), [all]);
  const ordered = useMemo(() => orderCandidates(all.filter((r) => !r.erased)), [all]);
  const bandOf = useMemo(
    () => new Map(ordered.map((r) => [r.documentId, matchBand(r)])),
    [ordered],
  );
  const inBand = (...b: MatchBand[]) =>
    ordered.filter((r) => b.includes(bandOf.get(r.documentId)!));
  const ranked = inBand('strong', 'good', 'partial');
  const limited = inBand('limited');
  const human = inBand('human').filter((r) => !isPending(r) && r.state !== 'stopped');
  const scored = [...ranked, ...limited];
  const stoppedCount = data?.counts.stopped ?? 0;
  const read = (data?.counts.total ?? 0) - pending - stoppedCount;
  const [busy, setBusy] = useState(false);
  async function runControl(path: 'stop' | 'continue') {
    setBusy(true);
    try {
      await api.post(`/vacancies/${vacancyId}/${path}`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const rowById = useMemo(() => new Map(all.map((r) => [r.documentId, r])), [all]);
  const nameOf = (r: CandidateRow) =>
    revealed.has(r.documentId) ? r.candidateName || r.filename : names.get(r.documentId)!;

  // The first candidate is selected on load, as in the prototype.
  useEffect(() => {
    if (selected === null && ranked[0]) setSelected(ranked[0].documentId);
  }, [selected, ranked]);

  // Fetch the reasons and quotes for the selected candidate once.
  const needDetail = selected ? rowById.get(selected)?.screeningId : null;
  const have = selected ? details[selected] : undefined;
  useEffect(() => {
    if (!selected || !needDetail || have) return;
    setDetails((d) => ({ ...d, [selected]: 'loading' }));
    api.get<Detail>(`/screenings/${needDetail}`).then(
      (x) => setDetails((d) => ({ ...d, [selected]: x })),
      () => setDetails((d) => ({ ...d, [selected]: 'error' })),
    );
  }, [selected, needDetail, have]);

  function select(id: string, scroll = false) {
    setSelected(id);
    setProof(null);
    const idx = ranked.findIndex((r) => r.documentId === id);
    if (idx >= shown) setShown(Math.ceil((idx + 1) / PAGE) * PAGE);
    if (scroll) {
      setTimeout(
        () => document.getElementById(`card-${id}`)?.scrollIntoView?.({ block: 'nearest' }),
        0,
      );
    }
  }

  async function reveal(rows: CandidateRow[]) {
    const withIds = rows.filter((r) => r.screeningId);
    try {
      await api.post('/screenings/reveal-names', {
        screeningIds: withIds.map((r) => r.screeningId).slice(0, 500),
      });
      setRevealed((s) => new Set([...s, ...withIds.map((r) => r.documentId)]));
      setConfirmAll(false);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function hide(r: CandidateRow) {
    setRevealed((s) => {
      const n = new Set(s);
      n.delete(r.documentId);
      return n;
    });
    if (r.screeningId) {
      await api
        .post('/screenings/hide-names', { screeningIds: [r.screeningId] })
        .catch((e) => setError(errMsg(e)));
    }
  }
  async function setFocusPref(next: boolean) {
    setFocus(next);
    await api.put('/me/preferences', { focusOnSkills: next }).catch(() => undefined);
  }

  const marked = (o: string) => ordered.filter((r) => r.decision?.outcome === o).length;
  const entries = shortlistEntries(ordered, nameOf);
  const [copied, setCopied] = useState('');
  async function copyShortlist() {
    try {
      await navigator.clipboard.writeText(shortlistText(entries));
      setCopied(t('Copied.'));
    } catch {
      setCopied(t('Your browser did not allow copying. Use the CSV instead.'));
    }
  }
  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([shortlistCsv(entries)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shortlist.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function adjust(path: string, body?: object) {
    const before = new Map(bandOf);
    setAdjBusy(true);
    setAdjError('');
    try {
      await api.post(`/vacancies/${vacancyId}/adjustments${path}`, body);
      const l = await api.get<Listing>(`/vacancies/${vacancyId}/candidates`);
      const a = await api.get<Adjustments>(`/vacancies/${vacancyId}/adjustments`);
      setData(l);
      setAdj(a);
      const nowBand = new Map(
        l.candidates.filter((r) => !r.erased).map((r) => [r.documentId, matchBand(r)]),
      );
      setAdjNote(
        path === '/reset' ? t('Back to the original ranking.') : bandMoves(before, nowBand).line,
      );
    } catch (e) {
      setAdjError(errMsg(e));
    } finally {
      setAdjBusy(false);
    }
  }
  /** From the assistant: show what making a requirement nice-to-have would do, then open the drawer. */
  async function openEdit(requirementId: string, text: string) {
    setAdjError('');
    setDrawerFocus(requirementId);
    setDrawer(true);
    setAdjNote(t('Checking what this would change…'));
    try {
      const r = await api.post<{ scores: Record<string, number | null> }>(
        `/vacancies/${vacancyId}/adjustments/preview`,
        { requirementId, to: 'preferred' },
      );
      const after = new Map<string, MatchBand>();
      for (const row of all) {
        const v = r.scores[row.documentId];
        if (row.erased || v == null || !row.score) continue;
        after.set(row.documentId, matchBand({ ...row, score: { ...row.score, value: v } }));
      }
      setAdjNote(
        t('What if “{text}” were nice-to-have: {line} Nothing changes until you choose it below.', {
          text,
          line: bandMoves(bandOf, after).line,
        }),
      );
    } catch (e) {
      setAdjNote('');
      setAdjError(errMsg(e));
    }
  }
  const selectedRow = selected ? rowById.get(selected) : undefined;
  const target =
    selectedRow?.screeningId &&
    bandOf.get(selectedRow.documentId) &&
    bandOf.get(selectedRow.documentId) !== 'human'
      ? {
          screeningId: selectedRow.screeningId,
          label: names.get(selectedRow.documentId)!,
          band: bandOf.get(selectedRow.documentId)!,
        }
      : null;
  const compareChoices = scored
    .filter((r) => r.screeningId && r.documentId !== selected)
    .map((r) => ({ screeningId: r.screeningId!, label: names.get(r.documentId)! }));
  const askAbout = (documentId: string) => {
    setSelected(documentId);
    setAssistantOpen(true);
  };
  const missedByOne = scored.filter((r) => r.score?.breakdown.mandatoryGaps === 1);

  const mapRows = scored.slice(0, mapAll ? MAP_MAX : MAP_TOP);
  const stars = layoutStars(mapRows.map((r) => r.documentId));
  const links = linkStars(mapRows.length);
  const counts = (b: MatchBand) => (b === 'human' ? human.length : inBand(b).length);

  if (error && !data) return <Notice kind="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-ink-3">{t('Loading…')}</p>;
  if (data.counts.total === 0) {
    return (
      <Notice kind="info">
        {t('No resumes yet. Start a screening from')}{' '}
        <a className="underline" href="#/">
          {t('New screening')}
        </a>
        {t(', or upload on the Table tab.')}
      </Notice>
    );
  }

  return (
    <div className={`space-y-5 ${assistantOpen && assistant ? 'xl:pr-[26rem]' : ''}`}>
      {error && <Notice kind="error">{error}</Notice>}
      {!data.aiActive && (
        <Notice kind="warn">
          {t(
            'No AI provider is active, so resumes wait in the queue. An administrator can set one up under Admin → AI models.',
          )}
        </Notice>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('Your constellation')}</h2>
          <p className="text-ink-2">{t('Select a star. Brighter means a better fit.')}</p>
        </div>
        {adj && adj.requirements.length > 0 && (
          <button
            className={btnSecondary}
            aria-haspopup="dialog"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            {t('Requirements')}
            {adj.changeCount > 0 ? ` ${t('({n} changed)', { n: adj.changeCount })}` : ''}
          </button>
        )}
        <p className="text-sm text-ink-3" aria-live="polite">
          {data.counts.total === 1
            ? t('{n} resume in this scan', { n: data.counts.total })
            : t('{n} resumes in this scan', { n: data.counts.total })}
          {data.counts.failed > 0 && ` · ${t('{n} failed (see Table)', { n: data.counts.failed })}`}
        </p>
      </div>

      {drawer && adj && (
        <RequirementsDrawer
          data={adj}
          note={adjNote}
          error={adjError}
          busy={adjBusy}
          onChange={(requirementId, to: Kind) => void adjust('', { requirementId, to })}
          onReset={() => void adjust('/reset')}
          focusId={drawerFocus}
          onClose={() => {
            setDrawer(false);
            setDrawerFocus(null);
          }}
        />
      )}
      {assistant && (
        <AssistantPanel
          config={assistant}
          target={target}
          others={compareChoices}
          onEditRequirement={(id, text) => void openEdit(id, text)}
        />
      )}
      {adj && adj.changeCount > 0 && (
        <Notice kind="info">
          {t('The ranking uses your requirement changes ({n}).', { n: adj.changeCount })}{' '}
          <button className="underline" disabled={adjBusy} onClick={() => void adjust('/reset')}>
            {t('Back to original')}
          </button>
        </Notice>
      )}

      {sending && (
        <Notice kind="info">
          <span role="status">
            {t(
              'Sending {sent} of {total} files. You can start looking now: the rest appear here as they are read.',
              { sent: intake!.sent, total: intake!.total },
            )}
          </span>
        </Notice>
      )}
      {intake?.error && (
        <Notice kind="error">
          {t('Some files could not be sent.')} {intake.error}
        </Notice>
      )}
      {pending > 0 && (
        <div role="status" aria-live="polite" className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-2">
              {t(
                '{read} of {total} read. You can leave this page: the scan continues and is kept in Past scans.',
                { read, total: data.counts.total },
              )}
            </p>
            <button
              className={btnSecondary}
              disabled={busy}
              onClick={() => void runControl('stop')}
            >
              {t('Stop the scan')}
            </button>
          </div>
          <progress
            className="h-2 w-full"
            max={data.counts.total}
            value={read}
            aria-label={t('Resumes read')}
          />
        </div>
      )}
      {pending > 0 && (
        <p className="text-sm text-ink-2">
          {t('{ready} ready, {pending} being read, {human} need a look', {
            ready: scored.length,
            pending,
            human: human.length,
          })}
        </p>
      )}
      {skipped.length > 0 && (
        <div className="text-sm text-ink-2">
          {t('{n} skipped,', { n: skipped.length })}{' '}
          <button
            className="text-link underline"
            aria-expanded={showSkipped}
            onClick={() => setShowSkipped((v) => !v)}
          >
            {showSkipped ? t('hide which') : t('see which')}
          </button>
          {showSkipped && (
            <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5">
              {skipped.map((x, i) => (
                <li key={i}>
                  {x.filename}: {x.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {pending === 0 && stoppedCount > 0 && (
        <Notice kind="warn">
          <span role="status">
            {t('Stopped at {read} of {total}. What was scored is kept.', {
              read,
              total: data.counts.total,
            })}
          </span>{' '}
          <button className="underline" disabled={busy} onClick={() => void runControl('continue')}>
            {t('Continue reading the other {n}', { n: stoppedCount })}
          </button>
        </Notice>
      )}
      {pending === 0 && stoppedCount === 0 && (
        <p className="text-sm text-ink-2" role="status">
          {t('{read} read, {scored} scored, {human} need a human look', {
            read,
            scored: scored.length,
            human: human.length,
          })}
        </p>
      )}

      <ul className="flex flex-wrap gap-2 text-sm" aria-label={t('Candidates by match')}>
        {(['strong', 'good', 'partial', 'limited', 'human'] as MatchBand[]).map((b) => (
          <li
            key={b}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1"
          >
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full border border-edge"
              style={{ background: STAR_COLOUR[b] }}
            />
            {t(BAND_LABEL[b])} <strong>{counts(b)}</strong>
          </li>
        ))}
      </ul>

      {ranked.length + limited.length > 0 && counts('strong') === 0 && (
        <Notice kind="info">
          {t(
            'No strong match in this batch. These are the best matches found; none of them reached Strong.',
          )}
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {focusOn ? (
          <span>
            <strong>{t('Focus on skills is on.')}</strong>{' '}
            {t('Names stay hidden unless you reveal one.')}{' '}
            <button className="text-link underline" onClick={() => void setFocusPref(false)}>
              {t('Turn off')}
            </button>
          </span>
        ) : !confirmAll ? (
          <button className={btnSecondary} onClick={() => setConfirmAll(true)}>
            {t('Reveal all names')}
          </button>
        ) : (
          <div role="group" aria-label={t('Confirm')} className="flex flex-wrap items-center gap-2">
            <span>{t('Names are hidden to keep the first look about skills. Show all?')}</span>
            <button className={btnSecondary} onClick={() => void reveal(ordered)}>
              {t('Show all')}
            </button>
            <button className={btnSecondary} onClick={() => setConfirmAll(false)}>
              {t('Cancel')}
            </button>
          </div>
        )}
        <span className="text-ink-3">
          {t('Names are hidden on screen, not removed from the file.')}
        </span>
        {!focusOn && (
          <span className="text-ink-3">
            {t('Want a first look about skills only?')}{' '}
            <button className="text-link underline" onClick={() => void setFocusPref(true)}>
              {t('Try Focus on skills')}
            </button>
          </span>
        )}
      </div>

      {marked('shortlist') + marked('hold') + marked('reject') > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-edge p-3 text-sm"
          aria-label={t('My marks')}
          role="group"
        >
          <span className="font-medium">{t('My marks')}</span>
          <span>
            {t('{a} shortlisted · {b} maybe · {c} not now', {
              a: marked('shortlist'),
              b: marked('hold'),
              c: marked('reject'),
            })}
          </span>
          <span className="text-ink-3">{t('They never change the match or the order.')}</span>
          {entries.length > 0 && (
            <>
              <button className={btnSecondary} onClick={() => void copyShortlist()}>
                {t('Copy shortlist')}
              </button>
              <button className={btnSecondary} onClick={downloadCsv}>
                {t('Download CSV')}
              </button>
              <span role="status">{copied}</span>
            </>
          )}
        </div>
      )}

      {scored.length > 0 && (
        <section aria-label={t('Star map')} aria-describedby="star-summary">
          <button className={`${btnSecondary} lg:hidden`} onClick={() => setMapOpen((o) => !o)}>
            {mapOpen ? t('Hide star map') : t('Show star map')}
          </button>
          <div className={mapOpen ? 'mt-3 block' : 'hidden lg:block'}>
            <div
              data-testid="star-map"
              className="relative h-[360px] overflow-hidden rounded-3xl"
              data-scanning={pending > 0 ? 'true' : 'false'}
              style={{ background: '#0C1A3D' }}
              onKeyDown={(e) => {
                const stars = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-star]'),
                );
                const at = stars.indexOf(document.activeElement as HTMLButtonElement);
                const to = at < 0 ? null : nextStar(e.key, at, stars.length);
                if (to !== null) {
                  e.preventDefault();
                  stars[to]?.focus();
                }
              }}
            >
              {pending > 0 && <div aria-hidden="true" className="sky-sweep" />}
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {links.map(([a, b]) => {
                  const sa = stars[a]!;
                  const sb = stars[b]!;
                  const on =
                    mapRows[a]!.documentId === selected || mapRows[b]!.documentId === selected;
                  return (
                    <line
                      key={`${a}-${b}`}
                      x1={sa.x}
                      y1={sa.y}
                      x2={sb.x}
                      y2={sb.y}
                      stroke="#8FB4FF"
                      strokeWidth={1.4}
                      vectorEffect="non-scaling-stroke"
                      opacity={on ? 0.95 : 0.25}
                    />
                  );
                })}
              </svg>
              {mapRows.map((r, i) => {
                const st = stars[i]!;
                const band = bandOf.get(r.documentId)!;
                const size = STAR_SIZE[band];
                const on = r.documentId === selected;
                const label = i < LABELS_ON_MAP || on || hovered === r.documentId;
                return (
                  <div
                    key={r.documentId}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${st.x}%`, top: `${st.y}%` }}
                  >
                    <button
                      type="button"
                      data-star=""
                      aria-label={`${nameOf(r)}, ${t(BAND_LABEL[band])}`}
                      aria-pressed={on}
                      title={t('Score {n}', { n: r.score!.value })}
                      onClick={() => select(r.documentId, true)}
                      onMouseEnter={() => setHovered(r.documentId)}
                      onMouseLeave={() => setHovered(null)}
                      className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8FB4FF]"
                    >
                      <span
                        aria-hidden="true"
                        className="block rounded-full transition-transform duration-200 hover:scale-125"
                        style={{
                          width: size,
                          height: size,
                          background: STAR_COLOUR[band],
                          boxShadow: `0 0 ${size}px ${size / 4}px ${STAR_COLOUR[band]}${on ? '' : '99'}`,
                          outline: on ? '3px solid #fff' : 'none',
                        }}
                      />
                    </button>
                    {label && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 -mt-1 whitespace-nowrap text-xs font-semibold"
                        style={{ color: '#E8EEFF' }}
                      >
                        {nameOf(r)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p id="star-summary" className="sr-only">
              {t('Star map, a picture of the ranked list below. {n} stars, best first:', {
                n: mapRows.length,
              })}{' '}
              {mapRows
                .slice(0, 5)
                .map((r) => `${nameOf(r)}, ${t(BAND_LABEL[bandOf.get(r.documentId)!])}`)
                .join('; ')}
              {mapRows.length > 5 ? t('; and more') : ''}.{' '}
              {t('Use the arrow keys to move between stars and Enter to select one.')}
            </p>
            <p className="mt-2 text-sm text-ink-3">
              {scored.length > mapRows.length ? (
                <>
                  {t('Showing top {n} of {total}.', { n: mapRows.length, total: scored.length })}{' '}
                  <button className="text-link hover:underline" onClick={() => setMapAll(true)}>
                    {t('Show all')}
                  </button>{' '}
                </>
              ) : mapAll && scored.length > MAP_TOP ? (
                <button className="text-link hover:underline" onClick={() => setMapAll(false)}>
                  {t('Show top {n} only', { n: MAP_TOP })}
                </button>
              ) : null}
              {t("A star's place on the map has no meaning beyond its rank.")}
            </p>
          </div>
        </section>
      )}

      <section aria-label={t('Candidates')} className="space-y-3">
        {ranked.slice(0, shown).map((r) => (
          <CandidateCard
            key={r.documentId}
            r={r}
            band={bandOf.get(r.documentId)!}
            name={nameOf(r)}
            isRevealed={revealed.has(r.documentId)}
            selected={selected === r.documentId}
            detail={details[r.documentId]}
            proof={proof?.doc === r.documentId ? proof.req : null}
            onSelect={() => select(r.documentId)}
            onProof={(req) => setProof(req ? { doc: r.documentId, req } : null)}
            onReveal={() => void reveal([r])}
            onHide={() => void hide(r)}
            onMarked={() => void load()}
            assistantName={assistant?.name}
            onAsk={() => askAbout(r.documentId)}
          />
        ))}
        {ranked.length > shown && (
          <button className={btnSecondary} onClick={() => setShown((s) => s + PAGE)}>
            {t('Show {n} more ({m} not shown)', {
              n: Math.min(PAGE, ranked.length - shown),
              m: ranked.length - shown,
            })}
          </button>
        )}
        {limited.length > 0 && (
          <details className="rounded-lg border border-line bg-card p-3">
            <summary className="cursor-pointer font-medium">
              {t('Limited ({n}): fewer of the requirements found. Nobody is rejected.', {
                n: limited.length,
              })}
            </summary>
            <div className="mt-3 space-y-3">
              {limited.map((r) => (
                <CandidateCard
                  key={r.documentId}
                  r={r}
                  band="limited"
                  name={nameOf(r)}
                  isRevealed={revealed.has(r.documentId)}
                  selected={selected === r.documentId}
                  detail={details[r.documentId]}
                  proof={proof?.doc === r.documentId ? proof.req : null}
                  onSelect={() => select(r.documentId)}
                  onProof={(req) => setProof(req ? { doc: r.documentId, req } : null)}
                  onReveal={() => void reveal([r])}
                  onHide={() => void hide(r)}
                  onMarked={() => void load()}
                  assistantName={assistant?.name}
                  onAsk={() => askAbout(r.documentId)}
                />
              ))}
            </div>
          </details>
        )}
        {missedByOne.length > 0 && (
          <details className="rounded-lg border border-line bg-card p-3">
            <summary className="cursor-pointer font-medium">
              {t('Missed by one must-have ({n})', { n: missedByOne.length })}
            </summary>
            <ul className="mt-2 divide-y divide-line text-sm">
              {missedByOne.map((r) => {
                const gap = r.score!.breakdown.items.find(
                  (i) =>
                    i.classification === 'mandatory' &&
                    (i.status === 'not_found' || i.status === 'not_met'),
                );
                return (
                  <li key={r.documentId} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {nameOf(r)} · {t(BAND_LABEL[bandOf.get(r.documentId)!])}
                    </span>
                    <span className="text-ink-3">
                      {t('Not found: {text}', { text: gap?.text ?? '' })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        {human.length > 0 && (
          <div className="rounded-lg border border-dashed border-edge p-3">
            <h3 className="font-medium">{t('Needs a human look ({n})', { n: human.length })}</h3>
            <p className="text-sm text-ink-3">
              {t('These could not be scored. Open the original and read it yourself.')}
            </p>
            <ul className="mt-2 divide-y divide-line text-sm">
              {human.map((r) => (
                <li
                  key={r.documentId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    {nameOf(r)} ·{' '}
                    {r.state === 'failed'
                      ? t('screening failed')
                      : r.knockoutTriggered
                        ? t('a knockout rule matched')
                        : t('no readable text')}
                  </span>
                  <span className="flex gap-3">
                    {r.screeningId && (
                      <a
                        className="text-link hover:underline"
                        href={`#/screenings/${r.screeningId}`}
                      >
                        {t('Open')}
                      </a>
                    )}
                    {r.state === 'failed' && (
                      <button className="text-link hover:underline" onClick={onTable}>
                        {t('Retry on the Table tab')}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
