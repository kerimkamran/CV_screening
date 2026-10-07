import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  Card,
  errMsg,
  Field,
  input,
  Notice,
  when,
} from '../ui';

interface Cert {
  id: string;
  runAt: string;
  trigger: 'schedule' | 'manual';
  days: number;
  documents: number;
  heldBack: number;
  vacancies: number;
  by: string;
}
interface Vac {
  id: string;
  title: string;
  legalHold: boolean;
  matter: string | null;
  since: string | null;
  by: string | null;
  documents: number;
}
interface Status {
  enabled: boolean;
  days: number;
  due: number;
  heldBack: number;
  cutoff: string;
  certificates: Cert[];
  vacancies: Vac[];
}
interface Run {
  documents: number;
  heldBack: number;
  dryRun: boolean;
  certificateId: string | null;
}

/** Retention period, legal hold and deletion certificates (administrators). */
export function Retention() {
  const [st, setSt] = useState<Status | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState(180);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [matter, setMatter] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const s = await api.get<Status>('/admin/retention');
      setSt(s);
      setEnabled(s.enabled);
      setDays(s.days);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    act(async () => {
      await api.put('/admin/retention', { enabled, days });
      setMsg('Saved.');
    });
  const run = (dryRun: boolean) =>
    act(async () => {
      const r = await api.post<Run>('/admin/retention/run', { dryRun });
      setConfirm(false);
      setMsg(
        dryRun
          ? `Preview: ${r.documents} file(s) would be erased; ${r.heldBack} kept because of a legal hold.`
          : `Done: ${r.documents} file(s) erased; ${r.heldBack} kept because of a legal hold.`,
      );
    });
  const hold = (v: Vac, on: boolean) =>
    act(async () => {
      await api.put(`/admin/vacancies/${v.id}/legal-hold`, { hold: on, matter: matter[v.id] });
      setMatter((m) => ({ ...m, [v.id]: '' }));
    });

  if (!st)
    return error ? (
      <Notice kind="error">{error}</Notice>
    ) : (
      <p className="text-sm text-ink-3">Loading…</p>
    );
  return (
    <div className="space-y-4">
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="ok">{msg}</Notice>}
      <Card title="Retention period">
        <div className="space-y-3 text-sm">
          <p>
            When this is on, CV files and everything extracted from them (text, name, e-mail,
            summary, quotes, shared-report copies, assistant chats) are erased automatically once
            they are older than the period below, unless the vacancy is under legal hold. Decisions
            and the audit trail are kept. A run happens about once an hour and every run leaves a
            deletion certificate.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Erase automatically
          </label>
          <Field label="Keep CV files for (days, 30 to 3650)">
            <input
              className={`${input} max-w-[10rem]`}
              type="number"
              min={30}
              max={3650}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={() => void save()} disabled={busy}>
              Save
            </button>
            <button className={btnSecondary} onClick={() => void run(true)} disabled={busy}>
              Preview what would be erased
            </button>
            {confirm ? (
              <button className={btnDanger} onClick={() => void run(false)} disabled={busy}>
                Yes, erase now ({st.due} file{st.due === 1 ? '' : 's'}, cannot be undone)
              </button>
            ) : (
              <button
                className={btnDanger}
                onClick={() => setConfirm(true)}
                disabled={busy || st.due === 0}
              >
                Erase expired files now
              </button>
            )}
          </div>
          <p className="text-xs text-ink-3">
            Right now: {st.due} file(s) older than {st.days} days and not on hold; {st.heldBack}{' '}
            more on hold. The preview and the button use the saved period.
          </p>
        </div>
      </Card>

      <Card title="Legal hold">
        <p className="mb-2 text-sm">
          A vacancy under hold is never purged, for example while a complaint or claim about a
          hiring decision is open. Name the matter; lifting the hold lets the next run take expired
          files.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Vacancies and legal hold</caption>
            <thead className="border-b text-xs uppercase text-ink-3">
              <tr>
                <th className="py-2 pr-3">Vacancy</th>
                <th className="pr-3">Files held</th>
                <th className="pr-3">Hold</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {st.vacancies.map((v) => (
                <tr key={v.id} className="border-b border-line align-top">
                  <td className="py-2 pr-3 font-medium">{v.title}</td>
                  <td className="pr-3">{v.documents}</td>
                  <td className="pr-3">
                    {v.legalHold ? `${v.matter} (${v.by}, ${when(v.since ?? '')})` : '—'}
                  </td>
                  <td className="py-1">
                    {v.legalHold ? (
                      <button
                        className={btnSecondary}
                        onClick={() => void hold(v, false)}
                        disabled={busy}
                      >
                        Lift hold
                      </button>
                    ) : (
                      <span className="flex gap-2">
                        <input
                          className={input}
                          aria-label={`Matter reference for ${v.title}`}
                          placeholder="Matter reference"
                          value={matter[v.id] ?? ''}
                          onChange={(e) => setMatter((m) => ({ ...m, [v.id]: e.target.value }))}
                        />
                        <button
                          className={btnSecondary}
                          onClick={() => void hold(v, true)}
                          disabled={busy || (matter[v.id] ?? '').trim().length < 3}
                        >
                          Place hold
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Deletion certificates">
        {st.certificates.length === 0 ? (
          <p className="text-sm text-ink-3">No purge has run yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Deletion certificates</caption>
            <thead className="border-b text-xs uppercase text-ink-3">
              <tr>
                <th className="py-2 pr-3">When</th>
                <th className="pr-3">Run by</th>
                <th className="pr-3">Period</th>
                <th className="pr-3">Files erased</th>
                <th className="pr-3">Kept (hold)</th>
                <th>Certificate</th>
              </tr>
            </thead>
            <tbody>
              {st.certificates.map((c) => (
                <tr key={c.id} className="border-b border-line">
                  <td className="py-2 pr-3">{when(c.runAt)}</td>
                  <td className="pr-3">{c.trigger === 'schedule' ? 'Scheduled' : c.by}</td>
                  <td className="pr-3">{c.days} days</td>
                  <td className="pr-3">{c.documents}</td>
                  <td className="pr-3">{c.heldBack}</td>
                  <td className="font-mono text-xs">{c.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-ink-3">
          The certificate number matches an entry in the audit trail; every erased file also has its
          own entry.
        </p>
      </Card>
    </div>
  );
}
