import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { btnDanger, btnPrimary, btnSecondary, errMsg, Field, input, Notice, when } from '../ui';

/**
 * Share the report as a login-only link (design spec 6.5). The recruiter names the people, picks
 * an expiry, decides on names and quotes, and sees who opened it. A shared report is a snapshot.
 */

interface Person {
  id: string;
  displayName: string;
  email: string | null;
}
interface Share {
  id: string;
  createdAt: string;
  expiresAt: string;
  state: 'active' | 'expired' | 'revoked';
  includeNames: boolean;
  includeQuotes: boolean;
  viewers: { id: string; name: string; email: string | null }[];
  openCount: number;
  opens: { by: string; at: string; outcome: string }[];
}

const OUTCOME_TEXT: Record<string, string> = {
  ok: 'opened',
  denied: 'tried to open, not on the list',
  expired: 'tried to open after it expired',
  revoked: 'tried to open after it was revoked',
};
const DAYS = [7, 14, 30, 60, 90];

export const reportLink = (id: string) =>
  `${window.location.origin}${window.location.pathname}#/reports/${id}`;

export function ShareReport({
  vacancyId,
  blocked,
}: {
  vacancyId: string;
  /** Why sharing is not offered right now (scan still running, nothing scored). */
  blocked: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person[]>([]);
  const [days, setDays] = useState(30);
  const [names, setNames] = useState(false);
  const [quotes, setQuotes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  const loadShares = useCallback(async () => {
    try {
      const r = await api.get<{ shares: Share[] }>(`/vacancies/${vacancyId}/shares`);
      setShares(Array.isArray(r.shares) ? r.shares : []);
    } catch {
      setShares([]);
    }
  }, [vacancyId]);
  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api
        .get<{ people: Person[] }>(`/reports/people?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setFound(Array.isArray(r.people) ? r.people : []))
        .catch(() => setFound([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const toggle = (p: Person) =>
    setPicked((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, p]));

  async function create() {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ id: string }>(`/vacancies/${vacancyId}/shares`, {
        viewerIds: picked.map((p) => p.id),
        expiresInDays: days,
        includeNames: names,
        includeQuotes: quotes,
      });
      setCreated(r.id);
      setPicked([]);
      await loadShares();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    try {
      await api.post(`/shares/${id}/revoke`);
      await loadShares();
    } catch (e) {
      setError(errMsg(e));
    }
  }
  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(reportLink(id));
      setCopied(id);
    } catch {
      setCopied('');
      setError('Could not copy. Select the link and copy it by hand.');
    }
  }

  return (
    <section aria-labelledby="share-h" className="rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="share-h" className="text-lg font-semibold">
          Share this report
        </h3>
        <button
          className={btnSecondary}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          disabled={Boolean(blocked) && shares.length === 0}
        >
          {open ? 'Close' : 'Share as a link'}
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-3">
        A login-only link to a snapshot taken now. Only the people you name can open it.
      </p>
      {blocked && <p className="mt-2 text-sm text-ink-2">{blocked}</p>}

      {open && !blocked && (
        <div className="mt-4 space-y-4">
          {created ? (
            <div className="space-y-2" role="status">
              <Notice kind="info">
                The link is ready. Send it to the people you named; they sign in to open it.
              </Notice>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  aria-label="Report link"
                  className={`${input} max-w-xl`}
                  value={reportLink(created)}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className={btnPrimary} onClick={() => void copy(created)}>
                  {copied === created ? 'Copied' : 'Copy link'}
                </button>
                <button className={btnSecondary} onClick={() => setCreated(null)}>
                  Share with someone else
                </button>
              </div>
            </div>
          ) : (
            <>
              <Field label="Who can open it" hint="People with an account. They must sign in.">
                <input
                  className={input}
                  placeholder="Search by name or e-mail"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </Field>
              {picked.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Chosen people">
                  {picked.map((p) => (
                    <li
                      key={p.id}
                      className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-0.5 text-sm"
                    >
                      {p.displayName}
                      <button
                        className="text-ink-3 hover:text-ink"
                        aria-label={`Remove ${p.displayName}`}
                        onClick={() => toggle(p)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <ul
                className="max-h-48 overflow-auto rounded-md border border-line"
                aria-label="People found"
              >
                {found.length === 0 && (
                  <li className="px-3 py-2 text-sm text-ink-3">No one found.</li>
                )}
                {found.map((p) => (
                  <li key={p.id} className="border-b border-line last:border-0">
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.some((x) => x.id === p.id)}
                        onChange={() => toggle(p)}
                      />
                      <span>{p.displayName}</span>
                      {p.email && <span className="text-ink-3">{p.email}</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <Field label="Link works for">
                <select
                  className={`${input} max-w-xs`}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </Field>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={names}
                    onChange={(e) => setNames(e.target.checked)}
                  />
                  <span>
                    Include real names, only for candidates you showed or shortlisted.
                    {names && (
                      <span className="block text-ink-2">
                        Real names will be visible to the people you choose.
                      </span>
                    )}
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={quotes}
                    onChange={(e) => setQuotes(e.target.checked)}
                  />
                  <span>
                    Include quotes from the CVs.
                    <span className="block text-ink-3">
                      Quotes are text from resumes and count as personal data.
                    </span>
                  </span>
                </label>
              </div>
              {error && <Notice kind="error">{error}</Notice>}
              <button
                className={btnPrimary}
                disabled={busy || picked.length === 0}
                onClick={() => void create()}
              >
                {busy ? 'Preparing…' : 'Create link'}
              </button>
            </>
          )}
        </div>
      )}
      {error && !open && <Notice kind="error">{error}</Notice>}

      {shares.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium">Shared so far</h4>
          <ul className="mt-2 space-y-3">
            {shares.map((s) => (
              <li key={s.id} className="rounded-md border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Snapshot of {when(s.createdAt)} ·{' '}
                    {s.state === 'active'
                      ? `works until ${when(s.expiresAt)}`
                      : s.state === 'expired'
                        ? 'expired'
                        : 'revoked'}
                  </span>
                  {s.state === 'active' && (
                    <span className="flex gap-2">
                      <button className={btnSecondary} onClick={() => void copy(s.id)}>
                        {copied === s.id ? 'Copied' : 'Copy link'}
                      </button>
                      <button className={btnDanger} onClick={() => void revoke(s.id)}>
                        Revoke
                      </button>
                    </span>
                  )}
                </div>
                <p className="mt-1 text-ink-2">
                  For {s.viewers.map((v) => v.name).join(', ') || 'no one'}.{' '}
                  {s.includeNames ? 'Real names included.' : 'Pseudonyms only.'}{' '}
                  {s.includeQuotes ? 'Quotes included.' : 'No quotes.'}
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-link">
                    Opened {s.openCount} {s.openCount === 1 ? 'time' : 'times'}
                  </summary>
                  <ul className="mt-1 list-disc pl-5 text-ink-2">
                    {s.opens.length === 0 && (
                      <li className="list-none text-ink-3">Not opened yet.</li>
                    )}
                    {s.opens.map((o, i) => (
                      <li key={i}>
                        {o.by} {OUTCOME_TEXT[o.outcome] ?? o.outcome}, {when(o.at)}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
