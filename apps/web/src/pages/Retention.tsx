import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
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
  const t = useT();
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
  // The armed confirmation does not linger: it ends by itself after 20 s (AD-18).
  useEffect(() => {
    if (!confirm) return;
    const h = setTimeout(() => setConfirm(false), 20_000);
    return () => clearTimeout(h);
  }, [confirm]);

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
      setMsg(t('Saved.'));
    });
  const run = (dryRun: boolean) =>
    act(async () => {
      const r = await api.post<Run>('/admin/retention/run', { dryRun });
      setConfirm(false);
      setMsg(
        dryRun
          ? t('Preview: {n} file(s) would be erased; {held} kept because of a legal hold.', {
              n: r.documents,
              held: r.heldBack,
            })
          : t('Done: {n} file(s) erased; {held} kept because of a legal hold.', {
              n: r.documents,
              held: r.heldBack,
            }),
      );
    });
  const hold = (v: Vac, on: boolean) =>
    act(async () => {
      // Only a new hold carries a matter: the box is emptied after a hold is placed, and lifting that
      // hold in the same visit must not send the empty text (the API rejects a matter under 3 characters).
      await api.put(
        `/admin/vacancies/${v.id}/legal-hold`,
        on ? { hold: true, matter: matter[v.id] } : { hold: false },
      );
      setMatter((m) => ({ ...m, [v.id]: '' }));
    });

  if (!st)
    return error ? (
      <Notice kind="error">{error}</Notice>
    ) : (
      <p className="text-sm text-ink-3">{t('Loading…')}</p>
    );
  return (
    <div className="space-y-4">
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="ok">{msg}</Notice>}
      <Card title={t('Retention period')}>
        <div className="space-y-3 text-sm">
          <p>
            {t(
              'When this is on, CV files and everything extracted from them (text, name, e-mail, summary, quotes, shared-report copies, assistant chats) are erased automatically once they are older than the period below, unless the vacancy is under legal hold. Decisions and the audit trail are kept. A run happens about once an hour and every run leaves a deletion certificate.',
            )}
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {t('Erase automatically')}
          </label>
          <Field label={t('Keep CV files for (days, 30 to 3650)')}>
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
              {t('Save')}
            </button>
            <button className={btnSecondary} onClick={() => void run(true)} disabled={busy}>
              {t('Preview what would be erased')}
            </button>
            {/* The first click only asks; the confirmation opens below, away from this spot, so a
                double-click can never erase (SD-39). */}
            <button
              className={btnDanger}
              onClick={() => setConfirm(true)}
              disabled={busy || st.due === 0 || confirm}
              aria-expanded={confirm}
            >
              {t('Erase expired files now')}
            </button>
          </div>
          {confirm && (
            <div
              role="alertdialog"
              aria-label={t('Erase expired files')}
              className="space-y-2 rounded-xl border border-err-line bg-err p-3 text-sm text-err-ink"
            >
              <p>
                {st.due === 1
                  ? t('Erase {n} file now? This cannot be undone.', { n: st.due })
                  : t('Erase {n} files now? This cannot be undone.', { n: st.due })}
              </p>
              <div className="flex flex-wrap gap-2">
                <button className={btnSecondary} onClick={() => setConfirm(false)} autoFocus>
                  {t('Cancel')}
                </button>
                <button
                  className={btnDanger}
                  onClick={() => {
                    setConfirm(false);
                    void run(false);
                  }}
                  disabled={busy}
                >
                  {t('Yes, erase now')}
                </button>
              </div>
            </div>
          )}
          <p className="text-xs text-ink-3">
            {t(
              'Right now: {due} file(s) older than {days} days and not on hold; {heldBack} more on hold. The preview and the button use the saved period.',
              { due: st.due, days: st.days, heldBack: st.heldBack },
            )}
          </p>
        </div>
      </Card>

      <Card title={t('Legal hold')}>
        <p className="mb-2 text-sm">
          {t(
            'A vacancy under hold is never purged, for example while a complaint or claim about a hiring decision is open. Name the matter; lifting the hold lets the next run take expired files.',
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('Vacancies and legal hold')}</caption>
            <thead className="border-b text-xs uppercase text-ink-3">
              <tr>
                <th className="py-2 pr-3">{t('Vacancy')}</th>
                <th className="pr-3">{t('Files held')}</th>
                <th className="pr-3">{t('Hold')}</th>
                <th>{t('Action')}</th>
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
                        {t('Lift hold')}
                      </button>
                    ) : (
                      <span className="flex gap-2">
                        <input
                          className={input}
                          aria-label={`Matter reference for ${v.title}`}
                          placeholder={t('Matter reference')}
                          value={matter[v.id] ?? ''}
                          onChange={(e) => setMatter((m) => ({ ...m, [v.id]: e.target.value }))}
                        />
                        <button
                          className={btnSecondary}
                          onClick={() => void hold(v, true)}
                          disabled={busy || (matter[v.id] ?? '').trim().length < 3}
                        >
                          {t('Place hold')}
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

      <Card title={t('Deletion certificates')}>
        {st.certificates.length === 0 ? (
          <p className="text-sm text-ink-3">{t('No purge has run yet.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('Deletion certificates')}</caption>
              <thead className="border-b text-xs uppercase text-ink-3">
                <tr>
                  <th className="py-2 pr-3">{t('When')}</th>
                  <th className="pr-3">{t('Run by')}</th>
                  <th className="pr-3">{t('Period')}</th>
                  <th className="pr-3">{t('Files erased')}</th>
                  <th className="pr-3">{t('Kept (hold)')}</th>
                  <th>{t('Certificate')}</th>
                </tr>
              </thead>
              <tbody>
                {st.certificates.map((c) => (
                  <tr key={c.id} className="border-b border-line">
                    <td className="py-2 pr-3">{when(c.runAt)}</td>
                    <td className="pr-3">{c.trigger === 'schedule' ? t('Scheduled') : c.by}</td>
                    <td className="pr-3">{t('{days} days', { days: c.days })}</td>
                    <td className="pr-3">{c.documents}</td>
                    <td className="pr-3">{c.heldBack}</td>
                    <td className="font-mono text-xs">{c.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-3">
          {t(
            'The certificate number matches an entry in the audit trail; every erased file also has its own entry.',
          )}
        </p>
      </Card>
    </div>
  );
}
