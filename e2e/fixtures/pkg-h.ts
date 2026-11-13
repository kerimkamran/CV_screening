import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { AZ } from '../../apps/web/src/i18n/az';
import { SENAI_ON } from './api';

/**
 * Package H of the UAT (Language I18, Accessibility A11, Performance PF): helpers for layer L1 and
 * L2. Every person and company here is invented.
 */

// ------------------------------------------------------------------ language

/** The app's own wording: English sentence → Azerbaijani (apps/web/src/i18n), with {vars}. */
export function T(lang: 'en' | 'az') {
  return (en: string, vars?: Record<string, string | number>) => {
    const s = lang === 'az' ? (AZ[en] ?? en) : en;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The rows' SenAI config: every feature on except rediscovery and linkReview. */
export const SENAI_H = {
  ...SENAI_ON,
  features: { ...SENAI_ON.features, rediscovery: false, linkReview: false },
};

/** Words that make a string English (two or more of them, and no Azerbaijani letters). */
const EN_WORDS =
  /\b(the|and|of|to|for|with|your|you|this|that|is|are|no|not|yet|open|show|add|all|more|less|from|in|on|by|or|one|each|can|will|be|has|have|was|were|here|there|what|which|who|when|how|it|its|a|an|at|as|if|about|new|edit|delete|close|save|cancel|back|next|choose|select|find|search|sign|out|page|loading|candidates?|vacanc(y|ies)|reports?|shared|results?|analysis|settings|menu)\b/gi;
const AZ_LETTERS = /[əğıöüçşƏĞİÖÜÇŞ]/;

/**
 * Visible text, aria-labels, titles and placeholders that read as English on an Azerbaijani
 * screen: two or more common English words and no Azerbaijani letter. `allow` removes data
 * (names, file names, CV text, vacancy titles, the brand).
 */
export async function englishOnScreen(
  page: Page,
  allow: (string | RegExp)[] = [],
  scope?: Locator,
) {
  const texts: string[] = await (scope ?? page.locator('body')).evaluate((root) => {
    const out = new Set<string>();
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest('script, style, [translate=no], [lang]:not([lang^=az]):not(html)'))
        continue;
      const r = el.getBoundingClientRect();
      const sr = el.closest('.sr-only');
      if (!sr && (r.width === 0 || r.height === 0)) continue;
      const t = (n.textContent ?? '').trim();
      if (t.length > 3) out.add(t);
    }
    for (const el of root.querySelectorAll('[aria-label], [placeholder], [title]'))
      for (const a of ['aria-label', 'placeholder', 'title']) {
        const v = el.getAttribute(a)?.trim();
        if (v && v.length > 3) out.add(v);
      }
    return [...out];
  });
  const brand = [/parallax/i, /SenAI/, /Azerconnect/i, /Sən istə/];
  const data = [...allow, ...brand];
  return texts.filter((t) => {
    if (AZ_LETTERS.test(t)) return false;
    let rest = t;
    for (const a of data)
      rest =
        typeof a === 'string'
          ? rest.split(a).join(' ')
          : rest.replace(
              new RegExp(a.source, a.flags.includes('g') ? a.flags : `${a.flags}g`),
              ' ',
            );
    const hits = rest.match(EN_WORDS) ?? [];
    return (
      hits.length >= 2 ||
      (hits.length === 1 &&
        rest.trim().split(/\s+/).length <= 2 &&
        /^[A-Z][a-z]+( [a-z]+)?$/.test(rest.trim()))
    );
  });
}

// ------------------------------------------------------------------ keyboard and focus

/** The focused element: tag, accessible label and text, for messages. */
export const focused = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return 'body';
    return `${a.tagName.toLowerCase()}${a.getAttribute('role') ? `[role=${a.getAttribute('role')}]` : ''} "${(a.getAttribute('aria-label') || a.innerText || a.getAttribute('placeholder') || '').trim().slice(0, 40)}"`;
  });

/**
 * The focus indicator of the focused element: an outline or a box-shadow ring. Returns its
 * contrast against the page behind (≥ 3:1 wanted) or 0 when there is none.
 */
export const ringContrast = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { ring: false, contrast: 0, what: 'body' };
    const s = getComputedStyle(el);
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a] = m[1]!
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return { r: r!, g: g!, b: b!, a: a ?? 1 };
    };
    const lum = (c: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const bgOf = (e: Element | null): { r: number; g: number; b: number } => {
      for (let x = e; x; x = x.parentElement) {
        const c = parse(getComputedStyle(x).backgroundColor);
        if (c && c.a > 0.5) return c;
      }
      return { r: 255, g: 255, b: 255 };
    };
    let color: ReturnType<typeof parse> = null;
    if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) color = parse(s.outlineColor);
    if (!color && s.boxShadow && s.boxShadow !== 'none') {
      // The last colour of a Tailwind ring (offset first, ring last; the ring is the visible one).
      const all = [...s.boxShadow.matchAll(/rgba?\([^)]+\)/g)]
        .map((m) => parse(m[0]))
        .filter((c) => c && c.a > 0);
      color = all.length ? all[all.length - 1]! : null;
    }
    const what = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 30)}"`;
    if (!color) return { ring: false, contrast: 0, what };
    const bg = bgOf(el.parentElement);
    const l1 = lum(color);
    const l2 = lum(bg);
    return {
      ring: true,
      contrast: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100,
      what,
    };
  });

