import { lazy } from 'react';

// The big screens load on demand, so the first page carries less script (PF-07). Each one is its
// own file; the page that shows it sits inside a <Suspense> with a 'Loading…' line.
const loadPool = () => import('./CandidatePool').then((m) => ({ default: m.CandidatePool }));
const loadReview = () => import('./CvReview').then((m) => ({ default: m.CvReview }));
const loadReport = () => import('./Report').then((m) => ({ default: m.Report }));

export const CandidatePool = lazy(loadPool);
export const CvReview = lazy(loadReview);
export const Report = lazy(loadReport);

/**
 * Start fetching the file for the screen the address points at, before the app has finished
 * signing in, so the file arrives while the first requests are on their way (PF-03).
 */
export function preloadFor(hash: string): void {
  const route = hash.replace(/^#/, '');
  // A file that cannot be fetched now is asked for again when the screen needs it, where the page's
  // error boundary shows the reload note; a failed head start must not be an uncaught error (SH-10).
  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);
  if (route.startsWith('/cv/')) {
    quiet(loadReview());
    quiet(import('./PdfPages')); // the page viewer, which the review screen would otherwise ask for last
  } else if (route === '/candidates' || /^\/vacancies\/[0-9A-Z]{26}$/.test(route))
    quiet(loadPool());
}
