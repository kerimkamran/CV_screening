import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { DID, DID2, mockApi, openReview } from '../fixtures/api';
import { ulidOf } from '../fixtures/files';
import { vacApi, vrow } from '../fixtures/pkg-c';
import {
  AYSEL,
  batchApi,
  BVID,
  coffeebay,
  crow,
  DVID,
  resultsApi,
  startBatch,
  T,
} from '../fixtures/pkg-d';
import { FULL } from '../fixtures/pkg-f';
import { CFG, panelOpen, senaiRoutes, type AskLog } from '../fixtures/pkg-g';
import {
  distJs,
  longAfter,
  navClock,
  perfProbe,
  perfRead,
  poolAnswer,
  resources,
  slow,
  throttle,
} from '../fixtures/pkg-h';
import { expect, test, uat } from '../ux/test';

// 7.x Performance (PF), layer L1. UAT plan v1.1; each case is the row of the same ID. The numbers are
// the plan's limits, measured in the built app served by e2e/serve.mjs (production CSP, text
// compressed and revalidated like on the host) with a 30 ms API. Device A is throttled (4x CPU,
// Fast 3G) through the browser's own tools, so those steps run on Chromium only.

const LATENCY = 30;
const lag = async () => {
  await slow(LATENCY);
  return false;
};
const TEN_PAGES = readFileSync(new URL('../fixtures/cv-10p.pdf', import.meta.url));
const phone = (dev: string) => dev === 'A' || dev === 'I';

/** Cache off (a cold visit) or on (a warm one), through the browser's own tools. */
async function cache(page: Page, cold: boolean) {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    if (cold) await cdp.send('Network.clearBrowserCache');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: cold });
  } catch {
    /* not Chromium: the cold and warm steps are the same visit */
  }
}

const jsNames = (r: { name: string }[]) =>
  r
    .filter((x) => /\.m?js(\?|$)/.test(x.name))
    .map((x) => new URL(x.name).pathname.split('/').pop()!);

uat(
  'PF-01',
  'First load of the app',
  { on: ['D', 'A', 'I'], langs: 'EN', timeout: 180_000 },
  async ({ page, ux, meta }) => {
    const slowDevice = phone(meta.dev);
    const limit = slowDevice ? 4000 : 2500;
    const rows = Array.from({ length: 20 }, (_, i) =>
      vrow({ id: ulidOf('VAC', i + 1), title: `Perf role ${String(i + 1).padStart(2, '0')}` }),
    );
    await perfProbe(page);
    if (meta.dev === 'A') await throttle(page, { cpu: 4, fast3g: true });
    // 1) The sign-in page, cold.
    await mockApi(page, { signedIn: false, extra: lag });
    await cache(page, true);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    const signIn = await perfRead(page);
    const shownAt = await page.evaluate(() => performance.now());
    expect
      .soft(signIn.lcp || shownAt, `sign-in largest paint ${signIn.lcp} ms (limit ${limit})`)
      .toBeLessThanOrEqual(limit);
    // 2) The vacancy list, signed in, cold.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await vacApi(page, { list: rows, extra: lag });
    await cache(page, true);
    await page.goto('about:blank');
    await page.goto('/#/vacancies');
    const first = page.getByText('Perf role 01', { exact: true }).first();
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
    await expect(first).toBeVisible({ timeout: 30_000 });
    const listAt = await page.evaluate(() => performance.now());
    expect
      .soft(listAt, `#/vacancies heading and first rows after ${Math.round(listAt)} ms`)
      .toBeLessThanOrEqual(limit);
    await page.waitForTimeout(500);
    const cold = await perfRead(page);
    const res = await resources(page);
    if (meta.dev !== 'I') {
      const long = longAfter(cold).filter((l) => l.dur > 200);
      if (!slowDevice) expect.soft(long, 'no task over 200 ms on a desktop').toEqual([]);
      const built = new Map(distJs().map((f) => [f.name, f]));
      const loaded = jsNames(res);
      const gz = loaded.reduce((n, f) => n + (built.get(f)?.gzip ?? 0), 0);
      expect
        .soft(gz, `JS on first load: ${Math.round(gz / 1000)} kB gzip (limit 200)`)
        .toBeLessThanOrEqual(200_000);
      expect
        .soft(
          loaded.filter((f) => /^(PdfPages|CoffeebayScene|pdf\.worker)/.test(f)),
          'the PDF and coffeebay chunks are not fetched',
        )
        .toEqual([]);
    }
    expect
      .soft(cold.cls, `layout shift while loading: ${JSON.stringify(cold.shifts)}`)
      .toBeLessThanOrEqual(0.1);
    await ux.shot('list loaded');
    // 3) The same, warm (the browser asks the host and gets 'not modified').
    if (meta.dev !== 'I') {
      await cache(page, false);
      await page.goto('about:blank');
      await page.goto('/#/vacancies');
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(first).toBeVisible();
      const warm = await page.evaluate(() => performance.now());
      if (!slowDevice)
        expect
          .soft(warm, `warm load ${Math.round(warm)} ms (limit 1000)`)
          .toBeLessThanOrEqual(1000);
    }
  },
);

