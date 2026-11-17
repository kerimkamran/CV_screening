import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { AZ } from '../../apps/web/src/i18n/az';

/**
 * The automatic UX checks of the UAT plan (section 3.2). Each check returns findings; a finding
 * has the plan's check code, a bug level and a short sentence. The test fixture (ux/test.ts) runs
 * them after a step and records every finding on the test, so the report can log bugs.
 */
export type Code = 'OCC' | 'OVL' | 'OVF' | 'TGT' | 'AXE' | 'KEY' | 'RM' | 'AZ' | 'ERR';
export type Level = 'S1' | 'S2' | 'S3' | 'S4';
export interface Finding {
  code: Code;
  level: Level;
  what: string;
  step?: string;
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * OCC: nothing covers what should be on top. For each open overlay (dialog, aria-modal, open
 * details menu, listbox, toast with role=status inside a fixed box), a grid of points inside it
 * must hit the overlay. For every visible button and link whose centre is on screen, the centre
 * must hit the control itself (or something inside it).
 */
export async function occ(page: Page, opts: { overlay?: string } = {}): Promise<Finding[]> {
  return page.evaluate((sel) => {
    const out: { code: 'OCC'; level: 'S1' | 'S2'; what: string }[] = [];
    const label = (el: Element) =>
      (
        (el as HTMLElement).getAttribute('aria-label') ||
        (el as HTMLElement).innerText ||
        el.tagName
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 60);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
      if (cv && !cv.call(el, { checkOpacity: true, checkVisibilityCSS: true })) return false;
      // Visually hidden helpers (sr-only: 1 px and clipped) are not on screen.
      if (r.width <= 2 || r.height <= 2) return false;
      if (st.clip && st.clip !== 'auto' && /rect\(0/.test(st.clip)) return false;
      if (st.clipPath && /inset\(50%\)/.test(st.clipPath)) return false;
      if (el.closest('details:not([open]) > :not(summary)')) return false;
      return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.01;
    };
    const overlays = [
      ...document.querySelectorAll<HTMLElement>(
        sel ||
          '[role=dialog], dialog[open], [aria-modal=true], details[open] > div, [role=menu], [role=listbox]',
      ),
    ]
      .filter(visible)
      // A disclosure that opens in place (More details) is page content, not an overlay.
      .filter(
        (o) =>
          !o.matches('details[open] > div') ||
          ['absolute', 'fixed'].includes(getComputedStyle(o).position),
      );
    for (const o of overlays) {
      const r = o.getBoundingClientRect();
      // Only the part that is not scrolled out of an ancestor scroller is on screen (a long menu that
      // scrolls inside itself is clipped there, not covered).
      let vl = r.left;
      let vt = r.top;
      let vr = r.right;
      let vb = r.bottom;
      for (let p = o.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (!/(auto|scroll|hidden|clip)/.test(ps.overflow + ps.overflowY + ps.overflowX)) continue;
        const pr = p.getBoundingClientRect();
        vl = Math.max(vl, pr.left);
        vt = Math.max(vt, pr.top);
        vr = Math.min(vr, pr.right);
        vb = Math.min(vb, pr.bottom);
      }
      // 12 px inside, so the rounded corners of an overlay (rounded-2xl) are not sampled.
      const x0 = Math.max(0, vl + 12);
      const y0 = Math.max(0, vt + 12);
      const x1 = Math.min(innerWidth - 1, vr - 12);
      const y1 = Math.min(innerHeight - 1, vb - 12);
      if (x1 <= x0 || y1 <= y0) continue;
      let bad = 0;
      let total = 0;
      let who = '';
      for (let i = 0; i <= 6; i++)
        for (let j = 0; j <= 6; j++) {
          if ((i === 0 || i === 6) && (j === 0 || j === 6)) continue;
          const x = x0 + ((x1 - x0) * i) / 6;
          const y = y0 + ((y1 - y0) * j) / 6;
          const hit = document.elementFromPoint(x, y);
          total++;
          if (hit && !o.contains(hit)) {
            bad++;
            if (!who) who = `${hit.tagName.toLowerCase()} "${label(hit)}"`;
          }
        }
      if (bad > 0)
        out.push({
          code: 'OCC',
          level: o.matches('[role=dialog], dialog, [aria-modal=true]') ? 'S1' : 'S2',
          what: `${bad}/${total} points of the open ${o.getAttribute('role') ?? o.tagName.toLowerCase()} "${label(o).slice(0, 40)}" hit another element, e.g. ${who}`,
        });
    }
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]',
      ),
    ].filter(visible);
    for (const c of controls) {
      const r = c.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      if (c.closest('[inert], [aria-hidden=true]')) continue;
      // Controls inside a scroller that is scrolled past are clipped, not covered.
      let clipped = false;
      for (let p = c.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(ps.overflow + ps.overflowY + ps.overflowX)) {
          const pr = p.getBoundingClientRect();
          if (y < pr.top || y > pr.bottom || x < pr.left || x > pr.right) clipped = true;
        }
      }
      if (clipped) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || c.contains(hit) || hit.contains(c)) continue;
      // Content scrolled under a fixed or sticky bar is out of view, not covered by a layout fault.
      // A sticky bar counts as pinned only while it is stuck; in its own place in the page it is
      // content like any other and scrolls out from under a fixed bar.
      const pinned = (el: Element | null) => {
        for (let p = el; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.position === 'fixed') return true;
          if (cs.position === 'sticky') {
            const top = parseFloat(cs.top);
            const bottom = parseFloat(cs.bottom);
            const r = p.getBoundingClientRect();
            // The offset applies to the margin box, so a bar with its own margin sits that much lower; a few
            // pixels more allow for a bar still settling from its entrance animation.
            const mt = parseFloat(cs.marginTop) || 0;
            const mb = parseFloat(cs.marginBottom) || 0;
            if (!Number.isNaN(top) && r.top <= top + mt + 4) return true;
            if (!Number.isNaN(bottom) && r.bottom >= innerHeight - bottom - mb - 4) return true;
          }
        }
        return false;
      };
      if (pinned(hit) && !pinned(c)) continue;
      // An open menu, list box or dialog is meant to cover what lies under it.
      const OPEN = 'details[open] > div, [role=menu], [role=listbox], dialog[open], [role=dialog]';
      // So is an overlay the test names on purpose (a phone's bottom sheet), which the loop above
      // already checked is not covered itself.
      const cover = hit.closest(sel ? `${OPEN}, ${sel}` : OPEN);
      if (cover && !cover.contains(c)) continue;
      // A label that wraps its own input counts as the control.
      if (c instanceof HTMLInputElement && hit.closest('label')?.contains(c)) continue;
      out.push({
        code: 'OCC',
        level: 'S2',
        what: `${c.tagName.toLowerCase()} "${label(c)}" is covered at its centre by ${hit.tagName.toLowerCase()} "${label(hit)}"`,
      });
    }
    return out;
  }, opts.overlay ?? '');
}

