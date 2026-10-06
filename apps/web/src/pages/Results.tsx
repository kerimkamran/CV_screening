import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CandidateRow } from '../api';
import {
  BAND_LABEL,
  layoutStars,
  linkStars,
  matchBand,
  orderCandidates,
  pseudonyms,
  skillChips,
  STAR_COLOUR,
  STAR_SIZE,
  type MatchBand,
} from '../results-logic';
import { btnSecondary, errMsg, Notice } from '../ui';

/**
 * Results (design spec 6.2): a plain band for each candidate, why, and the proof behind each skill,
 * with names hidden until the recruiter chooses to show them. The star map is only a picture of the
 * ranked list: a star's place carries no meaning beyond rank.
 */

interface Listing {
  counts: { total: number; queued: number; failed: number; manual: number; undecided: number };
  aiActive: boolean;
  candidates: CandidateRow[];
}
interface Span {
  quote: string;
}
interface Detail {
  summary: string | null;
  assessments: {
    requirementId: string;
    text: string;
    status: string | null;
    rationale: string | null;
    evidence: Span[] | null;
  }[];
}

const PAGE = 20;
const MAP_TOP = 12;
const MAP_MAX = 79;
const LABELS_ON_MAP = 5;
const KIND_LABEL = { found: 'Found', partly: 'Partly found', missing: 'Not found' } as const;
const KIND_MARK = { found: '✓', partly: '~', missing: '✗' } as const;

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

  const load = useCallback(async () => {
    try {
      setData(await api.get<Listing>(`/vacancies/${vacancyId}/candidates`));
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
  const human = inBand('human').filter((r) => r.state !== 'queued' && r.state !== 'processing');
  const scored = [...ranked, ...limited];
  const read = (data?.counts.total ?? 0) - pending;

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

  const mapRows = scored.slice(0, mapAll ? MAP_MAX : MAP_TOP);
  const stars = layoutStars(mapRows.map((r) => r.documentId));
  const links = linkStars(mapRows.length);
  const counts = (b: MatchBand) => inBand(b).length;

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
        <p className="text-sm text-ink-3" aria-live="polite">
          {data.counts.total} {data.counts.total === 1 ? 'resume' : 'resumes'} scanned
          {data.counts.failed > 0 && ` · ${data.counts.failed} failed (see Table)`}
        </p>
      </div>

      {pending > 0 && (
        <div role="status" aria-live="polite" className="space-y-1">
          <p className="text-sm text-ink-2">
            {read} of {data.counts.total} read
          </p>
          <progress
            className="h-2 w-full"
            max={data.counts.total}
            value={read}
            aria-label="Resumes read"
          />
        </div>
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

      {scored.length > 0 && (
        <section aria-label="Star map">
          <button className={`${btnSecondary} lg:hidden`} onClick={() => setMapOpen((o) => !o)}>
            {mapOpen ? 'Hide star map' : 'Show star map'}
          </button>
          <div className={mapOpen ? 'mt-3 block' : 'hidden lg:block'}>
            <div
              data-testid="star-map"
              className="relative h-[360px] overflow-hidden rounded-3xl"
              style={{ background: '#0C1A3D' }}
            >
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
                />
              ))}
            </div>
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

function CandidateCard(props: {
  r: CandidateRow;
  band: MatchBand;
  name: string;
  isRevealed: boolean;
  selected: boolean;
  detail: Detail | 'loading' | 'error' | undefined;
  proof: string | null;
  onSelect: () => void;
  onProof: (req: string | null) => void;
  onReveal: () => void;
  onHide: () => void;
}) {
  const { r, band, name, selected, detail } = props;
  const chips = skillChips(r.score?.breakdown);
  const d = typeof detail === 'object' ? detail : null;
  const open = d?.assessments.find((a) => a.requirementId === props.proof) ?? null;
  const openChip = chips.find((c) => c.requirementId === props.proof);
  return (
    <article
      id={`card-${r.documentId}`}
      className={`rounded-lg border bg-card p-3 ${selected ? 'border-accent bg-sel' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-expanded={selected}
          onClick={props.onSelect}
          className="flex min-w-0 flex-1 items-center gap-3 rounded text-left focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <span
            aria-hidden="true"
            title={r.score ? `Score ${r.score.value}` : undefined}
            className="inline-block h-10 w-10 shrink-0 rounded-full border-[1.5px] border-edge"
            style={{ background: STAR_COLOUR[band] }}
          />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{name}</span>
            <span className="block text-sm text-ink-2">{BAND_LABEL[band]}</span>
          </span>
        </button>
        {props.isRevealed ? (
          <button className="text-sm text-link hover:underline" onClick={props.onHide}>
            Hide name
          </button>
        ) : (
          <button className="text-sm text-link hover:underline" onClick={props.onReveal}>
            Reveal name
          </button>
        )}
      </div>

      {selected && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {r.score && (
            <p className="text-sm text-ink-3">
              Score {r.score.value} of 100. A sorting aid, not a decision.
            </p>
          )}
          {chips.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Requirements">
              {chips.map((c) => (
                <li key={c.requirementId}>
                  <button
                    type="button"
                    aria-pressed={props.proof === c.requirementId}
                    aria-label={`${c.text}: ${KIND_LABEL[c.kind]}. Show the proof`}
                    onClick={() =>
                      props.onProof(props.proof === c.requirementId ? null : c.requirementId)
                    }
                    className={`rounded-full border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                      c.kind === 'found'
                        ? 'border-ok-line bg-ok text-ok-ink'
                        : c.kind === 'partly'
                          ? 'border-warn-line bg-warn text-warn-ink'
                          : 'border-edge bg-card text-ink-2'
                    }`}
                  >
                    <span aria-hidden="true">{KIND_MARK[c.kind]} </span>
                    {c.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {detail === 'loading' && <p className="text-sm text-ink-3">Loading the reasons…</p>}
          {detail === 'error' && (
            <p className="text-sm text-warn-text">The reasons could not be loaded.</p>
          )}
          {d?.summary && (
            <p className="text-sm">
              <span className="font-medium">Why </span>
              {d.summary}
            </p>
          )}
          {props.proof && openChip && (
            <div
              role="region"
              aria-label={`Proof for ${openChip.text}`}
              className="rounded-md border border-line bg-card p-3 text-sm"
            >
              <p className="font-medium">
                {openChip.text}: {KIND_LABEL[openChip.kind]}
              </p>
              {open?.evidence && open.evidence.length > 0 ? (
                open.evidence.map((e, i) => (
                  <blockquote key={i} className="mt-2 border-l-4 border-accent pl-3 text-ink-2">
                    {e.quote}
                  </blockquote>
                ))
              ) : (
                <p className="mt-1 text-ink-2">
                  {openChip.kind === 'missing'
                    ? `Not found in this CV. Searched for: ${openChip.text}.`
                    : 'No quote was kept for this requirement.'}
                </p>
              )}
              {open?.rationale && <p className="mt-2 text-ink-3">{open.rationale}</p>}
            </div>
          )}
          <p className="text-sm">
            {r.screeningId && (
              <a className="text-link hover:underline" href={`#/screenings/${r.screeningId}`}>
                Open the full review and record a decision
              </a>
            )}
          </p>
        </div>
      )}
    </article>
  );
}
