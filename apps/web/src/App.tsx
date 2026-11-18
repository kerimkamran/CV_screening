import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  BASE,
  fetchReadiness,
  session,
  subscribeUnauthorized,
  type ApiHealth,
  type Me,
  type Session,
} from './api';
import { LanguageSwitch } from './Appearance';
import { applyLang, tr, useT, type Lang } from './i18n';
import { keepPoolThread, rememberUser, useAssistantConfig } from './assistant';
import { personSignedIn } from './intake';
import { CandidatePool, CvReview, Home } from './pages/lazy';
import { ChangePassword, Login, SetPassword } from './pages/Login';
import { Brand, BRAND_FULL } from './brand';
import { VacancyList } from './pages/VacancyList';
import { TABS, VacancyPage, type Tab } from './pages/VacancyPage';
import { Shell } from './Shell';
import { parseReviewRoute, reviewRoute } from './review';
import { useRoute } from './route';
import { applyBackground, isBackground } from './theme';
import { Notice, SkipLink } from './ui';
import { trackPageTitle } from './title';
import { Boundary, ReloadNote } from './Boundary';

// Screens a recruiter does not open first load on demand, so the first page carries less script
// (PF-07). A file that is gone after a new deployment shows a reload note instead of a blank page.
const AiSettings = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AiSettings })));
const AssistantReview = lazy(() =>
  import('./pages/Admin').then((m) => ({ default: m.AssistantReview })),
);
const AssistantSettings = lazy(() =>
  import('./pages/Admin').then((m) => ({ default: m.AssistantSettings })),
);
const Users = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Users })));
const Monitoring = lazy(() =>
  import('./pages/Monitoring').then((m) => ({ default: m.Monitoring })),
);
const Retention = lazy(() => import('./pages/Retention').then((m) => ({ default: m.Retention })));
const Security = lazy(() => import('./pages/Security').then((m) => ({ default: m.Security })));
const SharedList = lazy(() =>
  import('./pages/SharedReport').then((m) => ({ default: m.SharedList })),
);
const SharedReport = lazy(() =>
  import('./pages/SharedReport').then((m) => ({ default: m.SharedReport })),
);

const REFRESH_MS = 20 * 60 * 1000;
const HEALTH_MS = 30_000;

const HEALTH_LABEL: Record<ApiHealth['state'], string> = {
  checking: 'Checking service…',
  up: 'Service ready',
  down: 'Service unavailable',
};
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'az';

function AdminNav({ route }: { route: string }) {
  const t = useT();
  // The assistant's tab carries its name (the product name until it is renamed), like its panels do.
  const assistantName = useAssistantConfig()?.name ?? 'SenAI';
  const tabs: [string, string][] = [
    ['/admin', 'Users'],
    ['/admin/ai', 'AI models'],
    ['/admin/assistant', '{name}'],
    ['/admin/monitoring', 'Fairness monitoring'],
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
          {t(label, { name: assistantName })}
        </a>
      ))}
    </nav>
  );
}

/**
 * Old links (#/candidates/<screening> and #/screenings/<screening>) still work: the screening says
 * which CV it belongs to, and the person lands on that CV's review page (Stage 2, S2-FE2).
 */
function LegacyCv({ screeningId }: { screeningId: string }) {
  const t = useT();
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let dead = false;
    api.get<{ documentId: string }>(`/screenings/${screeningId}`).then(
      (s) => !dead && window.location.replace(`#${reviewRoute(s.documentId)}`),
      () => !dead && setGone(true),
    );
    return () => {
      dead = true;
    };
  }, [screeningId]);
  return gone ? (
    <Notice kind="error">{t('This CV is not available to you, or it no longer exists.')}</Notice>
  ) : (
    <p className="text-sm text-ink-3">{t('Loading…')}</p>
  );
}

