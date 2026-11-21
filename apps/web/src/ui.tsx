import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReqStatus } from './api';
import { dayAndTime } from './dates';
import { tr, useT } from './i18n';
import { trServer } from './i18n/server';

export const btn =
  'm-press inline-flex items-center justify-center rounded-full px-4 py-1.5 text-sm font-semibold pointer-coarse:min-h-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed';
export const btnPrimary = `${btn} bg-accent text-on-accent hover:bg-accent-hover`;
export const btnSecondary = `${btn} border border-edge bg-card text-ink hover:bg-hover`;
export const btnDanger = `${btn} bg-danger text-on-accent hover:bg-danger-hover`;
/** A stand-alone link (a way back, a one-line action): a 44 px target on touch screens, WCAG 2.5.5. */
export const tapLink = 'inline-flex items-center pointer-coarse:min-h-11';

export const input =
  'block w-full rounded-xl border border-edge px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/** The first Tab stop of every page: jumps over the header to the content (WCAG 2.4.1, A11-03). */
export function SkipLink() {
  const t = useT();
  return (
    <a
      href="#main"
      onClick={(e) => {
        // The address bar holds the route, so the link moves focus instead of changing the hash.
        e.preventDefault();
        const main = document.getElementById('main');
        main?.focus();
        main?.scrollIntoView?.({ block: 'start' });
      }}
      className="sr-only focus:not-sr-only focus:block focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:ring-2 focus:ring-inset focus:ring-focus focus:outline-none"
    >
      {t('Skip to main content')}
    </a>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
  errorId,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  /**
   * Stage 3 (S3-INT-14): an error line tied to the input. Give the input
   * `aria-invalid` and `aria-describedby={errorId}`; the line gets that id and role="alert".
   */
  error?: string;
  errorId?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
      {error && (
        <span id={errorId} role="alert" className="mt-1 block text-xs font-medium text-err-ink">
          {error}
        </span>
      )}
    </label>
  );
}

