import { useSyncExternalStore } from 'react';
import { AZ } from './az';

/**
 * Interface language (design spec 13): English and Azerbaijani. Text is written in English in the
 * code and looked up by that exact sentence; a sentence with no Azerbaijani entry shows in English
 * rather than breaking. A test checks that every sentence used in the pages has an entry.
 *
 *   const t = useT();   t('Find the best fit')   t('{n} skipped', { n: 3 })
 *
 * Plain Azerbaijani, "siz" form, sentence case, no jargon (spec 2.4). Resume text, quotes and
 * names are never translated: they are shown as written.
 */
export const LANGS = ['en', 'az'] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAME: Record<Lang, string> = { en: 'English', az: 'Azərbaycan dili' };

const KEY = 'cv-lang';
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'az';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage can be blocked */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.toLowerCase().startsWith('az') ? 'az' : 'en';
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;

/** `null` clears the choice and follows the browser again. */
export function applyLang(next: Lang | null): void {
  if (next === null) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    current = initial();
  } else {
    current = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  listeners.forEach((l) => l());
}

export type Vars = Record<string, string | number>;

const fill = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** Translate now (for code outside components). */
export function tr(en: string, vars?: Vars): string {
  return fill(current === 'az' ? (AZ[en] ?? en) : en, vars);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** The translate function, re-rendering the component when the language changes. */
export function useT(): typeof tr {
  useLang();
  return tr;
}

/** Date and time in the viewer's language. */
export const locale = (): string => (current === 'az' ? 'az-AZ' : 'en-GB');
