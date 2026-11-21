import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { IMPORT_WAIT_MESSAGE, IMPORT_WAIT_UNKNOWN, importErrorMessage } from '@cv/shared';
import { useT } from '../i18n';
import { trServer } from '../i18n/server';
import {
  ACTIVATE_CODES,
  oracleAdmin,
  type ActivateAnswer,
  type ActivateCode,
  type AdminRun,
  type AdminView,
} from '../oracle';
import { btnPrimary, btnSecondary, Card, errMsg, Field, input, Notice, when } from '../ui';

/** The five result lines (drawing 3): the code decides the line, `enabled` decides the state word. */
const RESULT: Record<ActivateCode, { text: string; kind: 'ok' | 'warn' | 'error' }> = {
  ok: { text: 'Active. Signed in to Oracle, and the account can see vacancies.', kind: 'ok' },
  auth_failed: {
    text: 'Sign-in failed. Oracle did not accept this user name and password.',
    kind: 'error',
  },
  empty_scope: {
    text: 'Connected, but this account sees no vacancies. Ask the Oracle team to give it access to Recruiting, then try again.',
    kind: 'warn',
  },
  unreachable: { text: 'The address could not be reached. Check it and try again.', kind: 'error' },
  not_oracle_address: { text: '', kind: 'error' },
};

