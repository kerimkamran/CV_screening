import { useState } from 'react';
import { api, type CandidateRow } from '../api';
import { MARKS, markLabel, type MarkKey } from '../shortlist';
import { btnPrimary, errMsg, Notice } from '../ui';
import { BAND_LABEL, skillChips, STAR_COLOUR, type MatchBand } from '../results-logic';

export interface Span {
  quote: string;
}
export interface Detail {
  summary: string | null;
  assessments: {
    requirementId: string;
    text: string;
    status: string | null;
    rationale: string | null;
    evidence: Span[] | null;
  }[];
}

export const KIND_LABEL = { found: 'Found', partly: 'Partly found', missing: 'Not found' } as const;
export const KIND_MARK = { found: '✓', partly: '~', missing: '✗' } as const;

export function CandidateCard(props: {
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
  onMarked: () => void;
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
            <span className="block text-sm text-ink-2">
              {BAND_LABEL[band]}
              {r.decision && (
                <span className="ml-2 rounded-full border border-dashed border-edge px-2 py-0.5 text-xs text-ink">
                  My mark: {markLabel(r.decision.outcome)}
                </span>
              )}
            </span>
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
          {r.screeningId && band !== 'human' && (
            <MarkControls r={r} screeningId={r.screeningId} onMarked={props.onMarked} />
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

/**
 * "My mark" (spec 6.2.4). Nothing is pre-selected. A mark never changes the AI band, never hides
 * or re-ranks anyone, and needs a short note of the recruiter's own. "Not now" also asks them to
 * confirm they looked at the evidence, as every negative decision does.
 */
function MarkControls({
  r,
  screeningId,
  onMarked,
}: {
  r: CandidateRow;
  screeningId: string;
  onMarked: () => void;
}) {
  const [pick, setPick] = useState<MarkKey | null>(null);
  const [note, setNote] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const noteOk = note.trim().length >= 10;
  const ready = pick !== null && noteOk && (pick !== 'reject' || reviewed);

  async function save() {
    if (!ready || !pick) return;
    setBusy(true);
    setErr('');
    try {
      await api.post(`/screenings/${screeningId}/decision`, {
        outcome: pick,
        reason: note.trim(),
        ...(pick === 'reject' ? { evidenceReviewed: true } : {}),
      });
      setPick(null);
      setNote('');
      setReviewed(false);
      onMarked();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="rounded-md border border-dashed border-edge p-3">
      <legend className="px-1 text-sm font-medium">My mark (separate from the AI match)</legend>
      {r.decision && (
        <p className="mb-2 text-sm text-ink-2">
          Now: <strong>{markLabel(r.decision.outcome)}</strong>. {r.decision.reason}
        </p>
      )}
      <div role="group" aria-label="Choose a mark" className="flex flex-wrap gap-2">
        {MARKS.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={pick === m.key}
            onClick={() => setPick(pick === m.key ? null : m.key)}
            className={`rounded-full border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
              pick === m.key ? 'border-accent bg-sel font-semibold' : 'border-edge bg-card'
            }`}
          >
            <span aria-hidden="true">{pick === m.key ? '● ' : '○ '}</span>
            {m.label}
          </button>
        ))}
      </div>
      {pick && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm">
            <span className="font-medium">One line, in your words</span>
            <input
              className="mt-1 w-full rounded border border-edge bg-field px-2 py-1.5"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why? At least 10 characters"
            />
          </label>
          {pick === 'reject' && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
                className="mt-1"
              />
              <span>
                I looked at the evidence, not only the band. "Not now" never hides this person.
              </span>
            </label>
          )}
          <button className={btnPrimary} disabled={!ready || busy} onClick={() => void save()}>
            Save my mark
          </button>
        </div>
      )}
      {err && <Notice kind="error">{err}</Notice>}
    </fieldset>
  );
}