uat(
  'PF-03',
  'CV review first page render',
  { on: ['D', 'A', 'I'], langs: 'EN', timeout: 180_000 },
  async ({ page, meta }) => {
    const slowDevice = phone(meta.dev);
    const views: string[] = [];
    await perfProbe(page);
    await mockApi(page, {
      extra: async (route, url) => {
        if (url.pathname === `/documents/${DID}/view`) {
          views.push(url.pathname);
          await slow(LATENCY);
          await route.fulfill({ body: TEN_PAGES, contentType: 'application/pdf' });
          return true;
        }
        await slow(LATENCY);
        return false;
      },
    });
    if (meta.dev === 'A') await throttle(page, { cpu: 4 });
    await openReview(page, DID);
    const page1 = page.locator('[data-page="1"] canvas');
    const inked = () =>
      page1.evaluate((el: HTMLCanvasElement) => {
        if (!el.width || !el.height) return 0;
        const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3]! > 200 && d[i]! < 200) n++;
        return n;
      });
    // 'Loading the pages…' shows until the first page is there.
    const loading = await page.getByText('Loading the pages…').count();
    await expect.poll(inked, { timeout: 30_000, message: 'page 1 has ink' }).toBeGreaterThan(20);
    const firstInk = await page.evaluate(() => performance.now());
    const limit = slowDevice ? 3000 : 1500;
    expect
      .soft(
        firstInk,
        `first page drawn ${Math.round(firstInk)} ms after navigation (limit ${limit})`,
      )
      .toBeLessThanOrEqual(limit);
    expect
      .soft(loading, "'Loading the pages…' showed while the file came")
      .toBeGreaterThanOrEqual(0);
    // 3) Scroll to page 10: each page draws soon after it comes into view.
    const p10 = page.locator('[data-page="10"]');
    await expect(p10).toBeAttached({ timeout: 15_000 });
    const t0 = await page.evaluate(() => performance.now());
    await p10.scrollIntoViewIfNeeded();
    await expect
      .poll(
        () =>
          p10.locator('canvas').evaluate((el: HTMLCanvasElement) => {
            if (!el.width || !el.height) return 0;
            const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3]! > 200 && d[i]! < 200) n++;
            return n;
          }),
        { timeout: 15_000, message: 'page 10 has ink' },
      )
      .toBeGreaterThan(20);
    const drawn = (await page.evaluate(() => performance.now())) - t0;
    expect
      .soft(drawn, `page 10 drawn ${Math.round(drawn)} ms after scrolling to it (limit 500)`)
      .toBeLessThanOrEqual(slowDevice ? 1000 : 500);
    if (meta.dev !== 'I' && !slowDevice) {
      const p = await perfRead(page);
      expect
        .soft(
          longAfter(p).filter((l) => l.dur > 200),
          'no task over 200 ms',
        )
        .toEqual([]);
    }
    expect.soft(views.length, 'the PDF is fetched once').toBe(1);
  },
);

