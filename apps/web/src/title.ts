import { BRAND_FULL } from './brand';
import { retitle } from './done-signals';

/**
 * Every screen names itself in the tab: "<the page's heading> · parallax by Azerconnect Group"
 * (WCAG 2.4.2, A11-02). The heading is read from the page after it renders and whenever it changes,
 * so a screen needs no title code of its own. Returns the function that stops watching.
 */
export function trackPageTitle(): () => void {
  let queued = false;
  const update = () => {
    queued = false;
    const h1 = document.querySelector('main h1')?.textContent?.replace(/\s+/g, ' ').trim();
    retitle(h1 ? `${h1} · ${BRAND_FULL}` : BRAND_FULL);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  const watch = new MutationObserver(schedule);
  watch.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('hashchange', schedule);
  schedule();
  return () => {
    watch.disconnect();
    window.removeEventListener('hashchange', schedule);
  };
}