/** OVL: no two visible controls or text boxes overlap by more than 2 px. */
export async function ovl(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: { code: 'OVL'; level: 'S3'; what: string }[] = [];
    const els = [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, h1, h2, h3, label, p',
      ),
    ].filter((e) => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      const cv = (e as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
      if (cv && !cv.call(e, { checkOpacity: true, checkVisibilityCSS: true })) return false;
      if (e.closest('details:not([open]) > :not(summary)')) return false;
      return (
        r.width > 2 &&
        r.height > 2 &&
        st.visibility !== 'hidden' &&
        st.display !== 'none' &&
        r.bottom > 0 &&
        r.top < innerHeight &&
        !e.closest('[aria-hidden=true], .sr-only') &&
        !(st.position === 'absolute' && st.clip !== 'auto')
      );
    });
    const rects = els.map((e) => e.getBoundingClientRect());
    const name = (e: HTMLElement) =>
      (e.getAttribute('aria-label') || e.innerText || e.tagName).trim().slice(0, 40);
    for (let i = 0; i < els.length && out.length < 12; i++)
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i]!;
        const b = els[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        const ra = rects[i]!;
        const rb = rects[j]!;
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 2 && h > 2) {
          // Ignore elements that are visually separate layers on purpose (a fixed bar over content).
          const fa = getComputedStyle(a).position;
          const fb = getComputedStyle(b).position;
          if (fa === 'fixed' || fb === 'fixed') continue;
          out.push({
            code: 'OVL',
            level: 'S3',
            what: `${a.tagName.toLowerCase()} "${name(a)}" overlaps ${b.tagName.toLowerCase()} "${name(b)}" by ${Math.round(w)}×${Math.round(h)} px`,
          });
        }
      }
    return out;
  });
}