const daysUntil = (date: string) =>
  Math.ceil((new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86_400_000);

/**
 * Stage 3, S3-INT-14a (A1-A15): the one Oracle card for administrators. Before activation: three
 * fields, one tick-box, one button. After: the state, three buttons (Test again, Replace password,
 * Turn off), and Advanced, closed. The password goes in and never comes back.
 */
export function OracleSettings() {
  const t = useT();
  const [view, setView] = useState<AdminView | null | undefined>(undefined);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setView(await oracleAdmin.get());
      setError('');
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (view === undefined) return error ? <Notice kind="error">{error}</Notice> : null;
  if (view === null)
    return (
      <Card title={t('Oracle import')}>
        <p className="text-sm">{t('Oracle import is not available in this environment.')}</p>
      </Card>
    );
  return (
    <div className="space-y-4">
      <ConnectionCard view={view} reload={load} />
      {view.connection && <Runs />}
    </div>
  );
}

function ResultLine({ answer, id }: { answer: ActivateAnswer; id: string }) {
  const t = useT();
  const r = RESULT[answer.code];
  const text = answer.code === 'not_oracle_address' ? trServer(answer.message ?? '') : t(r.text);
  return (
    <Notice kind={r.kind}>
      <span id={id}>{text}</span>
    </Notice>
  );
}

function ConnectionCard({ view, reload }: { view: AdminView; reload: () => Promise<void> }) {
  const t = useT();
  const c = view.connection;
  const active = !!c?.enabled;
  const [address, setAddress] = useState(c?.address ?? '');
  const [user, setUser] = useState(c?.user ?? '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [notice, setNotice] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActivateAnswer | null>(null);
  const [error, setError] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [offAsk, setOffAsk] = useState(false);
  const [offDone, setOffDone] = useState(false);
  const [testError, setTestError] = useState('');
  const resultId = useId();
  const addrRef = useRef<HTMLInputElement>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);
  const offCancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (offAsk) offCancelRef.current?.focus();
  }, [offAsk]);

  const keepPassword = !!c?.passwordSaved && address === c.address && user === c.user;
  const noticeKept = !!c?.notice && keepPassword;

  async function activate() {
    if (busy) return;
    const need: [string, React.RefObject<HTMLInputElement | null>][] = [];
    if (!address.trim()) need.push(['Paste the Oracle API address.', addrRef]);
    if (!user.trim()) need.push(['Type the user name.', userRef]);
    if (!password && !keepPassword) need.push(['Type the password.', pwRef]);
    if (!notice && !noticeKept)
      need.push(['Tick the box to confirm that applicants are told.', boxRef]);
    setMissing(need.map(([m]) => m));
    setResult(null);
    setError('');
    if (need.length) {
      need[0]![1].current?.focus();
      return;
    }
    setBusy(true);
    try {
      const a = await oracleAdmin.activate({
        address,
        user,
        ...(password ? { password } : {}),
        ...(notice ? { notice: true } : {}),
      });
      setPassword('');
      if (!ACTIVATE_CODES.includes(a.code)) throw new Error(t('Something went wrong'));
      setResult(a);
      if (a.code === 'auth_failed') userRef.current?.focus();
      if (a.code === 'unreachable' || a.code === 'not_oracle_address') addrRef.current?.focus();
      if (a.enabled) await reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    if (busy) return;
    if (!password) {
      setMissing(['Type the password.']);
      pwRef.current?.focus();
      return;
    }
    setBusy(true);
    setMissing([]);
    try {
      const a = await oracleAdmin.activate({ password });
      setPassword('');
      setResult(a);
      if (a.code === 'ok') {
        setReplacing(false);
        await reload();
        replaceRef.current?.focus();
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function testAgain() {
    if (busy) return;
    setBusy(true);
    setTestError('');
    try {
      const a = await oracleAdmin.test();
      setResult(a);
      // Test again can switch the integration off (auth_failed), never on (A15).
      await reload();
    } catch (e) {
      setTestError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await oracleAdmin.deactivate();
      setOffAsk(false);
      setOffDone(true);
      setResult(null);
      await reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const stateWord = active ? t('Active') : c ? t('Off') : t('Not connected');
  const invalidUser = result?.code === 'auth_failed';
  const invalidAddress = result?.code === 'unreachable' || result?.code === 'not_oracle_address';
  const expiry = c?.passwordExpiresOn ? daysUntil(c.passwordExpiresOn) : null;

  return (
    <Card
      title={t('Oracle import')}
      actions={<span className="rounded-full bg-sel px-2 py-0.5 text-xs">{stateWord}</span>}
    >
      <div className="space-y-3 text-sm">
        {expiry !== null && expiry <= 14 && (
          <Notice kind={expiry <= 0 ? 'error' : 'warn'}>
            {expiry <= 0
              ? t('The Oracle password expired on {date}. Replace it now.', {
                  date: c!.passwordExpiresOn!,
                })
              : t('The Oracle password expires on {date}. Replace it before then.', {
                  date: c!.passwordExpiresOn!,
                })}
          </Notice>
        )}
        {offDone && !active && (
          <Notice kind="ok">{t('Turned off. Recruiters no longer see the Oracle field.')}</Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        {active && c ? (
          <>
            <p>
              {c.enabledAt && t('Active since {when}', { when: when(c.enabledAt) })}
              {c.lastTestAt && (
                <>
                  {' · '}
                  {c.lastTestCode === 'ok'
                    ? t('Last check OK, {when}', { when: when(c.lastTestAt) })
                    : t('Last check failed, {when}. New imports wait until this is fixed.', {
                        when: when(c.lastTestAt),
                      })}
                </>
              )}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-ink-3">{t('Address')}</dt>
              <dd className="break-all">{c.address}</dd>
              <dt className="text-ink-3">{t('User name')}</dt>
              <dd>
                {c.user}
                {c.passwordSetAt && (
                  <span className="text-ink-3">
                    {' '}
                    · {t('password saved {when}', { when: when(c.passwordSetAt) })}
                  </span>
                )}
              </dd>
              <dt className="text-ink-3">{t('Notice')}</dt>
              <dd>
                {c.notice
                  ? c.notice.effectiveFrom
                    ? t('confirmed by {name}, {when} · covers applications from {date}', {
                        name: c.notice.by ?? '',
                        when: when(c.notice.at),
                        date: c.notice.effectiveFrom,
                      })
                    : t('confirmed by {name}, {when} · covers every application', {
                        name: c.notice.by ?? '',
                        when: when(c.notice.at),
                      })
                  : ''}
              </dd>
            </dl>
            {replacing ? (
              <div className="space-y-2">
                <Field
                  label={t('New password')}
                  hint={t(
                    'The new password is tested first. The saved one stays in use unless the test passes.',
                  )}
                >
                  <input
                    ref={pwRef}
                    type="password"
                    autoComplete="new-password"
                    className={input}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={busy}
                    onClick={() => void replace()}
                  >
                    {t('Save and test')}
                  </button>
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={() => {
                      setReplacing(false);
                      setPassword('');
                      replaceRef.current?.focus();
                    }}
                  >
                    {t('Cancel')}
                  </button>
                </div>
              </div>
            ) : offAsk ? (
              <div className="flex flex-wrap items-center gap-2" role="group">
                <span>
                  {t(
                    'Turn off the Oracle import? Imports that are running are cancelled. CVs already imported stay.',
                  )}
                </span>
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={busy}
                  onClick={() => void turnOff()}
                >
                  {t('Turn off')}
                </button>
                <button
                  ref={offCancelRef}
                  type="button"
                  className={btnSecondary}
                  onClick={() => setOffAsk(false)}
                >
                  {t('Cancel')}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={busy}
                  onClick={() => void testAgain()}
                >
                  {busy ? t('Testing…') : t('Test again')}
                </button>
                <button
                  ref={replaceRef}
                  type="button"
                  className={btnSecondary}
                  onClick={() => setReplacing(true)}
                >
                  {t('Replace password')}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setOffAsk(true)}>
                  {t('Turn off')}
                </button>
              </div>
            )}
            {testError && <p className="text-err-ink">{testError}</p>}
          </>
        ) : (
          <>
            <p>
              {t(
                'Connect once. Recruiters can then bring the CVs of an Oracle vacancy into a vacancy here.',
              )}
            </p>
            <Field
              label={t('Oracle API address')}
              hint={`${t('Paste the address of your Oracle site. A full link is fine: only the address is kept.')} ${t('Example: {example}', { example: view.example })}`}
            >
              <input
                ref={addrRef}
                className={input}
                value={address}
                inputMode="url"
                aria-invalid={invalidAddress || undefined}
                aria-describedby={invalidAddress ? resultId : undefined}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <Field
              label={t('User name')}
              hint={t(
                'The Oracle account made for this connection. The password is encrypted on the server and never shown again.',
              )}
            >
              <input
                ref={userRef}
                className={input}
                value={user}
                autoComplete="off"
                aria-invalid={invalidUser || undefined}
                aria-describedby={invalidUser ? resultId : undefined}
                onChange={(e) => setUser(e.target.value)}
              />
            </Field>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label={t('Password')}
                  hint={
                    keepPassword ? t('A password is saved. Leave empty to keep it.') : undefined
                  }
                >
                  <input
                    ref={pwRef}
                    type={showPw ? 'text' : 'password'}
                    className={input}
                    value={password}
                    autoComplete="new-password"
                    aria-invalid={invalidUser || undefined}
                    aria-describedby={invalidUser ? resultId : undefined}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              </div>
              <button type="button" className={btnSecondary} onClick={() => setShowPw((v) => !v)}>
                {showPw ? t('Hide') : t('Show')}
              </button>
            </div>
            <label className="flex items-start gap-2">
              <input
                ref={boxRef}
                type="checkbox"
                className="mt-1"
                checked={notice}
                onChange={(e) => setNotice(e.target.checked)}
              />
              <span>
                {t('Applicants on our Oracle career site are told that AI assists screening.')}
              </span>
            </label>
            {missing.length > 0 && (
              <ul className="list-disc pl-5 text-err-ink" role="alert">
                {missing.map((m) => (
                  <li key={m}>{t(m)}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className={btnPrimary}
              disabled={busy}
              onClick={() => void activate()}
            >
              {busy ? t('Activating…') : t('Activate')}
            </button>
          </>
        )}
        {replacing && missing.length > 0 && (
          <p role="alert" className="text-err-ink">
            {t(missing[0]!)}
          </p>
        )}
        {result && <ResultLine answer={result} id={resultId} />}
        <Advanced view={view} reload={reload} />
      </div>
    </Card>
  );
}

/** Advanced (A14): closed on every load, its own Save, no new Activate. */
function Advanced({ view, reload }: { view: AdminView; reload: () => Promise<void> }) {
  const t = useT();
  const s = view.settings;
  const c = view.connection;
  const [oauth, setOauth] = useState(c?.authMode === 'oauth_client_credentials');
  const [tokenUrl, setTokenUrl] = useState(c?.tokenUrl ?? '');
  const [clientId, setClientId] = useState(s.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [categories, setCategories] = useState(s.categories.join(', '));
  const [lead, setLead] = useState(s.linkPolicy === 'lead_approval');
  const [eu, setEu] = useState(s.requireEuAi);
  const [gone, setGone] = useState(s.goneInSource);
  const [expires, setExpires] = useState(c?.passwordExpiresOn ?? '');
  const [noticeFrom, setNoticeFrom] = useState(c?.notice?.effectiveFrom ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const euHint = useId();
  if (!c) return null;
  const save = async () => {
    setSaved(false);
    setError('');
    try {
      await oracleAdmin.settings({
        authMode: oauth ? 'oauth_client_credentials' : 'basic',
        tokenUrl: oauth ? tokenUrl || null : null,
        clientId: clientId || null,
        ...(clientSecret ? { clientSecret } : {}),
        categories: categories
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        linkPolicy: lead ? 'lead_approval' : 'open',
        requireEuAi: eu,
        goneInSource: gone,
        passwordExpiresOn: expires || null,
        noticeEffectiveFrom: noticeFrom || null,
      });
      setClientSecret('');
      setSaved(true);
      await reload();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <details className="rounded-xl border border-line p-3">
      <summary className="cursor-pointer font-medium">{t('Advanced')}</summary>
      <div className="mt-3 space-y-3">
        <h3 className="font-semibold">{t('Optional settings')}</h3>
        <fieldset className="space-y-1">
          <legend className="font-medium">{t('Sign-in method')}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="oracle-signin"
              checked={!oauth}
              onChange={() => setOauth(false)}
            />
            {t('User name and password')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="oracle-signin"
              checked={oauth}
              onChange={() => setOauth(true)}
            />
            {t('OAuth (client ID and secret)')}
          </label>
        </fieldset>
        {oauth && (
          <>
            <Field label={t('Token address')}>
              <input
                className={input}
                value={tokenUrl}
                onChange={(e) => setTokenUrl(e.target.value)}
              />
            </Field>
            <Field label={t('Client ID')}>
              <input
                className={input}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </Field>
            <Field label={t('Client secret')}>
              <input
                type="password"
                autoComplete="new-password"
                className={input}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </Field>
          </>
        )}
        <Field label={t('Oracle file categories that count as a CV (separate with commas)')}>
          <input
            className={input}
            value={categories}
            onChange={(e) => setCategories(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} />
          {t('A team lead approves each link')}
        </label>
        <div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={eu}
              aria-describedby={euHint}
              onChange={(e) => setEu(e.target.checked)}
            />
            {t('Only use an AI company that processes in the EU')}
          </label>
          <p id={euHint} className="text-xs text-ink-3">
            {t('The data protection officer (DPO) decides this. Every change is recorded.')}
          </p>
        </div>
        <fieldset className="space-y-1">
          <legend className="font-medium">{t('When an applicant is gone from Oracle')}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="oracle-gone"
              checked={gone === 'flag'}
              onChange={() => setGone('flag')}
            />
            {t('Flag for review')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="oracle-gone"
              checked={gone === 'erase'}
              onChange={() => setGone('erase')}
            />
            {t('Erase the CV here')}
          </label>
        </fieldset>
        <Field
          label={t('Password expires on')}
          hint={t('Optional. A reminder shows on this card from 14 days before that date.')}
        >
          <input
            type="date"
            className={input}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </Field>
        <Field label={t('Notice')}>
          <input
            type="date"
            className={input}
            value={noticeFrom}
            onChange={(e) => setNoticeFrom(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-2">
          <button type="button" className={btnSecondary} onClick={() => void save()}>
            {t('Save')}
          </button>
          {saved && <span role="status">{t('Saved.')}</span>}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </details>
  );
}

/** S3-OPS-05 part b: the run list with Abandon. Counts and states only. */
function Runs() {
  const t = useT();
  const [runs, setRuns] = useState<AdminRun[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    oracleAdmin.runs().then(
      (r) => setRuns(r.runs),
      (e) => setError(errMsg(e)),
    );
  }, []);
  useEffect(load, [load]);
  const STATE: Record<string, string> = {
    queued: 'Queued',
    running: 'Running',
    awaiting_confirm: 'Waiting for the recruiter',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  if (!runs) return error ? <Notice kind="error">{error}</Notice> : null;
  return (
    <Card title={t('Imports')}>
      {error && <Notice kind="error">{error}</Notice>}
      {runs.length === 0 ? (
        <p className="text-sm">{t('No imports yet.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-ink-3">
                <th className="py-1 pr-3">{t('Vacancy')}</th>
                <th className="py-1 pr-3">{t('Started by')}</th>
                <th className="py-1 pr-3">{t('State')}</th>
                <th className="py-1 pr-3">{t('Step')}</th>
                <th className="py-1 pr-3">{t('Counts')}</th>
                <th className="py-1 pr-3">{t('Started')}</th>
                <th className="py-1 pr-3">{t('Reason')}</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const active = ['queued', 'running', 'awaiting_confirm'].includes(r.state);
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="py-1 pr-3">{r.vacancyTitle}</td>
                    <td className="py-1 pr-3">{r.startedBy}</td>
                    <td className="py-1 pr-3">
                      {t(STATE[r.state] ?? r.state)}
                      {r.stalled && r.stalledMinutes !== null && (
                        <span className="block text-err-ink">
                          {t('No progress for {n} minutes', { n: r.stalledMinutes })}
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-3">
                      {active
                        ? r.phase === 'listing'
                          ? t('Reading the list')
                          : t('Fetching CVs')
                        : ''}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      {t('{listed} listed · {fetched} fetched', {
                        listed: r.listed,
                        fetched: r.fetched,
                      })}
                    </td>
                    <td className="py-1 pr-3">{when(r.createdAt)}</td>
                    <td className="py-1 pr-3">
                      {r.errorCode
                        ? t(importErrorMessage(r.errorCode))
                        : r.waitReason
                          ? t(IMPORT_WAIT_MESSAGE[r.waitReason] ?? IMPORT_WAIT_UNKNOWN)
                          : ''}
                    </td>
                    <td className="py-1">
                      {active &&
                        (asking === r.id ? (
                          <span className="flex flex-wrap items-center gap-2" role="group">
                            <span>
                              {t(
                                'Abandon this import? CVs already copied stay. The recruiter can press Refresh to fetch the rest.',
                              )}
                            </span>
                            <button
                              type="button"
                              className={btnSecondary}
                              onClick={() =>
                                void oracleAdmin.abandon(r.id).then(
                                  () => {
                                    setAsking(null);
                                    load();
                                  },
                                  (e) => setError(errMsg(e)),
                                )
                              }
                            >
                              {t('Abandon')}
                            </button>
                            <button
                              type="button"
                              className={btnSecondary}
                              onClick={() => setAsking(null)}
                            >
                              {t('Cancel')}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={btnSecondary}
                            onClick={() => setAsking(r.id)}
                          >
                            {t('Abandon')}
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