export function Card({
  title,
  children,
  actions,
  page = false,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** The card is the whole page (sign in, change password): its title is the page's h1 (A11-02). */
  page?: boolean;
}) {
  const Heading = page ? 'h1' : 'h2';
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-card p-5 shadow-[0_1px_2px_rgb(11_31_58/0.05),0_6px_20px_-12px_rgb(11_31_58/0.18)]">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <Heading className="text-base font-semibold text-ink">{title}</Heading>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warn' | 'error' | 'ok';
  children: ReactNode;
}) {
  const c = {
    info: 'border-info-line bg-info text-info-ink',
    warn: 'border-warn-line bg-warn text-warn-ink',
    error: 'border-err-line bg-err text-err-ink',
    ok: 'border-ok-line bg-ok text-ok-ink',
  }[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-3.5 py-2.5 text-sm ${c}`}
    >
      {children}
    </div>
  );
}

const STATUS: Record<ReqStatus, [string, string]> = {
  met: ['Met', 'bg-ok text-ok-ink'],
  partially_met: ['Partially met', 'bg-ok text-ok-ink'],
  not_met: ['Not met', 'bg-err text-err-ink'],
  not_found: ['Not found in CV', 'bg-neutral text-ink'],
  ambiguous: ['Unclear', 'bg-warn text-warn-ink'],
  not_applicable: ['Not applicable', 'bg-neutral text-ink-2'],
};
export const statusLabel = (s: ReqStatus) => tr(STATUS[s][0]);

/** Status is always text plus colour, never colour alone. */
export function StatusBadge({ status }: { status: ReqStatus | null }) {
  if (!status) return <span className="text-xs text-ink-3">—</span>;
  const [label, cls] = STATUS[status];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{tr(label)}</span>
  );
}

const BAND: Record<string, [string, string]> = {
  strong_match: ['Strong match', 'bg-ok text-ok-ink'],
  possible_match: ['Possible match', 'bg-tag text-tag-ink'],
  weak_match: ['Weak match', 'bg-neutral text-ink'],
  needs_review: ['Needs review', 'bg-warn text-warn-ink'],
};
export function BandBadge({ band }: { band: string | null }) {
  if (!band) return <span className="text-xs text-ink-3">—</span>;
  const [label, cls] = BAND[band] ?? [band, 'bg-neutral'];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{tr(label)}</span>
  );
}

export const OUTCOME: Record<string, [string, string]> = {
  shortlist: ['Shortlisted', 'bg-ok text-ok-ink'],
  hold: ['Maybe', 'bg-warn text-warn-ink'],
  reject: ['Not now', 'bg-err text-err-ink'],
};

export function when(iso: string | null | undefined) {
  if (!iso) return '';
  return dayAndTime(new Date(iso));
}

/** Server messages are English; each has an Azerbaijani entry or template (az.server.ts, server.ts). */
export const errMsg = (e: unknown) =>
  trServer(e instanceof Error ? e.message : 'Something went wrong');

// ------------------------------------------------------------------ menus on <details>

let openMenu: HTMLDetailsElement | null = null;

/**
 * Makes a <details> menu behave like a menu (AC-01, VL-06): Esc closes it from the button or from
 * inside and puts the focus back on the button; a click anywhere else closes it; opening one menu
 * closes any other. Returns `close(refocus?)` and an `onToggle` handler for the <details>.
 */
export function useDetailsMenu(ref: React.RefObject<HTMLDetailsElement | null>) {
  const [open, setOpen] = useState(false);
  const close = useCallback(
    (refocus = false) => {
      const d = ref.current;
      if (!d?.open) return;
      d.removeAttribute('open');
      if (refocus) d.querySelector('summary')?.focus();
    },
    [ref],
  );
  useEffect(() => {
    const d = ref.current;
    if (!open || !d) return;
    if (openMenu && openMenu !== d) openMenu.removeAttribute('open');
    openMenu = d;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // An open picker inside the menu closes first.
      const inner = d.querySelector('details[open]');
      if (inner && inner.contains(document.activeElement)) return;
      e.preventDefault();
      close(true);
    };
    const onDown = (e: PointerEvent) => {
      if (!d.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      if (openMenu === d) openMenu = null;
    };
  }, [open, ref, close]);
  const onToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open),
    [],
  );
  return { open, close, onToggle };
}

// ------------------------------------------------------------------ bars fixed to the bottom

/**
 * Publishes the height of a bar fixed to the bottom of the screen as a CSS variable on <html>
 * (`--bottombar-h` for the phone navigation, `--reviewbar-h` for the review's Previous/Next bar), so
 * the content, the toasts and the SenAI sheet keep clear of it. 0 when the bar is hidden or gone.
 */
export function usePublishedHeight(name: string, el: HTMLElement | null) {
  useEffect(() => {
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty(name, '0px');
      return;
    }
    const set = () =>
      root.style.setProperty(name, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    window.addEventListener('resize', set);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', set);
      root.style.setProperty(name, '0px');
    };
  }, [name, el]);
}

// ------------------------------------------------------------------ undo toast

/**
 * A line at the bottom of the screen that offers "Undo" for ten seconds after an action
 * (Development Plan: marks, archive). One at a time; a new one replaces the old.
 */
export interface UndoToast {
  id: number;
  text: string;
  undo: () => unknown;
}
export function useUndoToast(ms = 10_000) {
  const [toast, setToast] = useState<UndoToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);
  const show = useCallback(
    (text: string, undo: UndoToast['undo']) => {
      clearTimeout(timer.current);
      const id = ++seq.current;
      setToast({ id, text, undo });
      timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), ms);
    },
    [ms],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, show, dismiss };
}

export function UndoBar({
  toast,
  onDone,
  label,
}: {
  toast: UndoToast | null;
  onDone: () => void;
  label: string;
}) {
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className="m-toast fixed bottom-[calc(var(--bottombar-h,0px)+var(--reviewbar-h,0px)+1rem)] left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-card px-4 py-2.5 text-sm shadow-lg sm:bottom-[calc(var(--reviewbar-h,0px)+1.5rem)]"
    >
      <span>{toast.text}</span>
      <button
        type="button"
        className="font-medium text-link underline"
        onClick={() => {
          onDone();
          void toast.undo();
        }}
      >
        {label}
      </button>
    </div>
  );
}
