import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  fetchReadiness,
  session,
  subscribeUnauthorized,
  type ApiHealth,
  type Me,
  type Session,
} from './api';
import { AiSettings, Users } from './pages/Admin';
import { Candidate } from './pages/Candidate';
import { ChangePassword, Login } from './pages/Login';
import { Vacancies } from './pages/Vacancies';
import { Vacancy } from './pages/Vacancy';
import { useRoute } from './route';
import { Notice } from './ui';

const IDLE_MS = 30 * 60 * 1000; // IAM-06: idle sign-out
const REFRESH_MS = 20 * 60 * 1000;

const HEALTH_LABEL: Record<ApiHealth['state'], string> = {
  checking: 'Checking service…',
  up: 'Service ready',
  down: 'Service unavailable',
};

export function App({ check = fetchReadiness }: { check?: () => Promise<ApiHealth> }) {
  const [me, setMe] = useState<Me | null>(null);
  const [booting, setBooting] = useState(true);
  const [health, setHealth] = useState<ApiHealth>({ state: 'checking' });
  const [note, setNote] = useState('');
  const route = useRoute();
  const lastActive = useRef(0);

  const signOut = useCallback((why = '') => {
    session.set(null);
    setMe(null);
    setNote(why);
  }, []);

  const loadMe = useCallback(async () => {
    if (!session.get()) return setBooting(false);
    try {
      setMe(await api.get<Me>('/me'));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401) session.set(null);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    void check().then(setHealth);
    return subscribeUnauthorized(() => signOut('Your session ended. Please sign in again.'));
  }, [check, loadMe, signOut]);

  // Idle sign-out and keep-alive while the user is active.
  useEffect(() => {
    if (!me) return;
    const touch = () => (lastActive.current = Date.now());
    touch();
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach((e) => window.addEventListener(e, touch));
    const t = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_MS)
        return signOut('You were signed out after 30 minutes of inactivity.');
      void api.post<Session>('/auth/refresh').then(
        (s) => session.set(s.token),
        () => undefined,
      );
    }, REFRESH_MS);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(t);
    };
  }, [me, signOut]);

  const isTa = !!me?.roles.some((r) => r === 'TA_PARTNER' || r === 'TA_LEAD');
  const isAdmin = !!me?.roles.includes('ADMIN');

  let body;
  if (booting) body = <p className="text-sm text-slate-500">Loading…</p>;
  else if (!me) {
    body = (
      <>
        {note && (
          <div className="mx-auto mt-6 max-w-sm">
            <Notice kind="info">{note}</Notice>
          </div>
        )}
        <Login onSignedIn={() => (setNote(''), void loadMe())} />
      </>
    );
  } else if (me.mustChangePassword) body = <ChangePassword forced onDone={() => void loadMe()} />;
  else if (route === '/password')
    body = (
      <ChangePassword
        forced={false}
        onDone={() => {
          window.location.hash = '/';
          void loadMe();
        }}
      />
    );
  else if (route.startsWith('/admin')) {
    body = isAdmin ? (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Administration</h1>
        <nav className="flex gap-2 text-sm">
          <a
            className={`rounded px-3 py-1.5 ${route === '/admin' ? 'bg-sky-700 text-white' : 'bg-white border'}`}
            href="#/admin"
          >
            Users
          </a>
          <a
            className={`rounded px-3 py-1.5 ${route === '/admin/ai' ? 'bg-sky-700 text-white' : 'bg-white border'}`}
            href="#/admin/ai"
          >
            AI models
          </a>
        </nav>
        {route === '/admin/ai' ? <AiSettings /> : <Users meId={me.userId} />}
      </div>
    ) : (
      <Notice kind="error">Administrators only.</Notice>
    );
  } else if (!isTa && !me.roles.length) {
    body = (
      <Notice kind="warn">
        Your account has no access yet. Ask an administrator to assign you a role.
      </Notice>
    );
  } else if (!isTa && isAdmin) {
    body = (
      <Notice kind="info">
        Administrators manage users and AI models under Admin. Candidate data is available only to
        recruiters.
      </Notice>
    );
  } else {
    const vm = /^\/vacancies\/([0-9A-Z]{26})$/.exec(route);
    const sm = /^\/screenings\/([0-9A-Z]{26})$/.exec(route);
    body = vm ? (
      <Vacancy id={vm[1]!} key={vm[1]} />
    ) : sm ? (
      <Candidate id={sm[1]!} key={sm[1]} />
    ) : (
      <Vacancies canCreate={isTa} />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <a href="#/" className="font-semibold text-sky-800">
            Azerconnect CV Screening
          </a>
          {me && !me.mustChangePassword && (
            <nav className="flex flex-wrap items-center gap-4 text-sm" aria-label="Main">
              {isTa && (
                <a href="#/vacancies" className="hover:underline">
                  Vacancies
                </a>
              )}
              {isAdmin && (
                <a href="#/admin" className="hover:underline">
                  Admin
                </a>
              )}
              <a href="#/password" className="hover:underline">
                Password
              </a>
              <span className="text-slate-500">{me.displayName ?? me.email}</span>
              <button className="text-sky-800 hover:underline" onClick={() => signOut()}>
                Sign out
              </button>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{body}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500">
        <p>
          AI-assisted screening: scores and rankings are recommendations. Every decision about a
          candidate is made by a person and recorded under their name.
        </p>
        <p role="status" aria-live="polite" className="mt-1">
          {HEALTH_LABEL[health.state]}
        </p>
      </footer>
    </div>
  );
}