// ------------------------------------------------------------------ performance

/** Installs observers before the app loads: long tasks, layout shifts, LCP, paints. */
export async function perfProbe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __perf: { long: { start: number; dur: number }[]; cls: number; lcp: number };
    };
    w.__perf = { long: [], cls: 0, lcp: 0 };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          w.__perf.long.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[])
          if (!e.hadRecentInput) w.__perf.cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => {
        const es = l.getEntries();
        if (es.length) w.__perf.lcp = Math.round(es[es.length - 1]!.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      /* not supported */
    }
  });
}
export type Perf = { long: { start: number; dur: number }[]; cls: number; lcp: number };
export const perfRead = (page: Page) =>
  page.evaluate(() => (window as unknown as { __perf: Perf }).__perf);
/** Long tasks after `since` (ms on the page clock). */
export const longAfter = (p: Perf, since = 0) => p.long.filter((l) => l.start >= since);
export const now = (page: Page) => page.evaluate(() => performance.now());
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : NaN;
};

/** CPU throttling and Fast 3G through CDP (the plan's A profile). */
export async function throttle(
  page: Page,
  o: { cpu?: number; fast3g?: boolean },
): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  if (o.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu });
  if (o.fast3g) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 562.5,
      downloadThroughput: ((1.6 * 1024 * 1024) / 8) * 0.9,
      uploadThroughput: ((750 * 1024) / 8) * 0.9,
    });
  }
  return cdp;
}

/** Resources of the page: name, transfer and decoded size. */
export const resources = (page: Page) =>
  page.evaluate(() =>
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((r) => ({
      name: r.name,
      type: r.initiatorType,
      transfer: r.transferSize,
      decoded: r.decodedBodySize,
      dur: Math.round(r.duration),
    })),
  );

export const DIST = new URL('../../apps/web/dist/', import.meta.url).pathname;
/** The built JS files: name → raw and gzip size. */
export function distJs() {
  const dir = join(DIST, 'assets');
  return readdirSync(dir)
    .filter((f) => /\.(m?js)$/.test(f))
    .map((f) => {
      const buf = readFileSync(join(dir, f));
      return {
        name: f,
        raw: statSync(join(dir, f)).size,
        gzip: gzipSync(buf, { level: 9 }).length,
        text: buf.toString('utf8'),
      };
    });
}

/** A mock answer delayed by `ms` (the plan's 30 ms API latency). */
export const slow = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ SenAI pool answers

/** A pool answer (PoolPanel's PoolAnswer) with n candidate rows and an optional table. */
export function poolAnswer(n = 3, o: { table?: number; headline?: string } = {}) {
  return {
    kind: 'pool',
    headline: o.headline ?? `${n} candidates match BGP routing`,
    notes: [],
    vacancy: { id: '01K0000000000000000000000V', title: 'Network Engineer', status: 'open' },
    options: [],
    counts: { total: n, analyzed: n, shortlist: 0, outOfDate: 0 },
    rows: Array.from({ length: n }, (_, i) => ({
      matchId: `01KM00000000000000000${String(i + 1).padStart(5, '0')}`,
      documentId: `01KD00000000000000000${String(i + 1).padStart(5, '0')}`,
      label: `Candidate ${String(i + 1).padStart(2, '0')}`,
      score: 90 - (i % 40),
      band: i % 3 === 0 ? 'strong' : 'good',
      mustFound: 3,
      mustTotal: 4,
      decision: 'new',
      decisionLabel: 'New',
      outOfDate: false,
      strengths: ['BGP routing', 'OSPF'],
      missing: ['CCIE certification'],
    })),
    ...(o.table
      ? {
          table: {
            head: ['Requirement', 'Candidate 01', 'Candidate 02'],
            rows: Array.from({ length: o.table }, (_, i) => ({
              cells: [`Requirement ${i + 1}`, 'met', 'not found'],
              tag: 'must' as const,
            })),
          },
        }
      : {}),
    receipt: {
      read: 'Candidates with BGP routing',
      by: 'rules',
      sources: ['Network Engineer'],
      asOf: new Date().toISOString(),
    },
    used: [{ kind: 'skill', text: 'BGP routing' }],
    more: 0,
    asOf: new Date().toISOString(),
    suggestions: ['Who has OSPF?'],
    flags: [],
    language: 'en',
  };
}