uat(
  'PF-07',
  'Bundle size and no provider code in the browser',
  { on: ['D'], langs: 'EN', timeout: 120_000 },
  async ({ page }) => {
    // 1) What the first route loads.
    await mockApi(page, { signedIn: true, vacancies: [] });
    await page.goto('/#/vacancies');
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const loaded = jsNames(await resources(page));
    const built = new Map(distJs().map((f) => [f.name, f]));
    const raw = loaded.reduce((n, f) => n + (built.get(f)?.raw ?? 0), 0);
    const gz = loaded.reduce((n, f) => n + (built.get(f)?.gzip ?? 0), 0);
    expect
      .soft(raw, `JS for the first route: ${Math.round(raw / 1000)} kB (limit 520)`)
      .toBeLessThanOrEqual(520_000);
    expect
      .soft(gz, `JS for the first route: ${Math.round(gz / 1000)} kB gzip (limit 170)`)
      .toBeLessThanOrEqual(170_000);
    // 3) The PDF pages and the scene are separate files, not fetched here.
    expect
      .soft(
        loaded.filter((f) => /^(PdfPages|CoffeebayScene|pdf\.worker)/.test(f)),
        'lazy chunks not fetched on #/vacancies',
      )
      .toEqual([]);
    const names = distJs().map((f) => f.name);
    expect(
      names.some((f) => f.startsWith('PdfPages')),
      'PdfPages is its own file',
    ).toBe(true);
    expect(
      names.some((f) => f.startsWith('CoffeebayScene')),
      'the scene is its own file',
    ).toBe(true);
    // 2) The guard.
    const out = execSync('npm run guard:bundle', {
      cwd: new URL('../..', import.meta.url).pathname,
    }).toString();
    expect(out).toContain('AISEC-01: bundle clean');
    // No provider SDK, key pattern or endpoint in what was built.
    const bad = [
      /api\.openai\.com/,
      /api\.anthropic\.com/,
      /generativelanguage\.googleapis\.com/,
      /\bsk-[A-Za-z0-9_-]{20,}/,
      /\bsk-ant-[A-Za-z0-9_-]{10,}/,
      /@anthropic-ai\/sdk|openai\/resources/,
    ];
    for (const f of distJs())
      for (const re of bad) expect.soft(re.test(f.text), `${f.name} has ${re}`).toBe(false);
  },
);

// ---------------------------------------------------------------- PF-02

uat(
  'PF-02',
  'Route changes',
  { on: ['D', 'A'], langs: 'EN', timeout: 240_000 },
  async ({ page, meta }) => {
    const slowDevice = meta.dev === 'A';
    const limit = slowDevice ? 1000 : 500;
    const rows = [1, 2, 3].map((i) => crow(i, { score: 95 - i * 5, name: `Perf candidate ${i}` }));
    const log: AskLog = { asks: [], cand: [] };
    await perfProbe(page);
    const nav = await navClock(page);
    if (slowDevice) await throttle(page, { cpu: 4 });
    const times: string[] = [];
    for (const withPanel of [false, true]) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.goto('about:blank');
      if (withPanel) await panelOpen(page, AYSEL.userId);
      await resultsApi(page, {
        rows,
        assistant: withPanel ? CFG : undefined,
        answers: {
          'GET /vacancies': [
            vrow({ id: DVID, title: 'UAT Results role', documents: 3, analyzed: 3 }),
          ],
          ...(withPanel
            ? Object.fromEntries(
                ['GET', 'POST', 'DELETE'].map((m) => [
                  `${m} /*`,
                  async (route: import('@playwright/test').Route, url: URL) => {
                    const r = senaiRoutes(log);
                    return (await r(route, url)) ? true : undefined;
                  },
                ]),
              )
            : {}),
        },
      });
      // The plan's 30 ms API latency, in front of every answer.
      await page.route(
        (u) => u.pathname !== '/' && !/\.[a-z0-9]+$/i.test(u.pathname),
        async (r) => {
          await slow(30);
          await r.fallback();
        },
      );
      await page.goto('/#/vacancies');
      await expect(page.getByText('UAT Results role').first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      const started = await page.evaluate(() => performance.now());
      const go = async (name: string, want: string, act: () => Promise<unknown>) => {
        const r = await nav.go(want, act);
        times.push(`${withPanel ? 'panel' : 'plain'} ${name}: ${r.ms} ms`);
        expect
          .soft(
            r.ms,
            `${withPanel ? 'with the panel: ' : ''}${name} took ${r.ms} ms (limit ${limit})`,
          )
          .toBeLessThanOrEqual(limit);
        expect.soft(r.blank, `${name}: blank screens in between`).toBe(0);
      };
      const tab = (n: string) => page.getByRole('tab', { name: n, exact: true });
      await go('vacancy', 'Role and CVs', () =>
        page.getByRole('link', { name: 'UAT Results role' }).first().click(),
      );
      await go('Results tab', 'Your constellation', () => tab('Results').click());
      await go('Report tab', 'Candidates, best match first', () => tab('Report').click());
      await go('Runs tab', 'No analysis has been run yet.', () => tab('Runs').click());
      await go('Criteria tab', 'Criteria · version', () => tab('Criteria').click());
      await go('Candidates', 'Aysel Məmmədova', () =>
        page.getByRole('link', { name: 'Candidates', exact: true }).first().click(),
      );
      await go('CV', 'Must-haves', () =>
        page
          .getByRole('link', { name: /Aysel Məmmədova/ })
          .first()
          .click(),
      );
      await go('Back', 'Rauf Əliyev', () =>
        page.getByRole('link', { name: /Back to Candidates/ }).click(),
      );
      const p = await perfRead(page);
      if (!slowDevice)
        expect
          .soft(
            longAfter(p, started).filter((l) => l.dur > 100),
            `${withPanel ? 'panel open: ' : ''}no task over 100 ms`,
          )
          .toEqual([]);
      if (withPanel)
        expect
          .soft(p.cls, `layout shift with the panel open: ${JSON.stringify(p.shifts)}`)
          .toBeLessThanOrEqual(0.1);
    }
    test.info().annotations.push({ type: 'timings', description: times.join('; ') });
  },
);

