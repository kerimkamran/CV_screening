/**
 * Page backgrounds (spec 4.2). Nothing chosen (`null`) is the light default, White-grey, on every
 * device; "auto" is the explicit choice to follow the device's light or dark setting.
 */
export const BACKGROUNDS = ['white', 'grey', 'cream', 'dark'] as const;
export type Background = (typeof BACKGROUNDS)[number];
export type BackgroundChoice = Background | 'auto';

export const BACKGROUND_LABEL: Record<Background, string> = {
  white: 'White',
  grey: 'White-grey',
  cream: 'Cream-white',
  dark: 'Dark',
};

/** Swatch colours for the picker. */
export const BACKGROUND_SWATCH: Record<Background, string> = {
  white: '#ffffff',
  grey: '#f6f8fc',
  cream: '#f7f1e3',
  dark: '#0a1530',
};

const KEY = 'cv-background';

export function isBackground(v: unknown): v is BackgroundChoice {
  return v === 'auto' || (typeof v === 'string' && (BACKGROUNDS as readonly string[]).includes(v));
}

/**
 * Applies the choice to <html>. The copy in localStorage only avoids a flash on the next visit
 * (public/theme-init.js reads it); the stored per-user value on the server is the source of truth.
 */
export function applyBackground(bg: BackgroundChoice | null): void {
  const root = document.documentElement;
  if (bg) root.setAttribute('data-bg', bg);
  else root.removeAttribute('data-bg');
  try {
    if (bg) localStorage.setItem(KEY, bg);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage can be blocked; the page still works */
  }
}