/** OVF: the page never scrolls sideways; clipped text has a tooltip or full accessible text. */
export async function ovf(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: { code: 'OVF'; level: 'S3'; what: string }[] = [];
    const d = document.documentElement;
    if (d.scrollWidth > d.clientWidth + 1)
      out.push({
        code: 'OVF',
        level: 'S3',
        what: `the page scrolls sideways (${d.scrollWidth} px content in a ${d.clientWidth} px window)`,
      });
    for (const e of document.querySelectorAll<HTMLElement>('body *')) {
      if (out.length > 12) break;
      const st = getComputedStyle(e);
      if (st.textOverflow !== 'ellipsis' || e.scrollWidth <= e.clientWidth + 1) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      const full = e.textContent?.trim() ?? '';
      const tip =
        e.title ||
        e.closest('[title]')?.getAttribute('title') ||
        e.getAttribute('aria-label') ||
        e.closest('[aria-label]')?.getAttribute('aria-label') ||
        '';
      if (!tip || !tip.includes(full.slice(0, 20)))
        out.push({
          code: 'OVF',
          level: 'S3',
          what: `text "${full.slice(0, 50)}" is cut off with no tooltip or accessible full text`,
        });
    }
    return out;
  });
}

/** TGT: every control is at least 24×24 px, and at least 44×44 px on touch screens. */
export async function tgt(page: Page, touch: boolean): Promise<Finding[]> {
  return page.evaluate((touch) => {
    const out: { code: 'TGT'; level: 'S3' | 'S4'; what: string }[] = [];
    for (const e of document.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type=hidden]), select, [role=button], [role=tab], summary',
    )) {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      if (r.width === 0 || r.height === 0 || st.visibility === 'hidden') continue;
      if (e.closest('.sr-only, [aria-hidden=true]')) continue;
      // An inline link in a sentence is exempt (WCAG 2.5.8 exception), as is a control whose
      // label makes the target bigger.
      if (e.tagName === 'A' && st.display === 'inline' && e.closest('p, li')) continue;
      let w = r.width;
      let h = r.height;
      const lab = e.closest('label');
      if (lab && (e as HTMLInputElement).type !== 'text') {
        const lr = lab.getBoundingClientRect();
        w = Math.max(w, lr.width);
        h = Math.max(h, lr.height);
      }
      const name = (e.getAttribute('aria-label') || e.innerText || e.tagName).trim().slice(0, 40);
      if (w < 24 || h < 24)
        out.push({
          code: 'TGT',
          level: 'S3',
          what: `"${name}" is ${Math.round(w)}×${Math.round(h)} px (under 24×24)`,
        });
      else if (touch && (w < 44 || h < 44))
        out.push({
          code: 'TGT',
          level: 'S4',
          what: `"${name}" is ${Math.round(w)}×${Math.round(h)} px on a touch screen (under 44×44)`,
        });
    }
    return out.slice(0, 40);
  }, touch);
}

