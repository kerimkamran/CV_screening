import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { ago } from '../pool';
import { useT } from '../i18n';
import { btnPrimary, btnSecondary, Card, errMsg, Field, input, Notice } from '../ui';

interface LinkState {
  enabled: boolean;
  consent: {
    source: string;
    evidence: string;
    recordedBy: string | null;
    recordedAt: string;
  } | null;
  links: { url: string; host: string; blocked: boolean }[];
  reviews: {
    id: string;
    url: string;
    host: string;
    text: string;
    words: number;
    flagged: boolean;
    fetchedAt: string;
  }[];
}

const SOURCE: Record<string, string> = {
  application_form: 'Application form',
  hr_system: 'HR system',
  email: 'E-mail from the candidate',
  other: 'Other',
};

/**
 * Links the candidate wrote in the resume (SenAI plan S3). Shown only when the administrator has turned
 * on "link review". A page is read only after a consent is recorded and only when the person presses
 * the button. What was read is redacted, never scored and never sent to a model.
 */
export function CandidateLinks({ matchId, canEdit }: { matchId: string; canEdit: boolean }) {
  const t = useT();
  const [st, setSt] = useState<LinkState | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [source, setSource] = useState('application_form');
  const [evidence, setEvidence] = useState('');
  const base = `/assistant/candidates/${matchId}/links`;

  const load = useCallback(async () => {
    try {
      const r = await api.get<LinkState>(base);
      setSt(r && Array.isArray(r.links) ? r : null);
    } catch {
      setSt(null);
    }
  }, [base]);
  useEffect(() => {
    setSt(null);
    setMsg(null);
    void load();
  }, [load]);

  if (!st || !st.enabled || st.links.length === 0) return null;

  async function run(key: string, fn: () => Promise<LinkState>) {
    setBusy(key);
    setMsg(null);
    try {
      setSt(await fn());
    } catch (e) {
      setMsg({ kind: 'error', text: errMsg(e) });
    } finally {
      setBusy('');
    }
  }
  const record = (e: FormEvent) => {
    e.preventDefault();
    void run('consent', () => api.post<LinkState>(`${base}/consent`, { source, evidence }));
  };

  return (
    <Card title={t('Links the candidate gave')}>
      <p className="mb-2 text-sm text-ink-2">
        {t(
          'A page is read only with the candidate’s recorded consent and only when you press the button. Contact details and the name are removed, and the text is not scored.',
        )}
      </p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {st.consent ? (
        <p className="mb-2 text-sm">
          {t('Consent recorded: {source} ({evidence}) by {name} {when}.', {
            source: t(SOURCE[st.consent.source] ?? st.consent.source),
            evidence: st.consent.evidence,
            name: st.consent.recordedBy ?? '—',
            when: ago(st.consent.recordedAt),
          })}{' '}
          {canEdit && (
            <button
              type="button"
              className="text-link underline"
              disabled={busy !== ''}
              onClick={() => void run('withdraw', () => api.del<LinkState>(`${base}/consent`))}
            >
              {t('Withdraw consent and delete what was read')}
            </button>
          )}
        </p>
      ) : canEdit ? (
        <form onSubmit={record} className="mb-3 grid gap-2 sm:grid-cols-2">
          <Field label={t('Where the consent came from')}>
            <select className={input} value={source} onChange={(e) => setSource(e.target.value)}>
              {Object.entries(SOURCE).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Reference (form number, date, e-mail subject)')}>
            <input
              className={input}
              value={evidence}
              maxLength={200}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className={btnPrimary}
              disabled={busy !== '' || evidence.trim().length < 3}
            >
              {t('Record the candidate’s consent')}
            </button>
          </div>
        </form>
      ) : null}
      <ul className="divide-y divide-line text-sm" aria-label={t('Links in the CV')}>
        {st.links.map((l) => (
          <li key={l.url} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 break-all">{l.url}</span>
            {l.blocked ? (
              <span className="text-xs text-ink-3">{t('Social networks are never read')}</span>
            ) : (
              <button
                type="button"
                className={btnSecondary}
                disabled={!st.consent || !canEdit || busy !== ''}
                aria-label={t('Read {host}', { host: l.host })}
                onClick={() =>
                  void run(l.url, () => api.post<LinkState>(`${base}/review`, { url: l.url }))
                }
              >
                {busy === l.url ? t('Reading…') : t('Read this page')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {st.reviews.map((r) => (
        <figure key={r.id} className="mt-3 rounded-md border border-line bg-page p-3 text-sm">
          <figcaption className="mb-1 text-xs text-ink-3">
            {t('Candidate-provided link · {host} · read {when} · not assessed', {
              host: r.host,
              when: ago(r.fetchedAt),
            })}
          </figcaption>
          {r.flagged && (
            <p role="note" className="mb-1 text-xs text-warn-text">
              {t('This page contains instructions aimed at an AI. They were ignored.')}
            </p>
          )}
          <blockquote className="max-h-60 overflow-y-auto whitespace-pre-wrap text-ink-2">
            {r.text}
          </blockquote>
        </figure>
      ))}
    </Card>
  );
}