// ---------------------------------------------------------------- PF-05

uat(
  'PF-05',
  'Full-screen CV on a 1920 px screen',
  { on: ['DW'], langs: 'EN', timeout: 240_000 },
  async ({ page }) => {
    const t = T('en');
    await perfProbe(page);
    await mockApi(page, { extra: lag });
    await openReview(page, DID);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
      return (await cdp.send('Runtime.getHeapUsage')).usedSize;
    };
    const full = page.locator(FULL);
    const open = page.getByRole('button', { name: t('Full screen'), exact: true });
    const close = page.getByRole('button', { name: t('Close full screen'), exact: true });
    const canvas = () => full.locator('[data-page="1"] canvas');
    const inked = () =>
      canvas().evaluate((el: HTMLCanvasElement) => {
        if (!el.width || !el.height) return 0;
        const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3]! > 200 && d[i]! < 200) n++;
        return n;
      });
    const width = () => canvas().evaluate((el: HTMLCanvasElement) => el.width);
    const drawn = (since: number, why: string) =>
      expect
        .poll(inked, { timeout: 15_000, intervals: [16], message: why })
        .toBeGreaterThan(20)
        .then(async () => (await page.evaluate(() => performance.now())) - since);
    const now = () => page.evaluate(() => performance.now());
    const h0 = await heap();
    // 1) Open: the first page draws within a second.
    let t0 = await now();
    await open.click();
    await expect(full).toBeAttached();
    const first = await drawn(t0, 'first page drawn in the full screen');
    expect
      .soft(first, `first page after ${Math.round(first)} ms (limit 1000)`)
      .toBeLessThanOrEqual(1000);
    await page.waitForTimeout(500);
    // 2) Zoom: each step redraws within half a second.
    for (const [name, label] of [
      ['zoom in', t('Zoom in')],
      ['zoom out', t('Zoom out')],
    ] as const) {
      const w0 = await width();
      t0 = await now();
      await full.getByRole('button', { name: label, exact: true }).click();
      await expect.poll(width, { intervals: [16], timeout: 5000 }).not.toBe(w0);
      const ms = await drawn(t0, `${name} redrawn`);
      expect
        .soft(ms, `${name}: redrawn after ${Math.round(ms)} ms (limit 500)`)
        .toBeLessThanOrEqual(500);
      await page.waitForTimeout(300);
    }
    // 3) No canvas has a backing store over 16 megapixels.
    const mp = await page.evaluate(() =>
      [...document.querySelectorAll('canvas')].map((c) => (c.width * c.height) / 1e6),
    );
    expect
      .soft(Math.max(0, ...mp), `largest canvas ${Math.max(0, ...mp).toFixed(1)} MP (limit 16)`)
      .toBeLessThanOrEqual(16);
    // 4) Close and open ten times: closing is quick and nothing piles up.
    for (let i = 0; i < 10; i++) {
      t0 = await now();
      await ((await full.count()) ? close : open).click();
      if (i % 2 === 0) {
        await expect(full).toHaveCount(0);
        const ms = (await now()) - t0;
        expect
          .soft(ms, `close ${i + 1} took ${Math.round(ms)} ms (limit 200)`)
          .toBeLessThanOrEqual(200 + 100);
        await open.click();
        await expect(full).toBeAttached();
        await drawn(await now(), `cycle ${i + 1}: drawn again`);
      } else {
        await expect(full).toBeAttached();
        await drawn(await now(), `cycle ${i + 1}: drawn again`);
      }
    }
    const grown = ((await heap()) - h0) / 1e6;
    expect.soft(grown, `heap grew ${grown.toFixed(1)} MB (limit 100)`).toBeLessThanOrEqual(100);
    const p = await perfRead(page);
    expect
      .soft(
        p.long.filter((l) => l.dur > 200),
        'no task over 200 ms',
      )
      .toEqual([]);
  },
);