/** AXE: axe-core WCAG 2.2 AA (contrast included); serious and critical rules are findings. */
export async function axe(page: Page, opts: { exclude?: string[] } = {}): Promise<Finding[]> {
  let b = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
  ]);
  for (const x of opts.exclude ?? []) b = b.exclude(x);
  const r = await b.analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      code: 'AXE' as const,
      level: 'S3' as const,
      what: `${v.id} (${v.impact}): ${short(v.help, 70)} — ${v.nodes.length} element(s), e.g. ${short(v.nodes[0]?.target.join(' ') ?? '', 60)}`,
    }));
}

/** RM: with reduced motion, nothing is animating once the page has settled. */
export async function rm(page: Page): Promise<Finding[]> {
  await page.waitForTimeout(400);
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty;
        return `${name} on ${t?.tagName.toLowerCase() ?? '?'}.${String(t?.className ?? '').slice(0, 30)}`;
      }),
  );
  return running.length
    ? [
        {
          code: 'RM',
          level: 'S3',
          what: `${running.length} animation(s) still run with reduced motion: ${short(running.slice(0, 3).join('; '), 140)}`,
        },
      ]
    : [];
}

/** English source strings that have an Azerbaijani translation (for the AZ check). */
const EN_WITH_AZ = new Set(
  Object.entries(AZ)
    .filter(([en, az]) => en.trim() && en !== az && /[a-z]{3}/i.test(en) && !en.includes('{'))
    .map(([en]) => en.trim()),
);

/** AZ: in Azerbaijani mode no visible text equals an English source string that has a translation. */
export async function az(page: Page): Promise<Finding[]> {
  const texts = await page.evaluate(() => {
    const out = new Set<string>();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (
        !el ||
        el.closest(
          'script, style, [aria-hidden=true], [translate=no], [lang]:not([lang^=az]):not(html)',
        )
      )
        continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const t = (n.textContent ?? '').trim();
      if (t.length > 2) out.add(t);
    }
    for (const el of document.querySelectorAll('[aria-label], [placeholder], [title]'))
      for (const a of ['aria-label', 'placeholder', 'title']) {
        const v = el.getAttribute(a)?.trim();
        if (v && v.length > 2) out.add(v);
      }
    return [...out];
  });
  const left = texts.filter((t) => EN_WITH_AZ.has(t));
  return left.length
    ? [
        {
          code: 'AZ',
          level: left.length > 8 ? 'S3' : 'S4',
          what: `English left on the Azerbaijani screen: ${short(
            left
              .slice(0, 6)
              .map((x) => `"${x}"`)
              .join(', '),
            200,
          )}`,
        },
      ]
    : [];
}

/** ERR: page errors, console errors, CSP violations and failed requests, collected while the test runs. */
export function watchErrors(page: Page, ignore: RegExp[] = []) {
  const found: Finding[] = [];
  const skip = (s: string) => ignore.some((r) => r.test(s));
  page.on('pageerror', (e) => {
    if (!skip(e.message))
      found.push({ code: 'ERR', level: 'S2', what: `page error: ${short(e.message, 160)}` });
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (skip(t)) return;
    const csp = /Content Security Policy|Refused to/i.test(t);
    // A failed request already shows as its own finding below.
    if (/Failed to load resource/i.test(t)) return;
    found.push({
      code: 'ERR',
      level: csp ? 'S2' : 'S3',
      what: `${csp ? 'CSP violation' : 'console error'}: ${short(t, 160)}`,
    });
  });
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    if (/ERR_ABORTED|aborted|cancel/i.test(why)) return; // aborted on purpose or by navigation
    const u = r.url();
    if (skip(u)) return;
    found.push({
      code: 'ERR',
      level: 'S3',
      what: `request failed: ${r.method()} ${short(u, 100)} (${why})`,
    });
  });
  return found;
}
