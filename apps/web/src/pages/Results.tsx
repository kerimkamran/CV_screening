import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Adjustments, type CandidateRow, type Kind } from '../api';
import {
  BAND_LABEL,
  bandMoves,
  isPending,
  layoutStars,
  linkStars,
  matchBand,
  orderCandidates,
  pseudonyms,
  STAR_COLOUR,
  STAR_SIZE,
  type MatchBand,
} from '../results-logic';
import { btnSecondary, errMsg, Notice } from '../ui';
import { shortlistCsv, shortlistEntries, shortlistText } from '../shortlist';
import { CandidateCard, type Detail } from './CandidateCard';
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
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [confirmAll, setConfirmAll] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [mapAll, setMapAll] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [details, setDetails] = useState<Record<string, Detail | 'loading' | 'error'>>({});
  const [proof, setProof] = useState<{ doc: string; req: string } | null>(null);

  const [adj, setAdj] = useState<Adjustments | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [adjNote, setAdjNote] = useState('');
  const [adjError, setAdjError] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);

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
  const pending = data?.counts.queued ?? 0;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [pending, load]);

  const all = useMemo(() => data?.candidates ?? [], [data]);
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
  const hide = (id: string) =>
    setRevealed((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });

  const marked = (o: string) => ordered.filter((r) => r.decision?.outcome === o).length;
  const entries = shortlistEntries(ordered, nameOf);
  const [copied, setCopied] = useState('');
  async function copyShortlist() {
    try {
      await navigator.clipboard.writeText(shortlistText(entries));
      setCopied('Copied.');
    } catch {
      setCopied('Your browser did not allow copying. Use the CSV instead.');
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
        path === '/reset' ? 'Back to the original ranking.' : bandMoves(before, nowBand).line,
      );
    } catch (e) {
      setAdjError(errMsg(e));
    } finally {
      setAdjBusy(false);
    }
  }
  const missedByOne = scored.filter((r) => r.score?.breakdown.mandatoryGaps === 1);

  const mapRows = scored.slice(0, mapAll ? MAP_MAX : MAP_TOP);
  const stars = layoutStars(mapRows.map((r) => r.documentId));
  const links = linkStars(mapRows.length);
  const counts = (b: MatchBand) => (b === 'human' ? human.length : inBand(b).length);

  if (error && !data) return <Notice kind="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-ink-3">Loading…</p>;
  if (data.counts.total === 0) {
    return (
      <Notice kind="info">
        No resumes yet. Start a screening from{' '}
        <a className="underline" href="#/">
          New screening
        </a>
        , or upload on the Table tab.
      </Notice>
    );
  }

  return (
    <div className="space-y-5">
      {error && <Notice kind="error">{error}</Notice>}
      {!data.aiActive && (
        <Notice kind="warn">
          No AI provider is active, so resumes wait in the queue. An administrator can set one up
          under Admin → AI models.
        </Notice>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Your constellation</h2>
          <p className="text-ink-2">Select a star. Brighter means a better fit.</p>
        </div>
        {adj && adj.requirements.length > 0 && (
          <button
            className={btnSecondary}
            aria-haspopup="dialog"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            Requirements{adj.changeCount > 0 ? ` (${adj.changeCount} changed)` : ''}
          </button>
        )}
        <p className="text-sm text-ink-3" aria-live="polite">
          {data.counts.total} {data.counts.total === 1 ? 'resume' : 'resumes'} in this scan
          {data.counts.failed > 0 && ` · ${data.counts.failed} failed (see Table)`}
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
          onClose={() => setDrawer(false)}
        />
      )}
      {adj && adj.changeCount > 0 && (
        <Notice kind="info">
          The ranking uses your requirement changes ({adj.changeCount}).{' '}
          <button className="underline" disabled={adjBusy} onClick={() => void adjust('/reset')}>
            Back to original
          </button>
        </Notice>
      )}

      {pending > 0 && (
        <div role="status" aria-live="polite" className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-2">
              {read} of {data.counts.total} read. You can leave this page: the scan continues and is
              kept in Past scans.
            </p>
            <button
              className={btnSecondary}
              disabled={busy}
              onClick={() => void runControl('stop')}
            >
              Stop the scan
            </button>
          </div>
          <progress
            className="h-2 w-full"
            max={data.counts.total}
            value={read}
            aria-label="Resumes read"
          />
        </div>
      )}
      {pending === 0 && stoppedCount > 0 && (
        <Notice kind="warn">
          <span role="status">
            Stopped at {read} of {data.counts.total}. What was scored is kept.
          </span>{' '}
          <button className="underline" disabled={busy} onClick={() => void runControl('continue')}>
            Continue reading the other {stoppedCount}
          </button>
        </Notice>
      )}
      {pending === 0 && stoppedCount === 0 && (
        <p className="text-sm text-ink-2" role="status">
          {read} read, {scored.length} scored, {human.length} need a human look
        </p>
      )}

      <ul className="flex flex-wrap gap-2 text-sm" aria-label="Candidates by match">
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
            {BAND_LABEL[b]} <strong>{counts(b)}</strong>
          </li>
        ))}
      </ul>

      {ranked.length + limited.length > 0 && counts('strong') === 0 && (
        <Notice kind="info">
          No strong match in this batch. These are the best matches found; none of them reached
          Strong.
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {!confirmAll ? (
          <button className={btnSecondary} onClick={() => setConfirmAll(true)}>
            Reveal all names
          </button>
        ) : (
          <div role="group" aria-label="Confirm" className="flex flex-wrap items-center gap-2">
            <span>Names are hidden to keep the first look about skills. Show all?</span>
            <button className={btnSecondary} onClick={() => void reveal(ordered)}>
              Show all
            </button>
            <button className={btnSecondary} onClick={() => setConfirmAll(false)}>
              Cancel
            </button>
          </div>
        )}
        <span className="text-ink-3">Names are hidden on screen, not removed from the file.</span>
      </div>

      {marked('shortlist') + marked('hold') + marked('reject') > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-edge p-3 text-sm"
          aria-label="My marks"
          role="group"
        >
          <span className="font-medium">My marks</span>
          <span>
            {marked('shortlist')} shortlisted · {marked('hold')} maybe · {marked('reject')} not now
          </span>
          <span className="text-ink-3">They never change the match or the order.</span>
          {entries.length > 0 && (
            <>
              <button className={btnSecondary} onClick={() => void copyShortlist()}>
                Copy shortlist
              </button>
              <button className={btnSecondary} onClick={downloadCsv}>
                Download CSV
              </button>
              <span role="status">{copied}</span>
            </>
          )}
        </div>
      )}

      {scored.length > 0 && (
        <section aria-label="Star map">
          <button className={`${btnSecondary} lg:hidden`} onClick={() => setMapOpen((o) => !o)}>
            {mapOpen ? 'Hide star map' : 'Show star map'}
          </button>
          <div className={mapOpen ? 'mt-3 block' : 'hidden lg:block'}>
            <div
              data-testid="star-map"
              className="relative h-[360px] overflow-hidden rounded-3xl"
              data-scanning={pending > 0 ? 'true' : 'false'}
              style={{ background: '#0C1A3D' }}
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
                      aria-label={`${nameOf(r)}, ${BAND_LABEL[band]}`}
                      aria-pressed={on}
                      title={`Score ${r.score!.value}`}
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
            <p className="mt-2 text-sm text-ink-3">
              {scored.length > mapRows.length ? (
                <>
                  Showing top {mapRows.length} of {scored.length}.{' '}
                  <button className="text-link hover:underline" onClick={() => setMapAll(true)}>
                    Show all
                  </button>{' '}
                </>
              ) : mapAll && scored.length > MAP_TOP ? (
                <button className="text-link hover:underline" onClick={() => setMapAll(false)}>
                  Show top {MAP_TOP} only
                </button>
              ) : null}
              A star's place on the map has no meaning beyond its rank.
            </p>
          </div>
        </section>
      )}

      <section aria-label="Candidates" className="space-y-3">
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
            onHide={() => hide(r.documentId)}
            onMarked={() => void load()}
          />
        ))}
        {ranked.length > shown && (
          <button className={btnSecondary} onClick={() => setShown((s) => s + PAGE)}>
            Show {Math.min(PAGE, ranked.length - shown)} more ({ranked.length - shown} not shown)
          </button>
        )}
        {limited.length > 0 && (
          <details className="rounded-lg border border-line bg-card p-3">
            <summary className="cursor-pointer font-medium">
              Limited ({limited.length}): fewer of the requirements found. Nobody is rejected.
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
                  onHide={() => hide(r.documentId)}
                  onMarked={() => void load()}
                />
              ))}
            </div>
          </details>
        )}
        {missedByOne.length > 0 && (
          <details className="rounded-lg border border-line bg-card p-3">
            <summary className="cursor-pointer font-medium">
              Missed by one must-have ({missedByOne.length})
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
                      {nameOf(r)} · {BAND_LABEL[bandOf.get(r.documentId)!]}
                    </span>
                    <span className="text-ink-3">Not found: {gap?.text}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        {human.length > 0 && (
          <div className="rounded-lg border border-dashed border-edge p-3">
            <h3 className="font-medium">Needs a human look ({human.length})</h3>
            <p className="text-sm text-ink-3">
              These could not be scored. Open the original and read it yourself.
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
                      ? 'screening failed'
                      : r.knockoutTriggered
                        ? 'a knockout rule matched'
                        : 'no readable text'}
                  </span>
                  <span className="flex gap-3">
                    {r.screeningId && (
                      <a
                        className="text-link hover:underline"
                        href={`#/screenings/${r.screeningId}`}
                      >
                        Open
                      </a>
                    )}
                    {r.state === 'failed' && (
                      <button className="text-link hover:underline" onClick={onTable}>
                        Retry on the Table tab
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