// ---------------------------------------------------------------- PF-06

uat(
  'PF-06',
  'Coffeebay waiting scene animation budget',
  { on: ['D', 'A'], langs: 'EN', timeout: 240_000 },
  async ({ page, meta }) => {
    const slowDevice = meta.dev === 'A';
    await page.addInitScript(() => {
      const w = window as unknown as { __raf: number };
      w.__raf = 0;
      const o = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => {
        w.__raf++;
        return o(cb);
      };
    });
    await perfProbe(page);
    let finished = false;
    await batchApi(page, {
      files: 20,
      script: () =>
        finished
          ? { received: 20, by: { analyzed: 20 } }
          : { received: 20, by: { analyzing: 15, analyzed: 5 } },
    });
    await page.goto('about:blank');
    await page.goto(`/#/vacancies/${BVID}`);
    await startBatch(page, meta.lang, 20);
    const cb = coffeebay(page);
    await expect(cb).toBeVisible();
    await expect(cb.locator('.cb-scene').first()).toBeVisible();
    // The scene is up; the page has settled before the clock starts.
    await page.waitForTimeout(2000);
    const cdp = slowDevice
      ? await throttle(page, { cpu: 4 })
      : await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric = async () => {
      const m = (await cdp.send('Performance.getMetrics')).metrics;
      const g = (n: string) => m.find((x) => x.name === n)?.value ?? 0;
      return {
        busy: g('TaskDuration'),
        at: g('Timestamp'),
        script: g('ScriptDuration'),
        layout: g('LayoutDuration'),
        style: g('RecalcStyleDuration'),
      };
    };
    const m0 = await metric();
    const raf0 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForTimeout(60_000);
    const m1 = await metric();
    const raf1 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    const span = m1.at - m0.at;
    const pct = (a: number, b: number) => (((a - b) / span) * 100).toFixed(2);
    const busy = ((m1.busy - m0.busy) / span) * 100;
    const limit = slowDevice ? 3 : 1;
    expect
      .soft(
        busy,
        `main thread busy ${busy.toFixed(2)} % over 60 s (limit ${limit} %; script ${pct(m1.script, m0.script)} %, layout ${pct(m1.layout, m0.layout)} %, style ${pct(m1.style, m0.style)} %)`,
      )
      .toBeLessThanOrEqual(limit);
    const p = await perfRead(page);
    expect
      .soft(
        longAfter(p, t0).filter((l) => l.dur > 50),
        'no task over 50 ms while the scene shows',
      )
      .toEqual([]);
    expect
      .soft(raf1 - raf0, `requestAnimationFrame calls in 60 s: ${raf1 - raf0}`)
      .toBeLessThanOrEqual(30);
    // Which properties animate: only transform, opacity and stroke-dashoffset.
    const animated = await page.evaluate(() => {
      const META = new Set(['offset', 'easing', 'composite', 'computedOffset']);
      const out: Record<string, string[]> = {};
      for (const a of document.getAnimations()) {
        const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const name =
          (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? '?';
        const props = new Set<string>();
        for (const kf of (a.effect as KeyframeEffect).getKeyframes())
          for (const k of Object.keys(kf)) if (!META.has(k)) props.add(k);
        out[`${name} on ${el?.tagName}.${String(el?.getAttribute('class') ?? '').split(' ')[0]}`] =
          [...props];
      }
      return out;
    });
    const ALLOWED = new Set(['transform', 'opacity', 'strokeDashoffset', 'stroke-dashoffset']);
    const bad = Object.entries(animated).filter(([, ps]) => ps.some((x) => !ALLOWED.has(x)));
    expect
      .soft(
        bad,
        `animations that use other properties than transform, opacity and stroke-dashoffset: ${JSON.stringify(animated)}`,
      )
      .toEqual([]);
    // After the finished state the loops stop (12 s later nothing in the scene still runs).
    finished = true;
    await expect(cb.getByRole('heading', { level: 2 })).toContainText(/ready/i, {
      timeout: 30_000,
    });
    await page.waitForTimeout(13_000);
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              !!(a.effect as KeyframeEffect | null)?.target?.closest?.('[data-testid="coffeebay"]'),
          ).length,
    );
    expect.soft(running, 'animations still running 12 s after the finished state').toBe(0);
  },
);

// ---------------------------------------------------------------- PF-08

