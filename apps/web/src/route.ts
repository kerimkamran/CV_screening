import { useEffect, useState } from 'react';
import { transition } from './motion';

/** Hash routing keeps every client route off the API's path space (single-service deploy). */
export function useRoute(): string {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    // A change of screen moves softly where the browser can (motion.ts); otherwise it is instant.
    const on = () => transition(() => setRoute(read()));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => {
  window.location.hash = path;
};
