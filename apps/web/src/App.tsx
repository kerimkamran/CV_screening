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
import { LanguageSwitch } from './Appearance';
import { applyLang, tr, useT, type Lang } from './i18n';
import { AiSettings, AssistantSettings, Users } from './pages/Admin';
import { rememberUser } from './assistant';
import { CandidatePool } from './pages/CandidatePool';
import { CandidateReport } from './pages/CandidateReport';
import { Monitoring } from './pages/Monitoring';
import { ChangePassword, Login, SetPassword } from './pages/Login';
import { Brand, BRAND_FULL } from './brand';
import { Retention } from './pages/Retention';
import { Security } from './pages/Security';
import { SharedList, SharedReport } from './pages/SharedReport';
import { VacancyList } from './pages/VacancyList';
import { TABS, VacancyPage, type Tab } from './pages/VacancyPage';
import { Shell } from './Shell';
import { useRoute } from './route';
import { applyBackground, isBackground } from './theme';
import { go } from './route';
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

function Redirect({ to }: { to: string }) {
  useEffect(() => go(to), [to]);
  return null;
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
    const tabs = TABS.join('|');
    const vm = new RegExp(`^/vacancies/([0-9A-Z]{26})(?:/(${tabs}))?$`).exec(route);
    const cm = /^\/candidates\/([0-9A-Z]{26})$/.exec(route);
    const sm = /^\/screenings\/([0-9A-Z]{26})$/.exec(route);
    body = vm ? (
      <VacancyPage id={vm[1]!} key={vm[1]} tab={(vm[2] as Tab | undefined) ?? 'candidates'} />
    ) : route === '/vacancies/new' ? (
      <VacancyPage id="new" tab="candidates" key="new" />
    ) : cm ? (
      <CandidateReport id={cm[1]!} key={cm[1]} canMark={isTa} />
    ) : sm ? (
      <Redirect to={`/candidates/${sm[1]!}`} />
    ) : route === '/candidates' ? (
      <CandidatePool canMark={isTa} />
    ) : (
      <VacancyList canCreate={isTa} />
    );
  }

  const footer = (
    <>
      <p>
        {t(
          'AI-assisted screening: scores and rankings are recommendations. Every decision about a candidate is made by a person and recorded under their name.',
        )}
      </p>
      <p role="status" aria-live="polite" className="mt-1">
        {t(HEALTH_LABEL[health.state])}
      </p>
    </>
  );

  if (me && !me.mustChangePassword && !setupToken)
    return (
      <Shell
        me={me}
        isTa={isTa}
        isAdmin={isAdmin}
        isGov={isGov}
        route={route}
        footer={footer}
        onSignOut={() => signOut()}
        onMe={setMe}
      >
        {body}
      </Shell>
    );

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="bg-brand text-on-brand shadow-[0_2px_14px_-6px_rgb(0_0_0/0.45)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <a
            href="#/"
            className="rounded-lg focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            title={BRAND_FULL}
          >
            <Brand onBrand />
          </a>
          {!me && <LanguageSwitch signedIn={false} />}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{body}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-ink-3">{footer}</footer>
    </div>
  );
}
