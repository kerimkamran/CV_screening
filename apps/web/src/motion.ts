import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * The script side of parallax motion (see motion.css). Everything here asks one question first: may
 * things move? No when the person asked for reduced motion, and no where the browser cannot say
 * (tests, very old browsers), so the calm path is the default.
 */
export function mayMove(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
}

type Dir = 'next' | 'prev';
let pendingDir: Dir | null = null;

/** The next screen change is a step through a list: it slides that way instead of fading. */
export function navDirection(dir: Dir) {
  pendingDir = dir;
}

type StartViewTransition = (cb: () => void) => { finished: Promise<void> };

/**
 * Applies a screen change inside a View Transition when the browser has them and motion is allowed;
 * otherwise applies it at once. The header band and the side rail are named, so they stay still.
 */
export function transition(apply: () => void) {
  const start = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition;
  const dir = pendingDir;
  pendingDir = null;
  if (!start || !mayMove() || document.visibilityState === 'hidden') {
    apply();
    return;
  }
  const root = document.documentElement;
  if (dir) root.dataset.nav = dir;
  else delete root.dataset.nav;
  try {
    const vt = start.call(document, () => flushSync(apply));
    void vt.finished.finally(() => {
      if (root.dataset.nav === dir) delete root.dataset.nav;
    });
  } catch {
    apply();
  }
}

/**
 * A number that counts up to its value the first time it is shown (and from the old value when it
 * changes). Returns the final value at once when motion is off.
 */
export function useCountUp(value: number, ms = 900): number {
  const [shown, setShown] = useState(() => (mayMove() ? 0 : value));
  const from = useRef(shown);
  useEffect(() => {
    if (!mayMove()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = a + (value - a) * eased;
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/**
 * Restarts a CSS animation on an element: removes the class, forces a style flush, adds it back.
 * Used for "Show in CV" so pressing it again lights the line again.
 */
export function replay(el: Element | null | undefined, cls: string) {
  if (!el || !mayMove()) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/**
 * Brings an element into view inside the nearest box that scrolls (the CV pane), without moving the
 * page around it: the decision panel and the requirements stay where the person left them. Smooth
 * only when motion is allowed. Falls back to the browser's own scrollIntoView.
 */
export function scrollInside(el: HTMLElement | null | undefined, block: 'center' | 'start') {
  if (!el) return;
  let box = el.parentElement;
  while (box && box !== document.body) {
    const o = getComputedStyle(box).overflowY;
    if ((o === 'auto' || o === 'scroll') && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  const behavior = mayMove() ? 'smooth' : 'auto';
  if (!box || box === document.body || typeof box.scrollTo !== 'function') {
    el.scrollIntoView?.({ block, behavior });
    return;
  }
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const offset = block === 'center' ? (box.clientHeight - r.height) / 2 : 8;
  box.scrollTo({ top: Math.max(0, box.scrollTop + (r.top - b.top) - offset), behavior });
}
