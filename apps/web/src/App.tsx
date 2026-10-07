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
import { Appearance, LanguageSwitch } from './Appearance';
import { applyLang, tr, useT, type Lang } from './i18n';
import { AiSettings, AssistantSettings, Users } from './pages/Admin';
import { rememberUser } from './assistant';
import { Candidate } from './pages/Candidate';
import { Home } from './pages/Home';
import { Monitoring } from './pages/Monitoring';
import { ChangePassword, Login, SetPassword } from './pages/Login';
import { Brand, BRAND_FULL } from './brand';
import { Retention } from './pages/Retention';
import { Security } from './pages/Security';
import { SharedList, SharedReport } from './pages/SharedReport';
import { Vacancies } from './pages/Vacancies';
import { Vacancy, type Tab } from './pages/Vacancy';
import { useRoute } from './route';
import { setFocus } from './focus';
import { applyBackground, isBackground } from './theme';
import { Notice } from './ui';

const IDLE_MS = 30 * 60 * 1000; // IAM-06: idle sign-out
const REFRESH_MS = 20 * 60 * 1000;

const HEALTH_LABEL: Record<ApiHealth['state'], string> = {
  checking: 'Checking service…',
  up: 'Service ready',
  down: 'Service unavailable',
};
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'az';

function AdminNav({ route }: { route: string }) {
  const t = useT();
  const tabs: [string, string][] = [
    ['/admin', 'Users'],
    ['/admin/ai', 'AI models'],
    ['/admin/assistant', 'Assistant'],
    ['/admin/monitoring', 'Monitoring'],
    ['/admin/retention', 'Data retention'],
  ];
  return (
    <nav className="flex flex-wrap gap-2 text-sm" aria-label={t('Administration')}>
      {tabs.map(([href, label]) => (
        <a
          key={href}
          className={`rounded px-3 py-1.5 ${route === href ? 'bg-accent text-on-accent' : 'bg-card border'}`}
          href={`#${href}`}
        >
          {t(label)}
        </a>
      ))}
    </nav>
  );
}

export function App({ check = fetchReadiness }: { check?: () => Promise<ApiHealth> }) {
  const t = useT();
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
      const m = await api.get<Me>('/me');
      setMe(m);
      rememberUser(m.userId);
      applyBackground(isBackground(m.background) ? m.background : null);
      setFocus(m.focusOnSkills === true);
      // A saved language follows the person across devices; none saved follows the browser.
      if (isLang(m.language)) applyLang(m.language);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401) session.set(null);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    void check().then(setHealth);
    return subscribeUnauthorized(() => signOut(tr('Your session ended. Please sign in again.')));
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
        return signOut(tr('You were signed out after 30 minutes of inactivity.'));
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
  const isGov = !!me?.roles.includes('GOVERNANCE');

  // An invitation link works for anyone, signed in or not.
  const setupToken = /^\/set-password\?token=([\w-]{20,200})$/.exec(route)?.[1];

  let body;
  if (setupToken) {
    body = (
      <SetPassword
        token={setupToken}
        onDone={() => {
          window.location.hash = '/';
          setNote('');
          void loadMe();
        }}
      />
    );
  } else if (booting) body = <p className="text-sm text-ink-3">{t('Loading…')}</p>;
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
  else if (route === '/security') body = <Security />;
  else if (/^\/reports\/[0-9A-Z]{26}$/.test(route))
    body = <SharedReport id={route.split('/')[2]!} key={route} />;
  else if (route === '/reports') body = <SharedList />;
  else if (route === '/admin/monitoring' && (isAdmin || isGov))
    body = isAdmin ? (
      <div className="space-y-4">
        <AdminNav route={route} />
        <Monitoring canRun />
      </div>
    ) : (
      <Monitoring canRun={false} />
    );
  else if (route.startsWith('/admin')) {
    body = isAdmin ? (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{t('Administration')}</h1>
        <AdminNav route={route} />
        {route === '/admin/ai' ? (
          <AiSettings />
        ) : route === '/admin/assistant' ? (
          <AssistantSettings />
        ) : route === '/admin/retention' ? (
          <Retention />
        ) : (
          <Users meId={me.userId} />
        )}
      </div>
    ) : (
      <Notice kind="error">{t('Administrators only.')}</Notice>
    );
  } else if (!isTa && isGov && !isAdmin) {
    // Governance reviews the fairness figures and the audit trail; it does not see candidates.
    body = <Monitoring canRun={false} />;
  } else if (!isTa && !me.roles.length) {
    // An account with no role can open the reports shared with it, and nothing else (spec 6.5).
    body = <SharedList />;
  } else if (!isTa && isAdmin) {
    body = (
      <Notice kind="info">
        {t(
          'Administrators manage users and AI models under Admin. Candidate data is available only to recruiters.',
        )}
      </Notice>
    );
  } else {
    const vm = /^\/vacancies\/([0-9A-Z]{26})(?:\/(results|report|candidates|criteria))?$/.exec(
      route,
    );
    const sm = /^\/screenings\/([0-9A-Z]{26})$/.exec(route);
    body = vm ? (
      <Vacancy id={vm[1]!} key={vm[1]} initialTab={(vm[2] as Tab | undefined) ?? 'results'} />
    ) : sm ? (
      <Candidate id={sm[1]!} key={sm[1]} />
    ) : isTa && route !== '/vacancies' ? (
      <Home />
    ) : (
      <Vacancies canCreate={isTa} />
    );
  }

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <a href="#/" className="rounded focus-visible:outline-2" title={BRAND_FULL}>
            <Brand />
          </a>
          {!me && <LanguageSwitch signedIn={false} />}
          {me && !me.mustChangePassword && (
            <nav className="flex flex-wrap items-center gap-4 text-sm" aria-label={t('Main')}>
              {isTa && (
                <>
                  <a href="#/" className="hover:underline">
                    {t('New screening')}
                  </a>
                  <a href="#/vacancies" className="hover:underline">
                    {t('Past scans')}
                  </a>
                </>
              )}
              <a href="#/reports" className="hover:underline">
                {t('Shared with me')}
              </a>
              {isGov && !isAdmin && (
                <a href="#/admin/monitoring" className="hover:underline">
                  {t('Monitoring')}
                </a>
              )}
              {isAdmin && (
                <a href="#/admin" className="hover:underline">
                  {t('Admin')}
                </a>
              )}
              <LanguageSwitch signedIn />
              <Appearance
                value={isBackground(me.background) ? me.background : null}
                onChange={(background) => setMe((m) => (m ? { ...m, background } : m))}
                focusOnSkills={me.focusOnSkills === true}
                onFocusChange={(focusOnSkills) => {
                  setFocus(focusOnSkills);
                  setMe((m) => (m ? { ...m, focusOnSkills } : m));
                }}
              />
              <a href="#/password" className="hover:underline">
                {t('Password')}
              </a>
              <a href="#/security" className="hover:underline">
                {t('Security')}
              </a>
              <span className="text-ink-2">{me.displayName ?? me.email}</span>
              <button className="text-link hover:underline" onClick={() => signOut()}>
                {t('Sign out')}
              </button>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{body}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-ink-3">
        <p>
          {t(
            'AI-assisted screening: scores and rankings are recommendations. Every decision about a candidate is made by a person and recorded under their name.',
          )}
        </p>
        <p role="status" aria-live="polite" className="mt-1">
          {t(HEALTH_LABEL[health.state])}
        </p>
      </footer>
    </div>
  );
}
