import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, type Breakdown, type Classification, type Decision, type ReqStatus } from '../api';
import {
  BandBadge,
  btnDanger,
  btnPrimary,
  btnSecondary,
  Card,
  errMsg,
  Field,
  input,
  Notice,
  OUTCOME,
  StatusBadge,
  when,
} from '../ui';

interface Span {
  start: number;
  end: number;
  quote: string;
}
interface Assessment {
  requirementId: string;
  text: string;
  classification: Classification;
  weight: number | null;
  status: ReqStatus | null;
  confidence: string | null;
  evidence: Span[] | null;
  evidenceDropped: number | null;
  rationale: string | null;
}
interface Detail {
  id: string;
  vacancyId: string;
  state: string;
  band: string | null;
  candidateName: string | null;
  candidateEmail: string | null;
  summary: string | null;
  knockout:
    | {
        requirementId: string;
        text: string;
        triggered: boolean;
        matchedTerms: string[];
        rule: { type: string; terms: string[] };
      }[]
    | null;
  knockoutTriggered: boolean;
  injectionSuspected: boolean;
  score: { value: number; breakdown: Breakdown } | null;
  aiProvider: string | null;
  aiModel: string | null;
  error: string | null;
  criteriaVersion: number;
  documentId: string;
  filename: string;
  uploadedAt: string;
  parseStatus: string;
  text: string | null;
  textTruncated: boolean;
  erased: boolean;
  assessments: Assessment[];
  decisions: (Decision & { id: string })[];
}