export function App({ check = fetchReadiness }: { check?: () => Promise<ApiHealth> }) {
  const t = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [booting, setBooting] = useState(true);
  const [health, setHealth] = useState<ApiHealth>({ state: 'checking' });
  const [note, setNote] = useState('');
  const route = useRoute();

  const signOut = useCallback((why = '') => {
    session.set(null);
    keepPoolThread(null);
    setMe(null);
    setNote(why);
  }, []);
  /**
   * Signing out on purpose (SD-51): the server withdraws the token, and this browser forgets the
   * person's background, language and place, so the next person starts clean on #/.
   */
  const leave = useCallback(() => {
    const token = session.get();
    if (token)
      void fetch(`${BASE}/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => undefined);
    signOut();
    applyBackground(null);
    applyLang(null);
    if (window.location.hash && window.location.hash !== '#/') window.location.hash = '/';
  }, [signOut]);

  const loadMe = useCallback(async () => {
    if (!session.get()) return setBooting(false);
    try {
      const m = await api.get<Me>('/me');
      setMe(m);
      rememberUser(m.userId);
      personSignedIn(m.userId);
      applyBackground(isBackground(m.background) ? m.background : null);
      // A saved language follows the person across devices; none saved follows the browser.
      if (isLang(m.language)) applyLang(m.language);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401) session.set(null);
    } finally {
      setBooting(false);
    }
  }, []);

  // Each screen names itself in the browser tab (A11-02).
  useEffect(() => trackPageTitle(), []);
  useEffect(() => {
    void loadMe();
    void check().then(setHealth);
    return subscribeUnauthorized(() => signOut(tr('Your session ended. Please sign in again.')));
  }, [check, loadMe, signOut]);

  // The footer's service line follows the service: checked every 30 s while the tab is in front,
  // so an outage shows within a minute and clears within a minute of recovery (SD-88).
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void check().then(setHealth);
    };
    const id = setInterval(tick, HEALTH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [check]);

  // S2-FE16: the sign-in stays open for as long as the tab is open. There is no idle sign-out; the
  // token is renewed on a timer (and when the tab comes back to the front), never lengthened.
  // Sign out, closing the tab, a disabled account, or a device asleep longer than one token
  // lifetime still end the session (the next call answers 401).
  useEffect(() => {
    if (!me) return;
    let lastRefresh = Date.now();
    const refresh = () => {
      lastRefresh = Date.now();
      void api.post<Session>('/auth/refresh').then(
        (s) => session.set(s.token),
        () => undefined,
      );
    };
    const t = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh > REFRESH_MS)
        refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t);
    };
  }, [me]);

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
  else if (route === '/' && (isTa || isAdmin || isGov))
    // Home: the menu of what this person can do (design, November 2026).
    body = <Home me={me} isTa={isTa} isAdmin={isAdmin} isGov={isGov} />;
  else if (route === '/admin/monitoring' && (isAdmin || isGov))
    body = isAdmin ? (
      <div className="space-y-4">
        <AdminNav route={route} />
        <Monitoring canRun />
      </div>
    ) : (
      <Monitoring canRun={false} />
    );
  else if (route === '/admin/assistant' && isGov && !isAdmin)
    body = (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{t('Administration')}</h1>
        <AssistantReview />
      </div>
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
          'Administrators manage users and AI models under Administration. Candidate data is available only to recruiters.',
        )}
      </Notice>
    );
  } else {
    const tabs = TABS.join('|');
    const vm = new RegExp(`^/vacancies/([0-9A-Z]{26})(?:/(${tabs}))?$`).exec(route);
    const cm = /^\/candidates\/([0-9A-Z]{26})$/.exec(route);
    const sm = /^\/screenings\/([0-9A-Z]{26})$/.exec(route);
    const rv = parseReviewRoute(route);
    body = vm ? (
      <VacancyPage id={vm[1]!} key={vm[1]} tab={(vm[2] as Tab | undefined) ?? 'candidates'} />
    ) : route === '/vacancies/new' ? (
      <VacancyPage id="new" tab="candidates" key="new" />
    ) : rv ? (
      <CvReview documentId={rv.documentId} listId={rv.listId} key={rv.documentId} canMark={isTa} />
    ) : cm || sm ? (
      <LegacyCv screeningId={(cm ?? sm)![1]!} key={(cm ?? sm)![1]} />
    ) : route === '/candidates' ? (
      <CandidatePool canMark={isTa} />
    ) : (
      <VacancyList canCreate={isTa} />
    );
  }

  body = (
    <Boundary
      name="page"
      fallback={<ReloadNote text="parallax was updated. Reload to see this page." />}
    >
      <Suspense
        fallback={
          <p role="status" className="p-4 text-sm text-ink-2">
            {t('Loading…')}
          </p>
        }
      >
        {body}
      </Suspense>
    </Boundary>
  );

  const footer = (
    <>
      <p>
        {t(
          'AI-assisted screening: scores and rankings are recommendations. Every decision about a candidate is made by a person and recorded under their name.',
        )}
      </p>
      {/* Only a problem is worth a line: "Service ready" on every page is noise. */}
      <p role="status" aria-live="polite" className="mt-1 font-medium text-err-ink">
        {health.state === 'down' ? t(HEALTH_LABEL.down) : ''}
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
        onSignOut={leave}
        onMe={setMe}
      >
        {body}
      </Shell>
    );

  return (
    <div className="min-h-screen bg-page text-ink">
      <SkipLink />
      <header className="bg-brand text-on-brand shadow-[0_2px_14px_-6px_rgb(0_0_0/0.45)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <a
            href="#/"
            className="rounded-lg focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            title={BRAND_FULL}
          >
            <Brand onBrand />
          </a>
          {/* The forced change and the invitation pages also let a person switch language or
              leave: someone without the temporary password must not be stuck (SD-41). */}
          <div className="flex items-center gap-2">
            <LanguageSwitch signedIn={!!me && !me.mustChangePassword} />
            {me && (
              <button
                type="button"
                className="rounded-full border border-white/40 px-3 py-1 text-sm font-semibold hover:bg-white/10 pointer-coarse:min-h-11 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                onClick={() => {
                  if (setupToken) window.location.hash = '/';
                  leave();
                }}
              >
                {t('Sign out')}
              </button>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 focus:outline-none">
        {body}
      </main>
      {/* Not while the session is being checked: that footer would be thrown away when the page
          arrives, which counts as a layout shift (PF-01). */}
      {!booting && (
        <footer
          className={`mx-auto px-4 mb-8 text-xs text-ink-3 ${me ? 'max-w-6xl' : 'max-w-xl text-center'}`}
        >
          {footer}
        </footer>
      )}
    </div>
  );
}
