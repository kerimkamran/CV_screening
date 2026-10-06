import { useSyncExternalStore } from 'react';

/**
 * "Focus on skills" (design spec 6.2.6). The recruiter's own switch, saved on the server per
 * person. When on, the first look is only about skills: file names are never shown, "Reveal all
 * names" is not offered, and the full CV text waits behind a click. It is "hidden on screen", not
 * a guarantee: a name can sit in free text that redaction misses.
 */
let on = false;
const subs = new Set<() => void>();
export const setFocus = (v: boolean) => {
  if (v === on) return;
  on = v;
  subs.forEach((f) => f());
};
export const getFocus = () => on;
export function useFocus(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => on,
  );
}