export function Candidate({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState<Span | null>(null);
  const load = useCallback(async () => {
    try {
      setD(await api.get<Detail>(`/screenings/${id}`));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!d) return <p className="text-sm text-ink-3">Loading…</p>;

  return (
    <div className="space-y-4">
      <a href={`#/vacancies/${d.vacancyId}`} className="text-sm text-link hover:underline">
        ← Back to candidates
      </a>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{d.candidateName || d.filename}</h1>
          <p className="text-sm text-ink-3">
            {d.candidateEmail && <>{d.candidateEmail} · </>}
            {d.filename} · uploaded {when(d.uploadedAt)}
          </p>
          <p className="text-xs text-ink-3">
            Name and email were extracted by the AI and may be wrong.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {d.score ? (
            <div className="text-right">
              <div className="text-3xl font-semibold tabular-nums">{d.score.value}</div>
              <div className="text-xs text-ink-3">score / 100</div>
            </div>
          ) : null}
          <BandBadge band={d.band} />
          {!d.erased && (
            <button
              className={btnSecondary}
              onClick={() =>
                api
                  .download(`/documents/${d.documentId}/file`, d.filename)
                  .catch((e) => setError(errMsg(e)))
              }
            >
              Download original
            </button>
          )}
        </div>
      </div>

      {d.erased && (
        <Notice kind="warn">
          This candidate’s data has been erased. Only the decision record remains.
        </Notice>
      )}
      {d.state === 'failed' && <Notice kind="error">Screening failed: {d.error}</Notice>}
      {d.state === 'manual' && !d.erased && (
        <Notice kind="warn">
          No readable text could be extracted from this file (it may be a scan). Open the original
          and review it yourself; you can still record a decision.
        </Notice>
      )}
      {(d.state === 'queued' || d.state === 'processing') && (
        <Notice kind="info">Screening is still running. Refresh in a moment.</Notice>
      )}
      {d.knockoutTriggered && (
        <Notice kind="warn">
          <strong>Knockout rule matched.</strong> This CV was routed to you for review; nothing was
          rejected automatically.
          <ul className="mt-1 list-disc pl-5">
            {d.knockout
              ?.filter((k) => k.triggered)
              .map((k) => (
                <li key={k.requirementId}>
                  {k.text} (
                  {k.rule.type === 'must_contain_any'
                    ? `none of: ${k.rule.terms.join(', ')} found`
                    : `found: ${k.matchedTerms.join(', ')}`}
                  )
                </li>
              ))}
          </ul>
        </Notice>
      )}
      {d.injectionSuspected && (
        <Notice kind="warn">
          This CV contains text that looks like instructions to an AI. It has been routed to you for
          review. Read the original carefully.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {d.summary && (
            <Card title="AI summary">
              <p className="text-sm text-ink-2">{d.summary}</p>
              <p className="mt-2 text-xs text-ink-3">
                Generated by {d.aiProvider} / {d.aiModel}. Check it against the CV.
              </p>
            </Card>
          )}
          <Card title={`Criteria assessment (version ${d.criteriaVersion})`}>
            <div className="space-y-3">
              {d.assessments.map((a) => (
                <div key={a.requirementId} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{a.text}</div>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-ink-3">
                    {a.classification}
                    {a.weight != null && ` · weight ${a.weight}`}
                    {a.confidence && ` · AI confidence ${a.confidence}`}
                  </div>
                  {a.rationale && <p className="mt-1 text-sm text-ink-2">{a.rationale}</p>}
                  {a.evidence?.map((e, i) => (
                    <button
                      key={i}
                      onClick={() => setFocus(e)}
                      className="mt-1 block w-full rounded border border-yellow-300 bg-yellow-50 px-2 py-1 text-left text-sm italic hover:bg-yellow-100"
                    >
                      “{e.quote}”
                    </button>
                  ))}
                  {!!a.evidenceDropped && (
                    <p className="mt-1 text-xs text-warn-text">
                      The AI cited {a.evidenceDropped} quote(s) that do not appear in the CV; they
                      were discarded.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>
          {d.score && (
            <Card title="How the score was calculated">
              <p className="mb-2 text-xs text-ink-3">{d.score.breakdown.formula}</p>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Score breakdown</caption>
                <thead className="border-b text-xs uppercase text-ink-3">
                  <tr>
                    <th className="py-1 pr-2">Criterion</th>
                    <th className="pr-2">Weight</th>
                    <th className="pr-2">Status</th>
                    <th className="text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {d.score.breakdown.items.map((i) => (
                    <tr key={i.requirementId} className="border-b border-line">
                      <td className="py-1 pr-2">{i.text}</td>
                      <td className="pr-2 tabular-nums">{i.weight}</td>
                      <td className="pr-2">
                        <StatusBadge status={i.status} />
                      </td>
                      <td className="text-right tabular-nums">{i.earned}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="pt-2 font-medium">
                      Total
                    </td>
                    <td className="pt-2 text-right font-medium tabular-nums">
                      {d.score.breakdown.earned} / {d.score.breakdown.possible}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <DecisionPanel d={d} onSaved={load} />
          {d.text && (
            <CvText
              text={d.text}
              spans={d.assessments.flatMap((a) => a.evidence ?? [])}
              focus={focus}
              truncated={d.textTruncated}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CvText({
  text,
  spans,
  focus,
  truncated,
}: {
  text: string;
  spans: Span[];
  focus: Span | null;
  truncated: boolean;
}) {
  const focusRef = useRef<HTMLElement | null>(null);
  useEffect(
    () => focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    [focus],
  );
  const parts = useMemo(() => {
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    const out: { t: string; mark: Span | null }[] = [];
    let pos = 0;
    for (const s of sorted) {
      if (s.start < pos) continue; // overlapping spans: first one wins
      if (s.start > pos) out.push({ t: text.slice(pos, s.start), mark: null });
      out.push({ t: text.slice(s.start, s.end), mark: s });
      pos = s.end;
    }
    out.push({ t: text.slice(pos), mark: null });
    return out;
  }, [text, spans]);
  return (
    <Card title="CV text (evidence highlighted)">
      {truncated && (
        <div className="mb-2">
          <Notice kind="warn">
            This CV is very long; only the first part was read. Check the original.
          </Notice>
        </div>
      )}
      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
        {parts.map((p, i) =>
          p.mark ? (
            <mark
              key={i}
              ref={focus && focus.start === p.mark.start ? focusRef : undefined}
              className={focus && focus.start === p.mark.start ? 'bg-orange-300' : 'bg-yellow-200'}
            >
              {p.t}
            </mark>
          ) : (
            <span key={i}>{p.t}</span>
          ),
        )}
      </pre>
    </Card>
  );
}

function DecisionPanel({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<'shortlist' | 'hold' | 'reject'>('hold');
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = d.erased || d.state === 'queued' || d.state === 'processing';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/screenings/${d.id}/decision`, {
        outcome,
        reason,
        evidenceReviewed: reviewed,
      });
      setReason('');
      setReviewed(false);
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const current = d.decisions[0];
  return (
    <Card title="Your decision">
      <p className="mb-3 text-xs text-ink-3">
        The score and ranking are a recommendation. Only you decide, and your decision and reason
        are recorded under your name.
      </p>
      {current && (
        <p className="mb-3 text-sm">
          Current:{' '}
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${OUTCOME[current.outcome]![1]}`}
          >
            {OUTCOME[current.outcome]![0]}
          </span>{' '}
          by {current.decidedBy}, {when(current.decidedAt)}
        </p>
      )}
      <form onSubmit={submit} className="space-y-3">
        <fieldset className="flex flex-wrap gap-4 text-sm" disabled={locked}>
          <legend className="sr-only">Outcome</legend>
          {(['shortlist', 'hold', 'reject'] as const).map((o) => (
            <label key={o} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="outcome"
                checked={outcome === o}
                onChange={() => setOutcome(o)}
              />
              {o === 'shortlist' ? 'Shortlist' : o === 'hold' ? 'Hold' : 'Reject'}
            </label>
          ))}
        </fieldset>
        <Field
          label="Reason (required, at least 10 characters)"
          hint="Write what you based this on. Do not include sensitive personal details."
        >
          <textarea
            className={`${input} h-20`}
            required
            minLength={10}
            disabled={locked}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {outcome === 'reject' && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <span>
              I have read the CV and the evidence myself; this decision is not based on the score
              alone.
            </span>
          </label>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <button
          className={outcome === 'reject' ? btnDanger : btnPrimary}
          disabled={busy || locked || (outcome === 'reject' && !reviewed)}
        >
          Record decision
        </button>
      </form>
      {d.decisions.length > 1 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-ink-2">History ({d.decisions.length})</summary>
          <ul className="mt-2 space-y-2">
            {d.decisions.map((x) => (
              <li key={x.id} className="rounded border border-line p-2">
                <strong>{OUTCOME[x.outcome]![0]}</strong> · {x.decidedBy} · {when(x.decidedAt)}
                <div className="text-ink-2">{x.reason}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {d.decisions.length === 1 && current && (
        <p className="mt-3 text-sm text-ink-2">Reason: {current.reason}</p>
      )}
      {!d.erased && (
        <div className="mt-4 border-t pt-3">
          <button
            className={btnSecondary}
            onClick={() => {
              if (
                window.confirm(
                  'Erase this candidate’s file, extracted text and AI-extracted details? This cannot be undone. The decision record is kept.',
                )
              ) {
                void api
                  .post(`/documents/${d.documentId}/erase`)
                  .then(onSaved, (e) => setError(errMsg(e)));
              }
            }}
          >
            Erase candidate data
          </button>
        </div>
      )}
    </Card>
  );
}
