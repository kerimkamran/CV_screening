import { useEffect, useState } from 'react';
import type { SharedReportSnapshot, SnapshotCandidate } from '@cv/shared';
import { BAND_LABEL, STAR_COLOUR, type MatchBand } from '../results-logic';
import { api, ApiError } from '../api';
import { btnSecondary, errMsg, Notice, OUTCOME, when } from '../ui';

/**
 * A shared evaluation report (design spec 6.5): the snapshot a recruiter shared, shown to a signed-in
 * person who was named on it. No star map, no controls that change anything.
 */

interface Opened {
  id: string;
  sharedBy: string;
  sharedAt: string;
  expiresAt: string;
  report: SharedReportSnapshot;
}
type State =
  | { kind: 'loading' }
  | { kind: 'ok'; data: Opened }
  | { kind: 'gone' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

const KIND_LABEL = { found: 'Found', partly: 'Partly found', missing: 'Not found' } as const;
const KIND_MARK = { found: '✓', partly: '~', missing: '✗' } as const;
const BANDS: MatchBand[] = ['strong', 'good', 'partial', 'limited', 'human'];

export function SharedReport({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tries, setTries] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    api.get<Opened>(`/reports/${id}`).then(
      (data) => live && setState({ kind: 'ok', data }),
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && (e.status === 410 || e.status === 404))
          return setState({ kind: 'gone' });
        if (e instanceof ApiError && e.status === 403) return setState({ kind: 'denied' });
        setState({ kind: 'error', message: errMsg(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [id, tries]);

  if (state.kind === 'loading') return <p className="text-sm text-ink-3">Preparing your report…</p>;
  if (state.kind === 'gone')
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <Notice kind="info">
          This report is no longer available. Ask the recruiter for a new link.
        </Notice>
        <a className="text-link underline" href="#/reports">
          Reports shared with me
        </a>
      </div>
    );
  if (state.kind === 'denied')
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <Notice kind="error">You don't have access to this report. Ask the recruiter.</Notice>
        <a className="text-link underline" href="#/reports">
          Reports shared with me
        </a>
      </div>
    );
  if (state.kind === 'error')
    return (
      <div className="space-y-3">
        <Notice kind="error">The report could not be opened. {state.message}</Notice>
        <button className={btnSecondary} onClick={() => setTries((n) => n + 1)}>
          Try again
        </button>
      </div>
    );

  const { report: r, sharedBy, sharedAt, expiresAt } = state.data;
  const top = r.expandedCount;
  const shown = showAll ? r.candidates : r.candidates.slice(0, top);
  const stopped = r.counts.stopped > 0;

  return (
    <article className="space-y-6" aria-label="Shared evaluation report">
      <header
        className="rounded-3xl px-6 py-6 text-white"
        style={{ background: 'linear-gradient(160deg,#0C1A3D,#0F2459)' }}
      >
        <p className="text-sm text-[#B9C8F2]">Evaluation report · shared with you</p>
        <h1 className="text-2xl font-bold tracking-tight">{r.title}</h1>
        <p className="mt-1 text-sm text-[#B9C8F2]">
          Snapshot of {when(sharedAt)} · {r.counts.read} read, {r.counts.scored} scored,{' '}
          {r.counts.needLook} need a human look
        </p>
        <p className="mt-1 text-sm text-[#B9C8F2]">
          Shared by {sharedBy} · this link works until {when(expiresAt)}
        </p>
      </header>

      <Notice kind="info">
        This is a snapshot, not a live page. Candidate data stays inside Azerconnect Group: please
        do not forward this report.
      </Notice>
      {stopped && (
        <Notice kind="warn">
          Stopped at {r.counts.read} of {r.counts.total}. Files not read are listed under Data
          quality.
        </Notice>
      )}

      <section aria-labelledby="sr-role" className="space-y-2">
        <h2 id="sr-role" className="text-lg font-semibold">
          The role
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">Must-have ({r.role.must.length})</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {r.role.must.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium">Nice-to-have ({r.role.nice.length})</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {r.role.nice.length === 0 && <li className="list-none text-ink-3">None</li>}
              {r.role.nice.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
        {r.role.ignored.length > 0 && (
          <p className="text-sm text-ink-3">Not counted: {r.role.ignored.join(', ')}.</p>
        )}
      </section>

      <section aria-labelledby="sr-how" className="space-y-2">
        <h2 id="sr-how" className="text-lg font-semibold">
          How it was scored
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>
            Scored against requirements version {r.method.criteriaVersion ?? '–'}
            {r.method.frozenAt && `, frozen ${when(r.method.frozenAt)}`}.
            {r.method.model &&
              ` Read by ${r.method.provider ?? 'the AI provider'} (${r.method.model}).`}
          </li>
          <li>
            AI suggests, a human decides. A missing must-have lowers the match; it never hides
            anyone.
          </li>
          <li>
            Match bands: Strong 80 and up, Good 70 to 79, Partial 50 to 69, Limited under 50. These
            cut-offs have not been calibrated yet. Scores may differ slightly if the screening is
            run again.
          </li>
        </ul>
      </section>

      <section aria-labelledby="sr-bands" className="space-y-2">
        <h2 id="sr-bands" className="text-lg font-semibold">
          The match
        </h2>
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
              {BAND_LABEL[b]} <strong>{r.bands[b]}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sr-cands" className="space-y-3">
        <h2 id="sr-cands" className="text-lg font-semibold">
          Candidates, best match first
        </h2>
        <p className="text-sm text-ink-3" aria-live="polite">
          {showAll || r.candidates.length <= top
            ? `Showing all ${r.candidates.length} scored`
            : `Showing ${top} of ${r.candidates.length} scored`}
        </p>
        <ol className="space-y-3">
          {shown.map((c) => (
            <Entry
              key={c.rank}
              c={c}
              expanded={c.expanded || open.has(c.rank)}
              canCollapse={!c.expanded}
              onToggle={() =>
                setOpen((s) => {
                  const n = new Set(s);
                  if (n.has(c.rank)) n.delete(c.rank);
                  else n.add(c.rank);
                  return n;
                })
              }
            />
          ))}
        </ol>
        {r.candidates.length > top && (
          <button className={btnSecondary} onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show only the top ${top}` : `Show all ${r.candidates.length}`}
          </button>
        )}
      </section>

      <section aria-labelledby="sr-quality" className="space-y-2">
        <h2 id="sr-quality" className="text-lg font-semibold">
          Data quality
        </h2>
        {r.unread.length === 0 ? (
          <p className="text-sm text-ink-2">Every file was read.</p>
        ) : (
          <>
            <p className="text-sm font-medium">Not read ({r.unread.length})</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
              {r.unread.map((u, i) => (
                <li key={i}>
                  {u.label}: {u.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {(r.changes.length > 0 || r.decisions.length > 0) && (
        <section aria-labelledby="sr-changes" className="space-y-2">
          <h2 id="sr-changes" className="text-lg font-semibold">
            Changes and decisions
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {r.changes.map((c, i) => (
              <li key={i}>
                {c.text}, by {c.by} on {when(c.at)}.
              </li>
            ))}
            {r.changes.length > 0 && (
              <li className="list-none text-ink-3">
                The original ranking is available in the app.
              </li>
            )}
            {r.decisions.map((d, i) => (
              <li key={`d${i}`}>
                Recruiter decision, separate from the AI match. {d.label}:{' '}
                {OUTCOME[d.outcome]?.[0] ?? d.outcome} by {d.by} on {when(d.at)}.
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-line pt-3 text-xs text-ink-3">
        Run {r.runId} · report date {when(r.takenAt)} · created by {r.createdBy}. Candidate data
        stays inside Azerconnect Group.{' '}
        {r.includeNames
          ? 'Real names are shown only for candidates the recruiter showed or shortlisted.'
          : 'Candidates appear as numbers; names stay out of the report.'}
        {!r.includeQuotes && ' Quotes from CVs were left out.'}
      </footer>
    </article>
  );
}

function Entry({
  c,
  expanded,
  canCollapse,
  onToggle,
}: {
  c: SnapshotCandidate;
  expanded: boolean;
  canCollapse: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {c.rank}. {c.label}
          {c.name && <span className="font-normal text-ink-2"> · {c.name}</span>}
        </h3>
        <span className="inline-flex items-center gap-2 text-sm" title={`Score ${c.score} of 100`}>
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full border border-edge"
            style={{ background: STAR_COLOUR[c.band] }}
          />
          {BAND_LABEL[c.band]}
          <span className="text-ink-3">
            · {c.mustFound} of {c.mustTotal} must-haves found
          </span>
        </span>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-3 text-sm">
          <ul className="flex flex-wrap gap-2" aria-label="Skills">
            {c.chips.map((k, i) => (
              <li key={i} className="rounded-full border border-line px-2.5 py-0.5 text-ink-2">
                <span aria-hidden="true">{KIND_MARK[k.kind]} </span>
                {k.text}
                <span className="sr-only">: {KIND_LABEL[k.kind]}</span>
              </li>
            ))}
          </ul>
          {c.summary && <p className="text-ink">{c.summary}</p>}
          {c.quotes.map((q, i) => (
            <blockquote key={i} className="border-l-4 border-accent pl-3 text-ink-2">
              {q.quote}
              <footer className="text-xs text-ink-3">For: {q.requirement}</footer>
            </blockquote>
          ))}
          {c.missing && (
            <p className="text-ink-3">Not found in this CV. Searched for: {c.missing}</p>
          )}
          {canCollapse && (
            <button className="text-link underline" onClick={onToggle}>
              Hide details
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <button className="text-sm text-link underline" onClick={onToggle}>
            Show details
          </button>
        </div>
      )}
    </li>
  );
}

/** What has been shared with the signed-in person. Works for an account with no role. */
export function SharedList() {
  const [rows, setRows] = useState<
    { id: string; title: string; sharedBy: string; sharedAt: string; expiresAt: string }[] | null
  >(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .get<{ reports: NonNullable<typeof rows> }>('/reports/mine')
      .then((r) => setRows(Array.isArray(r.reports) ? r.reports : []))
      .catch((e: unknown) => setError(errMsg(e)));
  }, []);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Reports shared with me</h1>
      {error && <Notice kind="error">{error}</Notice>}
      {rows === null && !error && <p className="text-sm text-ink-3">Loading…</p>}
      {rows?.length === 0 && (
        <Notice kind="info">
          Nothing has been shared with you, or the links have expired. Ask the recruiter for a new
          link.
        </Notice>
      )}
      <ul className="space-y-2">
        {rows?.map((r) => (
          <li key={r.id} className="rounded-lg border border-line bg-card p-4">
            <a className="font-medium text-link underline" href={`#/reports/${r.id}`}>
              {r.title}
            </a>
            <p className="text-sm text-ink-3">
              Shared by {r.sharedBy} on {when(r.sharedAt)} · works until {when(r.expiresAt)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
