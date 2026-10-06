import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Adjustments, type CandidateRow, type Criteria, type Me } from '../api';
import {
  BAND_LABEL,
  isPending,
  KIND_NAME,
  matchBand,
  mustHaveTally,
  orderCandidates,
  pseudonyms,
  reportCounts,
  skillChips,
  STAR_COLOUR,
  unreadReason,
  type MatchBand,
} from '../results-logic';
import { ShareReport } from './ShareReport';
import { btnSecondary, errMsg, Notice, OUTCOME, when } from '../ui';

/**
 * Evaluation report (design spec 6.5): a short, always-live page inside the app. Pseudonyms only,
 * no photo, age, gender, marital status or city. Nothing here is downloaded or shared; share links,
 * HTML download and PDF are release 2.
 */

interface Listing {
  counts: { total: number; queued: number; failed: number; manual: number; undecided: number };
  aiActive: boolean;
  candidates: CandidateRow[];
}
interface Detail {
  summary: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  assessments: {
    requirementId: string;
    text: string;
    status: string | null;
    evidence: { quote: string }[] | null;
  }[];
}

const TOP = 15;
const KIND_LABEL = { found: 'Found', partly: 'Partly found', missing: 'Not found' } as const;
const KIND_MARK = { found: '✓', partly: '~', missing: '✗' } as const;
const BANDS: MatchBand[] = ['strong', 'good', 'partial', 'limited', 'human'];

