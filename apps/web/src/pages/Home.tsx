import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { api, type Me } from '../api';
import { askSenAI, setAssistantOpen, useAssistantConfig } from '../assistant';
import { Mark } from '../brand';
import { useT } from '../i18n';
import type { VacancyListItem } from '../pool';

/**
 * Home (#/): the menu of what this person can do, one tap away. A large greeting, one prompt bar
 * for the assistant, then a bento of tonal tiles (one hue per function), the vacancies they were
 * last in, and the account links. What is shown follows the person's roles, so nobody meets a tile
 * that leads to "Administrators only". Every tile is a real link (a button for the assistant), so
 * the keyboard, a screen reader and "open in a new tab" all work. Styles and motion: home.css.
 */

type IconName =
  | 'plus'
  | 'vacancies'
  | 'candidates'
  | 'ask'
  | 'inbox'
  | 'lock'
  | 'shield'
  | 'users'
  | 'chip'
  | 'sparkle'
  | 'chart'
  | 'clock'
  | 'arrow';

const PATH: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  vacancies: 'M4 8h16v11H4V8Zm5 0V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16',
  candidates: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.3 3.1-6 7-6s7 2.7 7 6',
  ask: 'M5 5h14v10H9l-4 4V5Z',
  inbox: 'M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M12 4v10m0 0-4-4m4 4 4-4',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6v-9Z',
  shield: 'M12 3 5 6v5c0 4.4 2.9 8.2 7 10 4.1-1.8 7-5.6 7-10V6l-7-3Zm-3 9 2 2 4-4',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3 2.7-5 6-5s6 2 6 5M16 5a3.5 3.5 0 0 1 0 6.5M18 15c2 .6 3 2.2 3 5',
  chip: 'M8 8h8v8H8V8ZM4 10h2M4 14h2M18 10h2M18 14h2M10 4v2M14 4v2M10 18v2M14 18v2',
  sparkle:
    'm12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 11 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
};

function Glyph({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATH[name]} />
    </svg>
  );
}

type Tone = 'blue' | 'green' | 'amber' | 'violet' | 'teal' | 'slate';

interface TileSpec {
  id: string;
  title: string;
  text: string;
  icon: IconName;
  tone: Tone;
  href?: string;
  onClick?: () => void;
  /** The one thing most people come here to do: the big gradient tile. */
  lead?: boolean;
}

