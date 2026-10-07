import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { btnDanger, btnPrimary, btnSecondary, Card, errMsg, Field, input, Notice } from '../ui';

interface Status {
  enabled: boolean;
  recoveryCodesLeft: number;
  available: boolean;
}

/** Two-step sign-in with an authenticator app. Optional; the user's own setup. */
export function Security() {
  const t = useT();
  const [st, setSt] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [turningOff, setTurningOff] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSt(await api.get<Status>('/auth/mfa'));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => setSetup(await api.post<{ secret: string; uri: string }>('/auth/mfa/setup')));
  const enable = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const r = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code });
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      await load();
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api.post('/auth/mfa/disable', { password });
      setTurningOff(false);
      setPassword('');
      await load();
    });
  };

  return (
    <div className="mx-auto mt-8 max-w-lg space-y-4">
      <Card title={t('Two-step sign-in')}>
        <div className="space-y-3 text-sm">
          <p>
            {t(
              'After your password, you enter a six-digit code from an authenticator app on your phone. It protects your account if your password is stolen.',
            )}
          </p>
          {error && <Notice kind="error">{error}</Notice>}
          {!st ? (
            <p className="text-ink-3">{t('Loading…')}</p>
          ) : !st.available ? (
            <Notice kind="info">
              {t('Your organisation signs you in elsewhere, so two-step sign-in is managed there.')}
            </Notice>
          ) : codes ? (
            <div className="space-y-2">
              <Notice kind="ok">{t('Two-step sign-in is on.')}</Notice>
              <p>
                {t(
                  'Save these recovery codes somewhere safe. Each works once if you lose your phone. They are shown only now.',
                )}
              </p>
              <ul
                className="grid grid-cols-2 gap-1 font-mono text-sm"
                aria-label={t('Recovery codes')}
              >
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <button className={btnSecondary} onClick={() => setCodes(null)}>
                {t('I have saved them')}
              </button>
            </div>
          ) : st.enabled ? (
            <div className="space-y-2">
              <Notice kind="ok">
                {t('Two-step sign-in is on. Recovery codes left: {n}', { n: st.recoveryCodesLeft })}
              </Notice>
              {turningOff ? (
                <form onSubmit={disable} className="space-y-2">
                  <Field label={t('Your password')}>
                    <input
                      className={input}
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                  <button className={btnDanger} disabled={busy}>
                    {t('Turn off two-step sign-in')}
                  </button>
                </form>
              ) : (
                <button className={btnSecondary} onClick={() => setTurningOff(true)}>
                  {t('Turn off')}
                </button>
              )}
            </div>
          ) : setup ? (
            <form onSubmit={enable} className="space-y-3">
              <p>
                {t(
                  'In your authenticator app, add an account and enter this key (or open the link on your phone):',
                )}
              </p>
              <p
                className="break-all rounded border bg-page p-2 font-mono text-sm"
                data-testid="mfa-secret"
              >
                {setup.secret}
              </p>
              <a className="text-link hover:underline" href={setup.uri}>
                {t('Open in authenticator app')}
              </a>
              <Field label={t('Code shown in the app')}>
                <input
                  className={input}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <button className={btnPrimary} disabled={busy}>
                {t('Turn on')}
              </button>
            </form>
          ) : (
            <button className={btnPrimary} onClick={() => void start()} disabled={busy}>
              {t('Set up two-step sign-in')}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