export function Report({
  vacancyId,
  title,
  createdAt,
}: {
  vacancyId: string;
  title: string;
  createdAt: string;
}) {
  const [data, setData] = useState<Listing | null>(null);
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [adj, setAdj] = useState<Adjustments | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, Detail | 'loading' | 'error'>>({});

  const load = useCallback(async () => {
    try {
      const [l, c, a] = await Promise.all([
        api.get<Listing>(`/vacancies/${vacancyId}/candidates`),
        api.get<Criteria>(`/vacancies/${vacancyId}/criteria`),
        api.get<Adjustments>(`/vacancies/${vacancyId}/adjustments`).catch(() => null),
      ]);
      setData(l);
      setCriteria(c);
      setAdj(a && Array.isArray(a.requirements) ? a : null);
      setError('');
    } catch (e) {
      setError(errMsg(e));
    }
  }, [vacancyId]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    api.get<Me>('/me').then(setMe, () => undefined);
  }, []);
  const pending = data?.counts.queued ?? 0;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [pending, load]);

  const all = useMemo(() => (data?.candidates ?? []).filter((r) => !r.erased), [data]);
  const names = useMemo(() => pseudonyms(all), [all]);
  const ordered = useMemo(() => orderCandidates(all), [all]);
  const scored = useMemo(
    () =>
      ordered.filter((r) => {
        const b = matchBand(r);
        return b !== 'human' && r.state === 'completed';
      }),
    [ordered],
  );
  const counts = useMemo(() => reportCounts(all), [all]);
  const unread = useMemo(() => all.filter((r) => unreadReason(r) !== null), [all]);
  const decided = useMemo(() => ordered.filter((r) => r.decision), [ordered]);

  // Reasons and quotes for the expanded candidates, fetched once each.
  const wanted = useMemo(
    () => [...scored.slice(0, TOP), ...scored.filter((r) => open.has(r.documentId))],
    [scored, open],
  );
  useEffect(() => {
    for (const r of wanted) {
      if (!r.screeningId || details[r.documentId]) continue;
      setDetails((d) => ({ ...d, [r.documentId]: 'loading' }));
      api.get<Detail>(`/screenings/${r.screeningId}`).then(
        (x) => setDetails((d) => ({ ...d, [r.documentId]: x })),
        () => setDetails((d) => ({ ...d, [r.documentId]: 'error' })),
      );
    }
  }, [wanted, details]);

  if (error && !data) {
    return (
      <div className="space-y-3">
        <Notice kind="error">The report could not be prepared. {error}</Notice>
        <button className={btnSecondary} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!data || !criteria) return <p className="text-sm text-ink-3">Preparing the report…</p>;
  if (counts.total === 0) {
    return <Notice kind="info">No resumes yet, so there is nothing to report.</Notice>;
  }

  const reqs = criteria.current?.requirements ?? [];
  // The requirements actually used: the recruiter's changes (spec 6.2.5) when there are any.
  const used = adj
    ? adj.requirements.map((r) => ({ id: r.id, text: r.text, kind: r.current }))
    : reqs.map((r) => ({
        id: r.id,
        text: r.text,
        kind:
          r.classification === 'mandatory'
            ? 'mandatory'
            : r.classification === 'preferred'
              ? 'preferred'
              : 'ignore',
      }));
  const must = used.filter((r) => r.kind === 'mandatory');
  const nice = used.filter((r) => r.kind === 'preferred');
  const ignored = adj ? used.filter((r) => r.kind === 'ignore') : [];
  const adjChanges = adj?.changes ?? [];
  const frozen = criteria.versions.filter((v) => v.frozenAt).sort((a, b) => a.version - b.version);
  const changes = frozen.slice(1);
  const bandCount = (b: MatchBand) =>
    all.filter((r) => matchBand(r) === b && !isPending(r) && r.state !== 'stopped').length;
  const aiLine = (() => {
    const d = Object.values(details).find((x): x is Detail => typeof x === 'object' && !!x.aiModel);
    return d ? `Read by ${d.aiProvider ?? 'the AI provider'} (${d.aiModel}).` : null;
  })();
  const today = new Date().toISOString().slice(0, 10);
  const shownRows = showAll ? scored : scored.slice(0, TOP);

  return (
    <article className="space-y-6" aria-label="Evaluation report">
      <header
        className="rounded-3xl px-6 py-6 text-white"
        style={{ background: 'linear-gradient(160deg,#0C1A3D,#0F2459)' }}
      >
        <p className="text-sm text-[#B9C8F2]">Evaluation report</p>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-[#B9C8F2]">
          Report date {today} · {counts.read} read, {counts.scored} scored, {counts.needLook} need a
          human look
        </p>
      </header>

      {counts.total > counts.read + counts.stopped && (
        <div role="status" aria-live="polite">
          <Notice kind="info">
            {counts.read} of {counts.total} read, this report will update.
          </Notice>
        </div>
      )}
      {counts.stopped > 0 && (
        <div role="status">
          <Notice kind="warn">
            Stopped at {counts.read} of {counts.total}. Files not read are listed under Data
            quality.
          </Notice>
        </div>
      )}
      {!data.aiActive && counts.read < counts.total && (
        <Notice kind="warn">
          No AI provider is active, so resumes wait in the queue. An administrator can set one up
          under Admin → AI models.
        </Notice>
      )}

      <ShareReport
        vacancyId={vacancyId}
        blocked={
          pending > 0
            ? `A shared link is offered when the scan is done. ${counts.read} of ${counts.total} read so far.`
            : scored.length === 0
              ? 'No candidate has been scored yet, so there is nothing to share.'
              : null
        }
      />

      <section aria-labelledby="rep-role" className="space-y-2">
        <h3 id="rep-role" className="text-lg font-semibold">
          The role
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">Must-have ({must.length})</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {must.map((r, i) => (
                <li key={r.id ?? i}>{r.text}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium">Nice-to-have ({nice.length})</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {nice.length === 0 && <li className="list-none text-ink-3">None</li>}
              {nice.map((r, i) => (
                <li key={r.id ?? i}>{r.text}</li>
              ))}
            </ul>
          </div>
        </div>
        {ignored.length > 0 && (
          <p className="text-sm text-ink-3">
            Not counted: {ignored.map((r) => r.text).join(', ')}.
          </p>
        )}
        {changes.length > 0 && (
          <p className="text-sm text-ink-3">
            Requirements changed during this scan: version {changes[changes.length - 1]!.version}{' '}
            was frozen on {when(changes[changes.length - 1]!.frozenAt)}.
          </p>
        )}
      </section>

      <section aria-labelledby="rep-how" className="space-y-2">
        <h3 id="rep-how" className="text-lg font-semibold">
          How it was scored
        </h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>
            Scored against requirements version {criteria.current?.version ?? '–'}
            {frozen.length > 0 && `, frozen ${when(frozen[frozen.length - 1]!.frozenAt)}`}.
            {aiLine && ` ${aiLine}`}
          </li>
          <li>
            AI suggests, a human decides. A missing must-have lowers the match; it never hides
            anyone.
          </li>
          <li>
            Match bands: Strong 80 and up, Good 70 to 79, Partial 50 to 69, Limited under 50. These
            cut-offs have not been calibrated yet.
          </li>
        </ul>
      </section>

      <section aria-labelledby="rep-bands" className="space-y-2">
        <h3 id="rep-bands" className="text-lg font-semibold">
          The match
        </h3>
        <ul className="flex flex-wrap gap-2 text-sm" aria-label="Candidates by match">
          {BANDS.map((b) => (
            <li
              key={b}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1"
            >
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border border-edge"
                style={{ background: STAR_COLOUR[b] }}
              />
              {BAND_LABEL[b]} <strong>{bandCount(b)}</strong>
            </li>
          ))}
        </ul>
        {scored.length > 0 && bandCount('strong') === 0 && (
          <p className="text-sm text-ink-2">No strong match in this batch.</p>
        )}
      </section>

      <section aria-labelledby="rep-cands" className="space-y-3">
        <h3 id="rep-cands" className="text-lg font-semibold">
          Candidates, best match first
        </h3>
        {scored.length === 0 ? (
          <Notice kind="info">
            {counts.read < counts.total - counts.stopped
              ? 'No candidate has been scored yet.'
              : 'No candidate could be scored. See “Not read” below.'}
          </Notice>
        ) : (
          <>
            <p className="text-sm text-ink-3" aria-live="polite">
              {showAll || scored.length <= TOP
                ? `Showing all ${scored.length} scored`
                : `Showing ${TOP} of ${scored.length} scored`}
            </p>
            <ol className="space-y-3">
              {shownRows.map((r, i) => (
                <CandidateEntry
                  key={r.documentId}
                  rank={i + 1}
                  row={r}
                  name={names.get(r.documentId)!}
                  expanded={i < TOP || open.has(r.documentId)}
                  canCollapse={i >= TOP}
                  detail={details[r.documentId]}
                  onToggle={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(r.documentId)) n.delete(r.documentId);
                      else n.add(r.documentId);
                      return n;
                    })
                  }
                />
              ))}
            </ol>
            {scored.length > TOP && (
              <button className={btnSecondary} onClick={() => setShowAll((v) => !v)}>
                {showAll ? `Show only the top ${TOP}` : `Show all ${scored.length}`}
              </button>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="rep-quality" className="space-y-2">
        <h3 id="rep-quality" className="text-lg font-semibold">
          Data quality
        </h3>
        {unread.length === 0 ? (
          <p className="text-sm text-ink-2">Every file was read.</p>
        ) : (
          <>
            <p className="text-sm font-medium">Not read ({unread.length})</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
              {unread.map((r) => (
                <li key={r.documentId}>
                  {names.get(r.documentId)}: {unreadReason(r)}
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-3">
              These files were not scored and are not hidden: open the originals to review them.
            </p>
          </>
        )}
      </section>

      {(changes.length > 0 || adjChanges.length > 0 || decided.length > 0) && (
        <section aria-labelledby="rep-changes" className="space-y-2">
          <h3 id="rep-changes" className="text-lg font-semibold">
            Changes and decisions
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {changes.map((c) => (
              <li key={c.id}>
                Requirements version {c.version} frozen on {when(c.frozenAt)}.
              </li>
            ))}
            {adjChanges.map((c) => (
              <li key={c.id}>
                {c.reset
                  ? 'Requirements set back to the original'
                  : `${c.requirement}: ${KIND_NAME[c.from!].toLowerCase()} to ${KIND_NAME[c.to!].toLowerCase()}`}
                , by {c.by} on {when(c.at)}.
              </li>
            ))}
            {adjChanges.length > 0 && (
              <li className="list-none text-ink-3">
                The original ranking is available in the app.
              </li>
            )}
            {decided.map((r) => (
              <li key={r.documentId}>
                Recruiter decision, separate from the AI match. {names.get(r.documentId)}:{' '}
                {OUTCOME[r.decision!.outcome]?.[0] ?? r.decision!.outcome} by{' '}
                {r.decision!.decidedBy} on {when(r.decision!.decidedAt)}
                {r.decision!.reason ? ` (${r.decision!.reason})` : ''}.
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-line pt-3 text-xs text-ink-3">
        Run {vacancyId.slice(-8)} · scan started {when(createdAt)} · report date {today}
        {me?.displayName && ` · prepared for ${me.displayName}`}. Candidates appear as numbers;
        names stay out of the report.
      </footer>
    </article>
  );
}

function CandidateEntry(props: {
  rank: number;
  row: CandidateRow;
  name: string;
  expanded: boolean;
  canCollapse: boolean;
  detail: Detail | 'loading' | 'error' | undefined;
  onToggle: () => void;
}) {
  const { row, detail } = props;
  const band = matchBand(row);
  const tally = mustHaveTally(row.score?.breakdown);
  const d = typeof detail === 'object' ? detail : null;
  const chips = skillChips(row.score?.breakdown);
  const quotes = (d?.assessments ?? [])
    .filter((a) => (a.status === 'met' || a.status === 'partially_met') && a.evidence?.length)
    .slice(0, 2);
  const missing = chips.find((c) => c.kind === 'missing' && c.classification === 'mandatory');

  return (
    <li className="rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">
          {props.rank}. {props.name}
        </h4>
        <span className="inline-flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full border border-edge"
            style={{ background: STAR_COLOUR[band] }}
          />
          {BAND_LABEL[band]}
          <span className="text-ink-3">
            · {tally.found} of {tally.total} must-haves found
          </span>
        </span>
      </div>
      {props.expanded ? (
        <div className="mt-3 space-y-3 text-sm">
          <ul className="flex flex-wrap gap-2" aria-label="Skills">
            {chips.map((c) => (
              <li
                key={c.requirementId}
                className="rounded-full border border-line px-2.5 py-0.5 text-ink-2"
              >
                <span aria-hidden="true">{KIND_MARK[c.kind]} </span>
                {c.text}
                <span className="sr-only">: {KIND_LABEL[c.kind]}</span>
              </li>
            ))}
          </ul>
          {detail === 'loading' || detail === undefined ? (
            <p className="text-ink-3">Loading the reason…</p>
          ) : detail === 'error' ? (
            <p className="text-ink-3">The reason could not be loaded.</p>
          ) : (
            <>
              {d?.summary && <p className="text-ink">{d.summary}</p>}
              {quotes.map((a) => (
                <blockquote
                  key={a.requirementId}
                  className="border-l-4 border-accent pl-3 text-ink-2"
                >
                  {a.evidence![0]!.quote}
                  <footer className="text-xs text-ink-3">For: {a.text}</footer>
                </blockquote>
              ))}
              {missing && (
                <p className="text-ink-3">Not found in this CV. Searched for: {missing.text}</p>
              )}
            </>
          )}
          {props.canCollapse && (
            <button className="text-link underline" onClick={props.onToggle}>
              Hide details
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <button className="text-sm text-link underline" onClick={props.onToggle}>
            Show details
          </button>
        </div>
      )}
    </li>
  );
}
