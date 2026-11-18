import { createElement, lazy, type ComponentType } from 'react';

// The big screens load on demand, so the first page carries less script (PF-07). Each one is its
// own file; the page that shows it sits inside a <Suspense> with a 'Loading…' line.

/**
 * A screen loaded on demand that skips the 'Loading…' step when its file has already arrived.
 * Once React has shown a fallback it keeps it up for about 300 ms, even if the file comes at once
 * (PF-03: two of those waits stood between opening a CV and its first page). `preload()` is called
 * at start-up; when the file is in by the time the screen is first drawn, the screen is drawn
 * straight away. Otherwise it behaves as `lazy` does.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function eager<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  let ready: C | null = null;
  const Later = lazy(load);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Screen = (props: any) =>
    ready ? createElement(ready, props) : createElement(Later, props);
  Screen.preload = () =>
    load().then((m) => {
      ready = m.default;
    });
  return Screen as unknown as C & { preload: () => Promise<void> };
}

export const CandidatePool = eager(() =>
  import('./CandidatePool').then((m) => ({ default: m.CandidatePool })),
);
export const CvReview = eager(() => import('./CvReview').then((m) => ({ default: m.CvReview })));
export const Report = eager(() => import('./Report').then((m) => ({ default: m.Report })));
export const Home = eager(() => import('./Home').then((m) => ({ default: m.Home })));
/** The page viewer, shown inside the CV review. */
export const PdfPages = eager(() => import('./PdfPages'));

/**
 * Start fetching the file for the screen the address points at, before the app has finished
 * signing in, so the file arrives while the first requests are on their way (PF-03).
 */
export function preloadFor(hash: string): void {
  const route = hash.replace(/^#/, '');
  // A file that cannot be fetched now is asked for again when the screen needs it, where the page's
  // error boundary shows the reload note; a failed head start must not be an uncaught error (SH-10).
  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);
  if (route === '' || route === '/')
    quiet(Home.preload()); // the landing page is Home
  else if (route.startsWith('/cv/')) {
    quiet(CvReview.preload());
    quiet(PdfPages.preload()); // the page viewer, which the review screen would otherwise ask for last
  } else if (route === '/candidates' || /^\/vacancies\/[0-9A-Z]{26}$/.test(route))
    quiet(CandidatePool.preload());
}
