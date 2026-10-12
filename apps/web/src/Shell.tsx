import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Me } from './api';
import { Appearance, LanguageSwitch } from './Appearance';
import {
  askSenAI,
  setAssistantOpen,
  SLOGAN,
  useAssistantConfig,
  useAssistantOpen,
  useAssistantRegistration,
} from './assistant';
import { Brand, BRAND_FULL, Mark } from './brand';
import { useT } from './i18n';
import { AssistantPanel } from './pages/AssistantPanel';
import { PoolPanel } from './pages/PoolPanel';
import { isBackground } from './theme';

/**
 * The frame around every signed-in page (Development Plan, Phase 1): a left rail with Vacancies and
 * Candidates, a top bar with the SenAI Ask bar and the account menu, and on phones a bottom bar.
 * People without recruiter access get the same frame without the rail.
 */

const NAV = [
  ['/vacancies', 'Vacancies'],
  ['/candidates', 'Candidates'],
] as const;
const inSection = (route: string, href: string) => route === href || route.startsWith(`${href}/`);

function Icon({ name }: { name: 'vacancies' | 'candidates' | 'ask' }) {
  const d =
    name === 'vacancies'
      ? 'M4 7h16M4 12h16M4 17h10'
      : name === 'candidates'
        ? 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.3 3.1-6 7-6s7 2.7 7 6'
        : 'M5 5h14v10H9l-4 4V5Z';
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function AskBar() {
  const t = useT();
  const cfg = useAssistantConfig();
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  // "/" jumps to the Ask bar from anywhere that is not a text field.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  if (!cfg) return <div className="flex-1" />;
  return (
    <form
      role="search"
      className="mx-auto w-full max-w-xl flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        const text = q.trim();
        if (!text) return setAssistantOpen(true);
        askSenAI(text.slice(0, 1000));
        setQ('');
      }}
    >
      <label className="relative block">
        <span className="sr-only">{t('Ask {name}', { name: cfg.name })}</span>
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-link">
          <Mark size={18} />
        </span>
        <input
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={1000}
          placeholder={`${cfg.name}: ${SLOGAN}`}
          className="block w-full rounded-full border border-edge bg-page py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </label>
    </form>
  );
}

function AccountMenu({
  me,
  isAdmin,
  isGov,
  onSignOut,
  onMe,
}: {
  me: Me;
  isAdmin: boolean;
  isGov: boolean;
  onSignOut: () => void;
  onMe: (f: (m: Me | null) => Me | null) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDetailsElement>(null);
  const name = me.displayName ?? me.email ?? '';
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const close = () => ref.current?.removeAttribute('open');
  const link = 'block rounded px-2 py-1.5 hover:bg-hover';
  return (
    <details ref={ref} className="relative shrink-0">
      <summary
        aria-label={t('Account menu')}
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full bg-accent text-sm font-semibold text-on-accent focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        {initials || '·'}
      </summary>
      <div
        className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-line bg-card p-2 text-sm shadow-lg"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) close();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <p className="truncate px-2 py-1 font-medium text-ink">{name}</p>
        {me.email && me.email !== name && (
          <p className="truncate px-2 pb-1 text-xs text-ink-3">{me.email}</p>
        )}
        <div className="border-t border-line pt-1">
          <a href="#/reports" className={link}>
            {t('Shared with me')}
          </a>
          {(isAdmin || isGov) && (
            <a href="#/admin/monitoring" className={link}>
              {t('Monitoring')}
            </a>
          )}
          {isAdmin && (
            <a href="#/admin" className={link}>
              {t('Admin')}
            </a>
          )}
          <a href="#/password" className={link}>
            {t('Password')}
          </a>
          <a href="#/security" className={link}>
            {t('Security')}
          </a>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-2">
          <LanguageSwitch signedIn />
          <Appearance
            value={isBackground(me.background) ? me.background : null}
            onChange={(background) => onMe((m) => (m ? { ...m, background } : m))}
          />
        </div>
        <div className="border-t border-line pt-1">
          <button
            type="button"
            className={`${link} w-full text-left text-link`}
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            {t('Sign out')}
          </button>
        </div>
      </div>
    </details>
  );
}

/** SenAI: the report's own panel when a candidate is open, otherwise the pool panel. */
function SenAI() {
  const cfg = useAssistantConfig();
  const reg = useAssistantRegistration();
  if (!cfg) return null;
  return reg ? (
    <AssistantPanel
      config={cfg}
      target={reg.target}
      others={reg.others}
      onEditRequirement={reg.onEditRequirement}
      launcher={false}
    />
  ) : (
    <PoolPanel config={cfg} />
  );
}

export function Shell({
  me,
  isTa,
  isAdmin,
  isGov,
  route,
  footer,
  onSignOut,
  onMe,
  children,
}: {
  me: Me;
  isTa: boolean;
  isAdmin: boolean;
  isGov: boolean;
  route: string;
  footer: ReactNode;
  onSignOut: () => void;
  onMe: (f: (m: Me | null) => Me | null) => void;
  children: ReactNode;
}) {
  const t = useT();
  const cfg = useAssistantConfig();
  const open = useAssistantOpen();
  const rail = isTa;
  const link = (active: boolean) =>
    `flex flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium ${active ? 'bg-sel text-link' : 'text-ink-2 hover:bg-hover'} focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none`;

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="flex items-center gap-3 px-4 py-2">
          <a href={isTa ? '#/vacancies' : '#/'} className="shrink-0 rounded" title={BRAND_FULL}>
            <span className="hidden sm:inline">
              <Brand />
            </span>
            <span className="sm:hidden">
              <Brand compact />
            </span>
          </a>
          <AskBar />
          <AccountMenu me={me} isAdmin={isAdmin} isGov={isGov} onSignOut={onSignOut} onMe={onMe} />
        </div>
      </header>

      <div className="flex">
        {rail && (
          <nav
            aria-label={t('Main')}
            className="sticky top-[53px] hidden h-[calc(100vh-53px)] w-20 shrink-0 flex-col gap-1 border-r bg-card p-2 sm:flex"
          >
            {NAV.map(([href, label]) => (
              <a
                key={href}
                href={`#${href}`}
                aria-current={inSection(route, href) ? 'page' : undefined}
                className={link(inSection(route, href))}
              >
                <Icon name={href === '/vacancies' ? 'vacancies' : 'candidates'} />
                {t(label)}
              </a>
            ))}
          </nav>
        )}
        <div
          className={`min-w-0 flex-1 ${open && cfg ? 'min-[1280px]:pr-96' : ''} ${rail ? 'pb-16 sm:pb-0' : ''}`}
        >
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-ink-3">{footer}</footer>
        </div>
      </div>

      {rail && (
        <nav
          aria-label={t('Main')}
          className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t bg-card p-1 sm:hidden"
        >
          {NAV.map(([href, label]) => (
            <a
              key={href}
              href={`#${href}`}
              aria-current={inSection(route, href) ? 'page' : undefined}
              className={`${link(inSection(route, href))} flex-1`}
            >
              <Icon name={href === '/vacancies' ? 'vacancies' : 'candidates'} />
              {t(label)}
            </a>
          ))}
          {cfg && (
            <button
              type="button"
              onClick={() => setAssistantOpen(true)}
              className={`${link(false)} flex-1`}
            >
              <Icon name="ask" />
              {t('Ask {name}', { name: cfg.name })}
            </button>
          )}
        </nav>
      )}
      <SenAI />
    </div>
  );
}