function Tile({
  spec,
  place,
  index,
  vars,
}: {
  spec: TileSpec;
  /** Grid placement classes for the list item. */
  place: string;
  index: number;
  vars: Record<string, string>;
}) {
  const t = useT();
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const seq = useRef(0);

  // The pointer's light follows the cursor; a press ripples out from the finger.
  const follow = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  const press = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = ++seq.current;
    setRipples((l) => [...l.slice(-2), { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    window.setTimeout(() => setRipples((l) => l.filter((x) => x.id !== id)), 700);
  };

  const cls = `home-tile home-in home-t-${spec.tone} ${spec.lead ? 'home-lead' : ''}`;
  const style = { '--i': Math.min(index + 3, 12) } as CSSProperties;
  const inner = (
    <>
      {spec.lead && (
        <>
          <span aria-hidden="true" className="home-rings" />
          <span aria-hidden="true" className="home-star">
            <Mark size={56} fill="transparent" star="#F5C461" className="text-white/90" />
          </span>
        </>
      )}
      {ripples.map((r) => (
        <span
          key={r.id}
          aria-hidden="true"
          className="home-ripple"
          style={{ left: r.x, top: r.y }}
        />
      ))}
      <span className="flex items-start justify-between gap-3">
        <span className="home-icon">
          <Glyph name={spec.icon} size={spec.lead ? 30 : 24} />
        </span>
        <span aria-hidden="true" className="home-arrow">
          <Glyph name="arrow" size={18} />
        </span>
      </span>
      <span className="block">
        <span className="home-title">{t(spec.title, vars)}</span>{' '}
        <span className="home-text">{t(spec.text)}</span>
      </span>
    </>
  );
  return (
    <li className={place}>
      {spec.href ? (
        <a
          href={spec.href}
          className={cls}
          style={style}
          onPointerMove={follow}
          onPointerDown={press}
        >
          {inner}
        </a>
      ) : (
        <button
          type="button"
          className={cls}
          style={style}
          onClick={spec.onClick}
          onPointerMove={follow}
          onPointerDown={press}
        >
          {inner}
        </button>
      )}
    </li>
  );
}

const greetingKey = (hour: number) =>
  hour < 12
    ? 'Good morning, {name}'
    : hour < 18
      ? 'Good afternoon, {name}'
      : 'Good evening, {name}';

/** The prompt bar: type a question and the assistant opens with it; empty, it just opens. */
function Prompt({ name }: { name: string }) {
  const t = useT();
  const [q, setQ] = useState('');
  const label = t('Ask {name} about your candidates', { name });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return setAssistantOpen(true);
    askSenAI(text.slice(0, 1000));
    setQ('');
  };
  return (
    <form
      onSubmit={submit}
      className="home-prompt home-in mt-7"
      style={{ '--i': 2 } as CSSProperties}
    >
      <Mark size={22} className="shrink-0 text-ink" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={1000}
        aria-label={label}
        placeholder={label}
        autoComplete="off"
      />
      <button type="submit" className="home-send" aria-label={t('Ask {name}', { name })}>
        <Glyph name="arrow" size={20} />
      </button>
    </form>
  );
}

/** The vacancies the person touched last: one tap back into the work. Silent if it cannot load. */
function Recent({ start }: { start: number }) {
  const t = useT();
  const [rows, setRows] = useState<VacancyListItem[]>([]);
  useEffect(() => {
    let live = true;
    api
      .get<VacancyListItem[]>('/vacancies?sort=updated&order=desc')
      .then((r) => {
        if (live && Array.isArray(r)) setRows(r.filter((v) => !v.archived).slice(0, 4));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="home-recent">
      <h2 id="home-recent" className="home-in mb-3 text-sm font-semibold text-ink-2">
        {t('Pick up where you left off')}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {rows.map((v, i) => (
          <li key={v.id} className="max-w-full">
            <a
              href={`#/vacancies/${v.id}`}
              className="home-chip home-in"
              style={{ '--i': Math.min(start + i, 14) } as CSSProperties}
            >
              <span className="text-ink-3">
                <Glyph name="clock" size={18} />
              </span>
              <span className="truncate">{v.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Home({
  me,
  isTa,
  isAdmin,
  isGov,
  now = new Date(),
}: {
  me: Me;
  isTa: boolean;
  isAdmin: boolean;
  isGov: boolean;
  now?: Date;
}) {
  const t = useT();
  const cfg = useAssistantConfig();
  // {name} also names the Assistant tile for an administrator, where SenAI may be off: then the product name.
  const vars = { name: cfg?.name ?? 'SenAI' };

  const first = me.displayName?.trim().split(/\s+/)[0] ?? '';
  const hello = first ? t(greetingKey(now.getHours()), { name: first }) : t('Welcome');

  const shared: TileSpec = {
    id: 'shared',
    href: '#/reports',
    title: 'Shared with me',
    text: 'Reports that colleagues shared with you.',
    icon: 'inbox',
    tone: 'violet',
  };
  const monitoring: TileSpec = {
    id: 'monitoring',
    href: '#/admin/monitoring',
    title: 'Fairness monitoring',
    text: 'Fairness figures and the audit trail.',
    icon: 'chart',
    tone: 'green',
  };
  const adminTiles: TileSpec[] = [
    {
      id: 'users',
      href: '#/admin',
      title: 'Users',
      text: 'Add people, set roles and reset access.',
      icon: 'users',
      tone: 'blue',
      lead: true,
    },
    {
      id: 'models',
      href: '#/admin/ai',
      title: 'AI models',
      text: 'Choose and test the models that read CVs.',
      icon: 'chip',
      tone: 'teal',
    },
    {
      id: 'assistant',
      href: '#/admin/assistant',
      title: '{name}',
      text: 'Turn the assistant on and set what it may do.',
      icon: 'sparkle',
      tone: 'amber',
    },
    monitoring,
    {
      id: 'retention',
      href: '#/admin/retention',
      title: 'Data retention',
      text: 'Decide how long files are kept.',
      icon: 'clock',
      tone: 'slate',
    },
  ];

  // The bento: a lead tile and the tiles beside it, by role.
  let main: TileSpec[] = [];
  let sectionTitle = 'Screen candidates';
  if (isTa) {
    main = [
      {
        id: 'new',
        href: '#/vacancies/new',
        title: 'New vacancy',
        text: 'Describe a role, add CVs and see who fits, with the evidence.',
        icon: 'plus',
        tone: 'blue',
        lead: true,
      },
      {
        id: 'vacancies',
        href: '#/vacancies',
        title: 'Vacancies',
        text: 'All your roles with status, progress and decisions.',
        icon: 'vacancies',
        tone: 'teal',
      },
      {
        id: 'candidates',
        href: '#/candidates',
        title: 'Candidates',
        text: 'Search every analyzed CV across your vacancies.',
        icon: 'candidates',
        tone: 'green',
      },
      ...(cfg
        ? [
            {
              id: 'ask',
              onClick: () => setAssistantOpen(true),
              title: 'Ask {name}',
              text: 'Ask about your candidates in plain words.',
              icon: 'ask' as const,
              tone: 'amber' as const,
            },
          ]
        : []),
      shared,
    ];
  } else if (isAdmin) {
    main = adminTiles;
    sectionTitle = 'Administration';
  } else if (isGov) {
    main = [
      { ...monitoring, lead: true, tone: 'blue' },
      {
        id: 'assistant',
        href: '#/admin/assistant',
        title: '{name}',
        text: 'Review how the assistant is set up and used.',
        icon: 'sparkle',
        tone: 'amber',
      },
      shared,
    ];
    sectionTitle = 'Oversight';
  }
  const [lead, ...side] = main;
  // Beside the lead (two columns by two rows from 1024 px): four tiles make a two by two; an odd
  // last tile takes a full row; one or two tiles take a full row each.
  const sideClass = (i: number): string => {
    const n = side.length;
    if (n === 1) return 'col-span-2 lg:row-span-2';
    if (n === 2) return 'col-span-2';
    return i === n - 1 && n % 2 === 1 ? 'col-span-2' : 'col-span-1';
  };

  // An administrator who also recruits finds the administration tiles in a row of their own.
  const adminRow = isAdmin && isTa ? adminTiles.map((x) => ({ ...x, lead: false })) : [];
  const chips: { id: string; href: string; title: string; icon: IconName }[] = [
    ...(isAdmin && !isTa
      ? [{ id: 'shared', href: '#/reports', title: 'Shared with me', icon: 'inbox' as const }]
      : []),
    { id: 'password', href: '#/password', title: 'Change password', icon: 'lock' },
    { id: 'security', href: '#/security', title: 'Security', icon: 'shield' },
  ];

  return (
    <div className="relative pb-4">
      <div aria-hidden="true" className="home-aurora">
        <span className="home-glow home-glow-a" />
        <span className="home-glow home-glow-b" />
        <span className="home-glow home-glow-c" />
      </div>

      <section className="pb-8 pt-4 sm:pt-8">
        <h1 className="sr-only">{t('Home')}</h1>
        <p className="home-in flex items-center gap-3 text-4xl font-semibold leading-[1.12] tracking-tight sm:gap-4 sm:text-5xl">
          <span className="home-wake shrink-0">
            <Mark size={40} className="text-ink" />
          </span>
          <span className="home-greeting">{hello}</span>
        </p>
        <p
          className="home-in mt-2 max-w-2xl text-xl font-medium text-ink-3 sm:text-2xl"
          style={{ '--i': 1 } as CSSProperties}
        >
          {isAdmin && !isTa
            ? t(
                'Administrators manage users and AI models under Administration. Candidate data is available only to recruiters.',
              )
            : t('What would you like to do today?')}
        </p>
        {isTa && cfg && <Prompt name={cfg.name} />}
      </section>

      <div className="space-y-8">
        {lead && (
          <section aria-labelledby="home-main">
            <h2 id="home-main" className="home-in mb-3 text-sm font-semibold text-ink-2">
              {t(sectionTitle)}
            </h2>
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile spec={lead} place="col-span-2 lg:row-span-2" index={0} vars={vars} />
              {side.map((spec, i) => (
                <Tile key={spec.id} spec={spec} place={sideClass(i)} index={i + 1} vars={vars} />
              ))}
            </ul>
          </section>
        )}

        {adminRow.length > 0 && (
          <section aria-labelledby="home-admin">
            <h2 id="home-admin" className="home-in mb-3 text-sm font-semibold text-ink-2">
              {t('Administration')}
            </h2>
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {adminRow.map((spec, i) => (
                <Tile key={spec.id} spec={spec} place="col-span-1" index={i + 6} vars={vars} />
              ))}
            </ul>
          </section>
        )}

        {isTa && <Recent start={8} />}

        <section aria-labelledby="home-account">
          <h2 id="home-account" className="home-in mb-3 text-sm font-semibold text-ink-2">
            {t('Account')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {chips.map((c, i) => (
              <li key={c.id}>
                <a
                  href={c.href}
                  className="home-chip home-in"
                  style={{ '--i': Math.min(i + 9, 14) } as CSSProperties}
                >
                  <span className="text-ink-3">
                    <Glyph name={c.icon} size={18} />
                  </span>
                  {t(c.title)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
