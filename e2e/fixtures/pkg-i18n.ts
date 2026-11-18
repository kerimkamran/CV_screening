import type { Locator, Page } from '@playwright/test';
import { ADMIN_ANSWERS, MFA_OFF } from './pkg-a';
import { vacApi, vrow, vview } from './pkg-c';
import { poolAnswer, SENAI_H } from './pkg-h';

/**
 * Language I18 and Accessibility A11 (layer L1): the recruiter app with every screen answered, and the
 * measurements the I18-08 case reads (does a long Azerbaijani label fit its box, do the header
 * controls overlap). Every person and company here is invented.
 */

/** Answers every screen of the recruiter app needs (L1), SenAI on with the rows' features. */
export async function recruiterApp(
  page: Page,
  o: { me?: Record<string, unknown>; ask?: unknown; extraRows?: unknown[] } = {},
) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const table: Record<string, unknown> = {
    ...ADMIN_ANSWERS,
    '/reports/mine': { reports: [] },
    '/auth/mfa': MFA_OFF,
    '/assistant/preferences': { top: null },
    '/me/preferences': {},
    '/assistant/conversations': [],
  };
  const { seen } = await vacApi(page, {
    me: o.me,
    assistant: SENAI_H,
    list: [
      vrow(),
      vrow({ id: '01K0000000000000000000000W', title: 'Network Engineer 2', status: 'draft' }),
      ...(o.extraRows ?? []),
    ],
    views: [vview()],
    extra: async (route, url, method) => {
      const p = url.pathname;
      if (p === '/assistant/ask' && method === 'POST')
        return route
          .fulfill({
            json: o.ask ?? {
              conversationId: '01K00000000000000000000CNV',
              messageId: '01K00000000000000000000MSG',
              answer: poolAnswer(3),
            },
          })
          .then(() => true);
      if (/^\/screenings\/\w+\/assistant$/.test(p))
        return route.fulfill({ json: { thread: null } }).then(() => true);
      const a = table[p];
      if (a !== undefined) return route.fulfill({ json: a }).then(() => true);
      return false;
    },
  });
  return seen;
}

/**
 * Controls whose own text does not fit them: text running outside the control's box, clipped by its
 * own overflow, or a control sticking out of the screen (a scroller is allowed to). `scope` limits the
 * search to one part of the page. One line per finding, "label: what".
 */
export async function fits(page: Page, scope?: Locator): Promise<string[]> {
  return (scope ?? page.locator('body')).evaluate((root) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const sel =
      'button, a[href], summary, [role=tab], [role=button], [data-chip], [data-testid$="chip"]';
    const els = [...root.querySelectorAll<HTMLElement>(sel)];
    if (root.matches(sel)) els.unshift(root as HTMLElement);
    const visible = (e: HTMLElement) => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      const cv = (e as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
      if (cv && !cv.call(e, { checkOpacity: true, checkVisibilityCSS: true })) return false;
      return (
        r.width > 2 &&
        r.height > 2 &&
        st.visibility !== 'hidden' &&
        st.display !== 'none' &&
        !e.closest('[aria-hidden=true], .sr-only, details:not([open]) > :not(summary)')
      );
    };
    const label = (e: HTMLElement) =>
      (e.getAttribute('aria-label') || e.innerText || e.tagName)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 44);
    for (const e of els) {
      if (!visible(e)) continue;
      const r = e.getBoundingClientRect();
      const scroller = e.closest('.overflow-x-auto, [class*="overflow-x-"]');
      if (!scroller && (r.right > vw + 1 || r.left < -1))
        out.push(
          `${label(e)}: sticks out of the screen (${Math.round(r.left)} to ${Math.round(r.right)} of ${vw} px)`,
        );
      const text = (e.innerText ?? '').trim();
      if (!text) continue;
      const st = getComputedStyle(e);
      // A title or name cut with an ellipsis is data shown short on purpose (OVF asks for its tooltip).
      if (st.textOverflow === 'ellipsis' || e.closest('.truncate')) continue;
      const clips = (v: string) => v !== 'visible';
      if (
        (clips(st.overflowX) && e.scrollWidth > e.clientWidth + 1) ||
        (clips(st.overflowY) && e.scrollHeight > e.clientHeight + 1)
      )
        out.push(
          `${label(e)}: clipped by its own box (${e.scrollWidth}×${e.scrollHeight} in ${e.clientWidth}×${e.clientHeight})`,
        );
      // The box of the text that can be seen (screen-reader-only text is not on screen).
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      const range = document.createRange();
      const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!(n.textContent ?? '').trim() || n.parentElement?.closest('.sr-only')) continue;
        range.selectNodeContents(n);
        for (const q of range.getClientRects()) {
          if (q.width <= 0) continue;
          left = Math.min(left, q.left);
          right = Math.max(right, q.right);
          top = Math.min(top, q.top);
          bottom = Math.max(bottom, q.bottom);
        }
      }
      if (
        right > left &&
        (right > r.right + 1.5 ||
          left < r.left - 1.5 ||
          bottom > r.bottom + 1.5 ||
          top < r.top - 1.5)
      )
        out.push(
          `${label(e)}: its text runs outside the box (text ${Math.round(left)}–${Math.round(right)} × ${Math.round(top)}–${Math.round(bottom)}, box ${Math.round(r.left)}–${Math.round(r.right)} × ${Math.round(r.top)}–${Math.round(r.bottom)})`,
        );
    }
    return [...new Set(out)];
  });
}

/** Pairs of visible controls in the header that overlap (the Ask bar and the account menu, say). */
export async function headerOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const head = document.querySelector('header');
    if (!head) return ['no header'];
    const els = [
      ...head.querySelectorAll<HTMLElement>(
        'a[href], button, summary, input, select, [role=search]',
      ),
    ].filter((e) => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      return (
        r.width > 2 &&
        r.height > 2 &&
        st.visibility !== 'hidden' &&
        st.display !== 'none' &&
        !e.closest('.sr-only, details:not([open]) > :not(summary)')
      );
    });
    const name = (e: HTMLElement) =>
      (e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.innerText || e.tagName)
        .trim()
        .slice(0, 30);
    const out: string[] = [];
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i]!;
        const b = els[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 1 && h > 1)
          out.push(`"${name(a)}" overlaps "${name(b)}" by ${Math.round(w)}×${Math.round(h)} px`);
      }
    return out;
  });
}

/**
 * The phone bottom bar: how many lines each item's label takes, the items' heights and boxes. Null
 * when the bar is not shown (wider screens have the rail instead).
 */
export async function bottomBar(page: Page) {
  return page.evaluate(() => {
    const navs = [...document.querySelectorAll<HTMLElement>('nav')].filter(
      (n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().height > 0,
    );
    const nav = navs.at(-1);
    if (!nav) return null;
    const items = [...nav.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
    return {
      width: nav.getBoundingClientRect().width,
      items: items.map((it) => {
        const r = it.getBoundingClientRect();
        // Lines of the label: the distinct tops of the text's own boxes.
        const range = document.createRange();
        const tops = new Set<number>();
        const w = document.createTreeWalker(it, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!(n.textContent ?? '').trim()) continue;
          range.selectNodeContents(n);
          for (const q of range.getClientRects()) if (q.width > 0) tops.add(Math.round(q.top));
        }
        return {
          label: (it.innerText || it.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '),
          left: r.left,
          right: r.right,
          top: r.top,
          height: r.height,
          lines: tops.size,
          overflowX: it.scrollWidth > it.clientWidth + 1,
        };
      }),
    };
  });
}
