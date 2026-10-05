import { useState, type FormEvent } from 'react';
import { api, session, type Session } from '../api';
import { btnPrimary, Card, errMsg, Field, input, Notice } from '../ui';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const s = await api.post<Session>('/auth/login', { email, password });
      session.set(s.token);
      onSignedIn();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <Card title="Sign in">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email">
            <input
              className={input}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              className={input}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <Notice kind="error">{error}</Notice>}
          <button className={`${btnPrimary} w-full`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-xs text-slate-500">
            Accounts are created by your administrator, who emails you a temporary password.
          </p>
        </form>
      </Card>
    </div>
  );
}

export function ChangePassword({ forced, onDone }: { forced: boolean; onDone: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) return setError('The new passwords do not match');
    setBusy(true);
    setError('');
    try {
      const s = await api.post<Session>('/auth/change-password', {
        currentPassword: cur,
        newPassword: next,
      });
      session.set(s.token);
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-sm">
      <Card title={forced ? 'Choose your own password' : 'Change password'}>
        {forced && (
          <div className="mb-3">
            <Notice kind="info">
              Your temporary password must be replaced before you continue.
            </Notice>
          </div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <Field label={forced ? 'Temporary password (from your email)' : 'Current password'}>
            <input
              className={input}
              type="password"
              autoComplete="current-password"
              required
              value={cur}
              onChange={(e) => setCur(e.target.value)}
            />
          </Field>
          <Field label="New password" hint="At least 12 characters. A short sentence works well.">
            <input
              className={input}
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="Repeat new password">
            <input
              className={input}
              type="password"
              autoComplete="new-password"
              required
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </Field>
          {error && <Notice kind="error">{error}</Notice>}
          <button className={`${btnPrimary} w-full`} disabled={busy}>
            Save password
          </button>
        </form>
      </Card>
    </div>
  );
}
