import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type CandidateRow,
  type Classification,
  type Criteria,
  type Requirement,
} from '../api';
import { Results } from './Results';
import {
  BandBadge,
  btnPrimary,
  btnSecondary,
  Card,
  errMsg,
  Field,
  input,
  Notice,
  OUTCOME,
} from '../ui';

interface V {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  candidateNoticeConfirmedAt: string | null;
}

type Tab = 'results' | 'candidates' | 'criteria';

export function Vacancy({ id }: { id: string }) {
  const [v, setV] = useState<V | null>(null);
  const [tab, setTab] = useState<Tab>('results');
  const [error, setError] = useState('');
  const reload = useCallback(
    () => api.get<V>(`/vacancies/${id}`).then(setV, (e) => setError(errMsg(e))),
    [id],
  );
  useEffect(() => void reload(), [reload]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!v) return <p className="text-sm text-ink-3">Loading…</p>;
  return (
    <div className="space-y-4">
      <div>
        <a href="#/vacancies" className="text-sm text-link hover:underline">
          ← Past scans
        </a>
        <h1 className="text-xl font-semibold">{v.title}</h1>
        <p className="text-sm text-ink-3">
          {[v.department, v.location].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div role="tablist" className="flex gap-1 border-b">
        {(['results', 'candidates', 'criteria'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? 'border-accent text-link' : 'border-transparent text-ink-2 hover:text-ink'}`}
          >
            {t === 'results' ? 'Results' : t === 'candidates' ? 'Table' : 'Criteria'}
          </button>
        ))}
      </div>
      {tab === 'criteria' ? (
        <CriteriaTab id={id} />
      ) : tab === 'results' ? (
        <Results vacancyId={id} onTable={() => setTab('candidates')} />
      ) : (
        <CandidatesTab id={id} vacancy={v} onNotice={reload} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ criteria

const CLASS_LABEL: Record<Classification, string> = {
  mandatory: 'Mandatory',
  preferred: 'Preferred',
  informational: 'Informational (not scored)',
  disqualifier: 'Knockout rule (routes to review)',
};

const blank = (): Requirement => ({
  text: '',
  classification: 'mandatory',
  weight: 10,
  rule: null,
});

function CriteriaTab({ id }: { id: string }) {
  const [c, setC] = useState<Criteria | null>(null);
  const [rows, setRows] = useState<Requirement[]>([]);
  const [jd, setJd] = useState('');
  const [editJd, setEditJd] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);

  const apply = (x: Criteria) => {
    setC(x);
    setRows(x.current?.requirements ?? []);
    setDirty(false);
  };
  const load = useCallback(async () => {
    try {
      apply(await api.get<Criteria>(`/vacancies/${id}/criteria`));
      setJd((await api.get<{ body: string }>(`/vacancies/${id}/jd`)).body);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    setOk('');
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const frozen = c?.current?.frozen ?? false;
  const edit = (i: number, patch: Partial<Requirement>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const setClass = (i: number, cl: Classification) =>
    edit(i, {
      classification: cl,
      weight: cl === 'mandatory' ? 10 : cl === 'preferred' ? 5 : null,
      rule: cl === 'disqualifier' ? { type: 'must_contain_any', terms: [] } : null,
    });
  const payload = () => ({
    requirements: rows.map((r) => ({
      text: r.text,
      classification: r.classification,
      weight: r.weight,
      rule: r.rule,
      confidence: r.confidence ?? null,
    })),
  });

  return (
    <div className="space-y-4">
      <Notice kind="info">
        The AI proposes criteria from the job description. <strong>You decide</strong>: edit, add or
        remove anything, then freeze. Frozen criteria cannot change, so every score can be traced to
        exactly what was used.
      </Notice>
      {error && <Notice kind="error">{error}</Notice>}
      {ok && <Notice kind="ok">{ok}</Notice>}

      <Card
        title="Job description"
        actions={
          <button className={btnSecondary} onClick={() => setEditJd((e) => !e)}>
            {editJd ? 'Close' : 'Edit text'}
          </button>
        }
      >
        {editJd ? (
          <div className="space-y-2">
            <textarea
              className={`${input} h-48 font-mono`}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
            />
            <button
              className={btnPrimary}
              disabled={!!busy}
              onClick={() =>
                run('jd', async () => {
                  await api.put(`/vacancies/${id}/jd`, { jdText: jd });
                  setEditJd(false);
                  setOk('Saved as a new version. Extract criteria again to refresh the draft.');
                })
              }
            >
              Save new version
            </button>
          </div>
        ) : (
          <p className="max-h-40 overflow-auto whitespace-pre-wrap text-sm text-ink-2">{jd}</p>
        )}
      </Card>

      <Card
        title={
          c?.current
            ? `Criteria · version ${c.current.version} · ${frozen ? 'frozen' : 'draft'}`
            : 'Criteria'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {!frozen && (
              <button
                className={btnSecondary}
                disabled={
                  !!busy ||
                  (rows.length > 0 &&
                    !window.confirm('Replace the current draft with new AI suggestions?'))
                }
                onClick={() =>
                  run('extract', async () =>
                    apply(await api.post<Criteria>(`/vacancies/${id}/criteria/extract`)),
                  )
                }
              >
                {busy === 'extract' ? 'Extracting…' : 'Extract with AI'}
              </button>
            )}
            {frozen && (
              <button
                className={btnSecondary}
                disabled={!!busy}
                onClick={() =>
                  run('nv', async () =>
                    apply(await api.post<Criteria>(`/vacancies/${id}/criteria/new-version`)),
                  )
                }
              >
                Create new version to edit
              </button>
            )}
          </div>
        }
      >
        {rows.length === 0 && !frozen && (
          <p className="text-sm text-ink-3">
            No criteria yet. Extract them with AI or add your own.
          </p>
        )}
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.id ?? i} className="rounded-md border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_14rem_6rem_auto]">
                <Field label="Criterion">
                  <input
                    className={input}
                    disabled={frozen}
                    value={r.text}
                    onChange={(e) => edit(i, { text: e.target.value })}
                  />
                </Field>
                <Field label="Type">
                  <select
                    className={input}
                    disabled={frozen}
                    value={r.classification}
                    onChange={(e) => setClass(i, e.target.value as Classification)}
                  >
                    {(Object.keys(CLASS_LABEL) as Classification[]).map((k) => (
                      <option key={k} value={k}>
                        {CLASS_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Weight">
                  <input
                    className={input}
                    type="number"
                    min={1}
                    max={100}
                    disabled={
                      frozen ||
                      (r.classification !== 'mandatory' && r.classification !== 'preferred')
                    }
                    value={r.weight ?? ''}
                    onChange={(e) =>
                      edit(i, { weight: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </Field>
                {!frozen && (
                  <div className="flex items-end">
                    <button
                      className={btnSecondary}
                      onClick={() => (
                        setRows((rs) => rs.filter((_, j) => j !== i)),
                        setDirty(true)
                      )}
                      aria-label={`Remove criterion ${i + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              {r.classification === 'disqualifier' && r.rule && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[14rem_1fr]">
                  <Field label="Rule">
                    <select
                      className={input}
                      disabled={frozen}
                      value={r.rule.type}
                      onChange={(e) =>
                        edit(i, {
                          rule: { ...r.rule!, type: e.target.value as 'must_contain_any' },
                        })
                      }
                    >
                      <option value="must_contain_any">
                        Flag if the CV contains NONE of these words
                      </option>
                      <option value="must_not_contain_any">
                        Flag if the CV contains ANY of these words
                      </option>
                    </select>
                  </Field>
                  <Field
                    label="Words (comma-separated)"
                    hint="Matched as whole words, ignoring case. Include likely synonyms and languages. A match only sends the CV to human review; nobody is rejected automatically."
                  >
                    <input
                      className={input}
                      disabled={frozen}
                      value={r.rule.terms.join(', ')}
                      onChange={(e) =>
                        edit(i, {
                          rule: {
                            ...r.rule!,
                            terms: e.target.value
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              )}
              {(r.confidence === 'low' || r.confidence === 'medium') && !dirty && (
                <p className="mt-1 text-xs text-warn-text">
                  The AI was {r.confidence === 'low' ? 'unsure' : 'moderately sure'} about this one.
                  Please check it.
                </p>
              )}
            </div>
          ))}
        </div>
        {!frozen && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={btnSecondary}
              onClick={() => (setRows((rs) => [...rs, blank()]), setDirty(true))}
            >
              Add criterion
            </button>
            <button
              className={btnSecondary}
              disabled={!!busy || !dirty}
              onClick={() =>
                run(
                  'save',
                  async () => (
                    apply(await api.put<Criteria>(`/vacancies/${id}/criteria`, payload())),
                    setOk('Draft saved.')
                  ),
                )
              }
            >
              Save draft
            </button>
            <button
              className={btnPrimary}
              disabled={!!busy || rows.length === 0}
              onClick={() =>
                run('freeze', async () => {
                  if (
                    !window.confirm(
                      'Freeze these criteria? They cannot be edited afterwards (you can create a new version).',
                    )
                  )
                    return;
                  if (dirty) await api.put(`/vacancies/${id}/criteria`, payload());
                  apply(await api.post<Criteria>(`/vacancies/${id}/criteria/freeze`));
                  setOk('Criteria frozen. You can now upload CVs.');
                })
              }
            >
              Freeze criteria
            </button>
          </div>
        )}
        {frozen && c?.versions && c.versions.length > 1 && (
          <p className="mt-3 text-xs text-ink-3">
            After creating and freezing a new version, use “Screen with latest criteria” on the
            Candidates tab.
          </p>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ candidates

interface Listing {
  counts: { total: number; queued: number; failed: number; manual: number; undecided: number };
  aiActive: boolean;
  candidates: CandidateRow[];
}
interface UploadResult {
  results: { filename: string; status: string; message?: string }[];
}

export const NOTICE_TEXT = `Our recruitment team uses an AI-assisted tool to help read and compare applications against the requirements of the role. The tool produces a suggested ranking with the evidence behind it. It does not make decisions: every shortlisting or rejection decision is made by a member of our recruitment team, who reviews your application. You may ask us for a human review of your application, for access to your data, or for its deletion, by contacting HR.`;

function CandidatesTab({
  id,
  vacancy,
  onNotice,
}: {
  id: string;
  vacancy: V;
  onNotice: () => void;
}) {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<UploadResult['results']>([]);
  const [busy, setBusy] = useState(false);
  const [band, setBand] = useState('');
  const [ack, setAck] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Listing>(`/vacancies/${id}/candidates`));
      setError('');
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);
  // Poll while work is outstanding.
  const pending = data?.counts.queued ?? 0;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [pending, load]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.upload<UploadResult>(`/vacancies/${id}/documents`, files);
      setUploads(r.results);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const confirmNotice = async () => {
    try {
      await api.post(`/vacancies/${id}/notice-confirm`);
      onNotice();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const rows = (data?.candidates ?? []).filter(
    (c) => !band || c.band === band || (band === 'undecided' && !c.decision),
  );

  return (
    <div className="space-y-4">
      {error && <Notice kind="error">{error}</Notice>}
      {data && !data.aiActive && (
        <Notice kind="warn">
          No AI provider is active, so uploaded CVs will wait in the queue. An administrator can set
          one up under Admin → AI models.
        </Notice>
      )}

      {!vacancy.candidateNoticeConfirmedAt ? (
        <Card title="Before you upload: candidate notice">
          <p className="mb-2 text-sm text-ink-2">
            Candidates must be told that AI assists the screening of their application. Share this
            text (for example in the job advert or the application confirmation), then confirm
            below. Uploading is blocked until you do.
          </p>
          <blockquote className="mb-3 rounded border-l-4 border-accent bg-sel p-3 text-sm text-ink">
            {NOTICE_TEXT}
          </blockquote>
          <label className="mb-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              I confirm that the candidates for this vacancy have been informed that AI is used to
              assist the screening of their applications, and how to request human review.
            </span>
          </label>
          <button className={btnPrimary} disabled={!ack} onClick={confirmNotice}>
            Confirm and enable uploads
          </button>
        </Card>
      ) : (
        <Card title="Upload CVs">
          <p className="mb-2 text-sm text-ink-2">
            PDF, DOCX or TXT, up to 10 MB each, up to 50 files at a time. Scanned (image-only) PDFs
            cannot be read and are flagged for manual review.
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt"
            aria-label="Choose CV files"
            disabled={busy}
            onChange={(e) => void upload(Array.from(e.target.files ?? []))}
            className="block text-sm"
          />
          {busy && <p className="mt-2 text-sm text-ink-3">Uploading and reading files…</p>}
          {uploads.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {uploads.map((u, i) => (
                <li
                  key={i}
                  className={
                    u.status === 'queued'
                      ? 'text-ok-text'
                      : u.status === 'duplicate'
                        ? 'text-ink-2'
                        : 'text-warn-text'
                  }
                >
                  {u.filename}:{' '}
                  {u.status === 'queued' ? 'queued for screening' : (u.message ?? u.status)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card
        title="Candidates"
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              className={btnSecondary}
              onClick={() =>
                api.post<{ queued: number }>(`/vacancies/${id}/rescreen`).then(
                  (r) => (
                    setUploads([
                      {
                        filename: 'Re-screen',
                        status: 'queued',
                        message: `${r.queued} CV(s) queued with the latest criteria`,
                      },
                    ]),
                    load()
                  ),
                  (e) => setError(errMsg(e)),
                )
              }
            >
              Screen with latest criteria
            </button>
            <button
              className={btnSecondary}
              onClick={() =>
                api
                  .download(`/vacancies/${id}/export.xlsx`, `candidates-${id}.xlsx`)
                  .catch((e) => setError(errMsg(e)))
              }
            >
              Export to Excel
            </button>
          </div>
        }
      >
        {data && (
          <p className="mb-3 text-sm text-ink-2" aria-live="polite">
            {data.counts.total} CV(s) · {data.counts.undecided} awaiting your decision
            {data.counts.queued > 0 && ` · ${data.counts.queued} being screened`}
            {data.counts.failed > 0 && ` · ${data.counts.failed} failed`}
            {data.counts.manual > 0 && ` · ${data.counts.manual} need manual reading`}
          </p>
        )}
        <div className="mb-3 max-w-xs">
          <Field label="Filter">
            <select className={input} value={band} onChange={(e) => setBand(e.target.value)}>
              <option value="">All</option>
              <option value="needs_review">Needs review</option>
              <option value="strong_match">Strong match</option>
              <option value="possible_match">Possible match</option>
              <option value="weak_match">Weak match</option>
              <option value="undecided">Awaiting my decision</option>
            </select>
          </Field>
        </div>
        {data && data.counts.total === 0 && (
          <p className="text-sm text-ink-3">
            No CVs yet. Freeze the criteria on the Criteria tab, confirm the notice, then upload.
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Candidates ranked by score</caption>
              <thead className="border-b text-xs uppercase text-ink-3">
                <tr>
                  <th className="py-2 pr-3">Candidate</th>
                  <th className="pr-3">Score</th>
                  <th className="pr-3">AI view (a sorting aid)</th>
                  <th className="pr-3">Flags</th>
                  <th className="pr-3">Your decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.documentId} className="border-b border-line align-top">
                    <td className="py-2 pr-3">
                      {c.screeningId && !c.erased ? (
                        <a
                          className="font-medium text-link hover:underline"
                          href={`#/screenings/${c.screeningId}`}
                        >
                          {c.candidateName || c.filename}
                        </a>
                      ) : (
                        <span>{c.erased ? 'Erased' : c.filename}</span>
                      )}
                      {c.candidateName && <div className="text-xs text-ink-3">{c.filename}</div>}
                    </td>
                    <td className="pr-3">{c.score ? c.score.value : '—'}</td>
                    <td className="pr-3">
                      {c.state === 'completed' ? (
                        <BandBadge band={c.band} />
                      ) : (
                        <span className="text-xs text-ink-2">{stateLabel(c)}</span>
                      )}
                    </td>
                    <td className="pr-3 text-xs">
                      {c.knockoutTriggered && (
                        <div className="text-warn-text">Knockout rule matched</div>
                      )}
                      {c.injectionSuspected && (
                        <div className="text-warn-text">Text tries to instruct the AI</div>
                      )}
                      {c.score && c.score.breakdown.mandatoryGaps > 0 && (
                        <div>{c.score.breakdown.mandatoryGaps} mandatory gap(s)</div>
                      )}
                    </td>
                    <td className="pr-3">
                      {c.decision ? (
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${OUTCOME[c.decision.outcome]![1]}`}
                        >
                          {OUTCOME[c.decision.outcome]![0]}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-3">Undecided</span>
                      )}
                    </td>
                    <td>
                      {c.state === 'failed' && c.screeningId && (
                        <button
                          className={btnSecondary}
                          onClick={() =>
                            api
                              .post(`/screenings/${c.screeningId}/retry`)
                              .then(load, (e) => setError(errMsg(e)))
                          }
                        >
                          Retry
                        </button>
                      )}
                      {c.state === 'manual' && c.screeningId && !c.erased && (
                        <a className={btnSecondary} href={`#/screenings/${c.screeningId}`}>
                          Open
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.counts.total > 0 && rows.length === 0 && (
          <p className="text-sm text-ink-3">Nothing matches this filter.</p>
        )}
      </Card>
    </div>
  );
}

function stateLabel(c: CandidateRow) {
  switch (c.state) {
    case 'queued':
      return 'Waiting to be screened';
    case 'processing':
      return 'Screening…';
    case 'failed':
      return `Failed${c.error ? `: ${c.error}` : ''}`;
    case 'manual':
      return 'No readable text: review the original';
    default:
      return c.state;
  }
}