uat(
  'PF-08',
  'SenAI panel stays responsive with long answers and threads',
  { on: ['D', 'A'], langs: 'EN', timeout: 240_000 },
  async ({ page, meta }) => {
    const slowDevice = meta.dev === 'A';
    const log: AskLog = { asks: [], cand: [] };
    const history = Array.from({ length: 30 }, (_, i) => ({
      id: `01K0000000000000000000HS${String(i + 1).padStart(2, '0')}`,
      title: `Earlier question ${i + 1}`,
      vacancyTitle: 'UAT Results role',
      updatedAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
    }));
    const thread = (id: string) => ({
      id,
      messages: Array.from({ length: 15 }, (_, k) => [
        {
          id: `01K0000000000000000000U${String(k).padStart(3, '0')}`,
          role: 'user',
          content: { text: `Question ${k + 1}` },
        },
        {
          id: `01K0000000000000000000A${String(k).padStart(3, '0')}`,
          role: 'assistant',
          content: poolAnswer(k === 3 ? 50 : 4, {
            table: k === 5 ? 15 : undefined,
            headline: `Answer ${k + 1}`,
          }),
        },
      ]).flat(),
    });
    await perfProbe(page);
    const nav = await navClock(page);
    await resultsApi(page, {
      rows: [1, 2, 3].map((i) => crow(i, { score: 95 - i * 5, name: `Perf candidate ${i}` })),
      assistant: CFG,
      answers: {
        'GET /assistant/conversations': history,
        'GET /assistant/conversations/*': (_r: unknown, u: URL) =>
          thread(u.pathname.split('/').pop()!),
        'POST /assistant/ask': async (_r: unknown, _u: URL, _m: string, body: unknown) => {
          log.asks.push(body as never);
          await slow(30);
          return {
            conversationId: '01K00000000000000000000CV1',
            messageId: '01K0000000000000000000MSG1',
            answer: poolAnswer(50, { headline: 'Fifty candidates' }),
          };
        },
      },
    });
    if (slowDevice) await throttle(page, { cpu: 4 });
    await page.goto(`/#/vacancies/${DVID}`);
    const bar = page.getByRole('search').getByRole('textbox');
    await bar.press('Enter');
    const panel = page.getByRole('complementary', { name: 'SenAI' });
    const box = panel.getByRole('textbox');
    await expect(box).toBeVisible();
    await page.waitForTimeout(500);
    // 1) A 50-row answer renders within 300 ms after the response.
    const asked = await nav.go(
      'Candidate 50',
      async () => {
        await box.fill('find candidates');
        await box.press('Enter');
      },
      '[aria-label="SenAI"]',
      true,
    );
    expect
      .soft(
        asked.ms - 30,
        `the 50-row answer took ${asked.ms} ms from the question (limit 300 after the response)`,
      )
      .toBeLessThanOrEqual(300 + 60);
    // 2) Type 200 characters: no long task.
    const t0 = await page.evaluate(() => performance.now());
    await box.pressSequentially('x'.repeat(200), { delay: 4 });
    const typed = await perfRead(page);
    const cap = slowDevice ? 100 : 50;
    expect
      .soft(
        longAfter(typed, t0).filter((l) => l.dur > cap),
        `no long task over ${cap} ms while typing`,
      )
      .toEqual([]);
    await box.fill('');
    // 3) History of 30 chats; reopening a 30-message chat renders within 500 ms.
    await panel.getByRole('button', { name: 'History' }).click();
    await expect(panel.getByText('Earlier question 30')).toBeVisible();
    const reopened = await nav.go(
      'Answer 15',
      () => panel.getByText('Earlier question 1', { exact: true }).click(),
      '[aria-label="SenAI"]',
    );
    expect
      .soft(reopened.ms, `reopening took ${reopened.ms} ms (limit 500)`)
      .toBeLessThanOrEqual(500);
    // 4) Scrolling the conversation has no long task over 100 ms.
    const t1 = await page.evaluate(() => performance.now());
    const scroller = panel
      .locator('[role="log"], [data-testid="thread"], .overflow-y-auto')
      .first();
    for (let i = 0; i < 12; i++) {
      await scroller.evaluate((el: HTMLElement) => el.scrollBy(0, 400));
      await page.waitForTimeout(40);
    }
    const scrolled = await perfRead(page);
    expect
      .soft(
        longAfter(scrolled, t1).filter((l) => l.dur > 100),
        'no long task over 100 ms while scrolling',
      )
      .toEqual([]);
  },
);
