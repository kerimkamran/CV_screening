import type { Page } from '@playwright/test';
import { DID, openReview } from '../fixtures/api';
import {
  aysel,
  card,
  denseChecks,
  denseDoc,
  DID11,
  DID12,
  DID13,
  DID4,
  isTabs,
  leyla,
  longText,
  mockF,
  problemDoc,
  ready,
  req,
  showReq,
  stateDoc,
  T,
  toAnalysis,
} from '../fixtures/pkg-f';
import { expect, STD, uat } from '../ux/test';

// 7.19 The evidence map (EM-01 … EM-08): the strip beside the CV with one dot per found quote.

type Tr = ReturnType<typeof T>;
const mapNav = (page: Page, t: Tr) =>
  page.getByRole('navigation', { name: t('Where the requirements are in the CV') });
const dotsOf = (page: Page) =>
  page
    .getByTestId('evidence-map')
    .locator('button')
    .evaluateAll((bs) =>
      bs.map((b) => {
        const r = b.getBoundingClientRect();
        const nav = b.closest('nav')!.getBoundingClientRect();
        const inner = b.querySelector('span')!;
        return {
          name: b.getAttribute('aria-label') ?? '',
          title: b.getAttribute('title') ?? '',
          pressed: b.getAttribute('aria-pressed'),
          diamond: inner.className.includes('rotate-45'),
          round: inner.className.includes('rounded-full'),
          active: inner.className.includes('scale-150') && inner.className.includes('ring-2'),
          rel: (r.top + r.height / 2 - nav.top) / nav.height,
          box: {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          },
        };
      }),
    );
/** The map's "on screen" box against the element that scrolls the CV. */
const mapBox = (page: Page, scroller: string) =>
  page.evaluate((sel) => {
    const box = document.querySelector<HTMLElement>(
      '[data-testid=evidence-map] > span[aria-hidden]',
    );
    const sc = document.querySelector<HTMLElement>(sel)!;
    return {
      shown: !!box,
      top: box ? parseFloat(box.style.top) / 100 : null,
      height: box ? parseFloat(box.style.height) / 100 : null,
      wantTop: sc.scrollTop / sc.scrollHeight,
      wantHeight: Math.max(sc.clientHeight / sc.scrollHeight, 0.04),
      fits: sc.scrollHeight <= sc.clientHeight + 1,
    };
  }, scroller);

// ------------------------------------------------------------------ EM-01

uat(
  'EM-01',
  'One dot per found quote, with names, shapes and positions',
  { on: ['D', 'T'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    const base = aysel();
    const partly = aysel(
      {},
      {
        requirements: base.analysis.requirements.map((r: any) =>
          r.text === 'OSPF' ? { ...r, state: 'partly' } : r,
        ),
      },
    );
    await mockF(page, { docs: { [DID]: partly } });
    await openReview(page);
    await ready(page);
    const nav = mapNav(page, t);
    await expect(nav).toBeVisible();
    await expect.poll(async () => (await dotsOf(page)).length, { timeout: 8_000 }).toBe(4);
    const dots = await dotsOf(page);
    await info.attach('dots', {
      body: JSON.stringify(dots, null, 1),
      contentType: 'application/json',
    });
    const want = [
      t('{requirement}, page {n}', { requirement: 'BGP routing', n: 1 }),
      t('{requirement}, page {n}', { requirement: 'OSPF', n: 1 }),
      t('{requirement}, page {n}', { requirement: '5G transport experience', n: 1 }),
      t('{requirement}, page {n}', { requirement: '5G transport experience', n: 2 }),
    ];
    expect.soft(dots.map((d) => d.name).sort(), 'the 4 dots by name').toEqual([...want].sort());
    for (const d of dots) expect.soft(d.title, `'${d.name}' title`).toBe(d.name);
    for (const d of dots)
      if (d.name.startsWith('OSPF'))
        expect.soft(d.diamond, 'the partly dot is a diamond').toBe(true);
      else expect.soft(d.round && !d.diamond, `'${d.name}' is round`).toBe(true);
    for (const d of dots) {
      if (d.name.endsWith(' 1'))
        expect.soft(d.rel, `'${d.name}' sits in the top half`).toBeLessThan(0.5);
      else expect.soft(d.rel, `'${d.name}' sits in the bottom half`).toBeGreaterThan(0.5);
    }
    // Each dot within 3 % of its quote's position (the quote's mark, as a share of all the pages).
    const pos = async (text: string) => {
      await showReq(page, t, text);
      await expect(page.locator('[data-testid=pdf-mark]').first()).toBeAttached({ timeout: 8_000 });
      await page.waitForTimeout(300);
      return page.evaluate(() => {
        const pages = [...document.querySelectorAll('[data-page]')].map((p) =>
          p.getBoundingClientRect(),
        );
        const top = pages[0]!.top;
        const n = pages.length;
        return [...document.querySelectorAll('[data-testid=pdf-mark]')].map((m) => {
          const pg = Number(m.closest('[data-page]')!.getAttribute('data-page'));
          const pr = pages[pg - 1]!;
          const r = m.getBoundingClientRect();
          void top;
          return { page: pg, at: (pg - 1 + (r.top - pr.top) / pr.height) / n };
        });
      });
    };
    const spots: Record<string, number> = {};
    for (const text of ['BGP routing', 'OSPF', '5G transport experience']) {
      for (const s of await pos(text)) {
        const key = t('{requirement}, page {n}', { requirement: text, n: s.page });
        if (!(key in spots)) spots[key] = s.at;
      }
    }
    const after = await dotsOf(page);
    // 3 %, plus what the 24 px spacing between neighbouring dots (EM-06) may push one dot along.
    const stripH = (await nav.boundingBox())!.height;
    const tolerance = Math.max(0.03, 24 / stripH + 0.002);
    for (const d of after)
      if (d.name in spots)
        expect
          .soft(
            Math.abs(d.rel - spots[d.name]!),
            `'${d.name}' within ${(tolerance * 100).toFixed(1)} % of its quote (${d.rel.toFixed(3)} vs ${spots[d.name]!.toFixed(3)})`,
          )
          .toBeLessThanOrEqual(tolerance);
    const strip = await nav.evaluate((n) => {
      const body = document.querySelector('[data-testid=cv-body]')!.getBoundingClientRect();
      const r = n.getBoundingClientRect();
      return { w: r.width, h: r.height, bodyH: body.height };
    });
    expect.soft(strip.w, 'the strip is 20 px wide').toBeCloseTo(20, 0);
    expect
      .soft(Math.abs(strip.h - strip.bodyH), 'the strip is as tall as the CV body')
      .toBeLessThanOrEqual(1);
    if (meta.lang === 'az') {
      expect.soft(t('Where the requirements are in the CV')).toBe('Tələblərin CV-də yeri');
      expect.soft(want[3]).toBe('5G transport experience, səhifə 2');
    }
    await ux.check('evidence map', [...STD, 'AZ']);
    // No quotes: no map.
    const none = aysel(
      {},
      { requirements: base.analysis.requirements.map((r: any) => ({ ...r, anchors: [] })) },
    );
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockF(page, { docs: { [DID]: none } });
    await page.reload();
    await ready(page);
    await page.waitForTimeout(800);
    await expect
      .soft(page.getByTestId('evidence-map'), 'with no quotes there is no map')
      .toHaveCount(0);
  },
);

// ------------------------------------------------------------------ EM-02

uat(
  'EM-02',
  'A dot does the same as Show in CV',
  { on: ['D', 'T', 'A'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    const dot = (name: string) => mapNav(page, t).getByRole('button', { name, exact: true });
    await dot('5G transport experience, page 2').click();
    const p2 = page.locator('[data-page="2"]');
    await expect.soft(p2, 'page 2 flashes').toHaveClass(/ring-4/, { timeout: 1_500 });
    await expect
      .soft(page.locator('[data-page="2"] [data-testid=pdf-mark]').first(), 'marks on page 2')
      .toBeVisible();
    const inView = await p2.evaluate((p) => {
      const b = document.querySelector('[data-testid=cv-body]')!.getBoundingClientRect();
      const r = p.getBoundingClientRect();
      return r.bottom > b.top && r.top < b.bottom && r.bottom > 0 && r.top < innerHeight;
    });
    expect.soft(inView, 'page 2 scrolled into view').toBe(true);
    const dots = await dotsOf(page);
    for (const d of dots.filter((x) => x.name.startsWith('5G')))
      (expect.soft(d.pressed, `'${d.name}' is pressed`).toBe('true'),
        expect.soft(d.active, `'${d.name}' is larger with a ring`).toBe(true));
    for (const d of dots.filter((x) => !x.name.startsWith('5G')))
      expect.soft(d.pressed).toBe('false');
    // Reaching the page-2 dot at the bottom of the strip scrolls the window (it is below the fold at
    // 900 px), which slides the CV toolbar under the sticky Back/Previous/Next bar like any content;
    // the checks run with the window back at the top (the fold is noted in the triage as S4).
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await ux.check('dot pressed', STD);
    await toAnalysis(page, t);
    const c = card(page, '5G transport experience');
    await expect
      .soft(c.getByRole('button', { name: t('Hide in CV') }))
      .toHaveAttribute('aria-pressed', 'true');
    await c.getByRole('button', { name: t('Hide in CV') }).click();
    if (await isTabs(page, t))
      await expect
        .soft(
          page
            .getByRole('tablist', { name: t('View'), exact: true })
            .getByRole('tab', { name: t('CV'), exact: true }),
          "the view goes back to 'CV'",
        )
        .toHaveAttribute('aria-selected', 'true');
    await expect.soft(page.locator('[data-testid=pdf-mark]'), 'no mark after Hide').toHaveCount(0);
    expect
      .soft(
        (await dotsOf(page)).filter((d) => d.pressed === 'true').length,
        'no dot pressed after Hide',
      )
      .toBe(0);
    await dot('BGP routing, page 1').click();
    await expect
      .soft(
        page.locator('[data-page="1"] [data-testid=pdf-mark]').first(),
        'the marks move to page 1',
      )
      .toBeVisible();
    await expect.soft(page.locator('[data-page="2"] [data-testid=pdf-mark]')).toHaveCount(0);
  },
);

// ------------------------------------------------------------------ EM-03

uat(
  'EM-03',
  'The on-screen box follows scroll, zoom and window size',
  { on: ['D', 'DW'], langs: 'EN' },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page, { docs: { [DID12]: denseDoc() } });
    await openReview(page);
    await ready(page);
    await expect(mapNav(page, t)).toBeVisible();
    const body = '[data-testid=cv-body]';
    const out: Record<string, unknown> = {};
    const check = async (label: string) => {
      await page.waitForTimeout(350);
      const m = await mapBox(page, body);
      out[label] = m;
      expect.soft(m.shown, `${label}: the box shows`).toBe(true);
      expect
        .soft(
          Math.abs((m.top ?? 9) - m.wantTop),
          `${label}: top = scrollTop/scrollHeight within 1 %`,
        )
        .toBeLessThanOrEqual(0.01);
      expect
        .soft(
          Math.abs((m.height ?? 9) - m.wantHeight),
          `${label}: height = clientHeight/scrollHeight within 1 %`,
        )
        .toBeLessThanOrEqual(0.01);
    };
    await check('start');
    await page
      .locator(body)
      .evaluate((e) =>
        e.scrollTo({ top: (e.scrollHeight - e.clientHeight) / 2, behavior: 'instant' }),
      );
    await check('middle');
    await page
      .locator(body)
      .evaluate((e) => e.scrollTo({ top: e.scrollHeight, behavior: 'instant' }));
    await check('end');
    await page.getByRole('button', { name: t('Zoom in') }).click();
    await check('zoom in');
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 700 });
    await check('resize to 700');
    await ux.check('map box', STD);
    // When the whole CV fits there is no box: the one-page CV with 'Fit'.
    await page.goto(`/#/cv/${DID12}`);
    await page.reload();
    await ready(page, 1, 10);
    await page.getByRole('button', { name: t('Fit'), exact: true }).click();
    await page.waitForTimeout(500);
    const fit = await mapBox(page, body);
    out.fit = fit;
    await info.attach('map box', {
      body: JSON.stringify(out, null, 1),
      contentType: 'application/json',
    });
    expect.soft(fit.fits, 'the one page fits after Fit').toBe(true);
    expect.soft(fit.shown, 'when the whole CV fits there is no box').toBe(false);
  },
);

// ------------------------------------------------------------------ EM-04

uat(
  'EM-04',
  'Evidence map by keyboard and screen reader',
  { on: ['D', 'E'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    const nav = mapNav(page, t);
    await expect.poll(async () => (await dotsOf(page)).length, { timeout: 8_000 }).toBe(4);
    const first = nav.getByRole('button').first();
    await page
      .getByRole('tablist', { name: t('CV view') })
      .getByRole('tab')
      .last()
      .focus();
    // Tab from the control before the map until the first dot.
    for (let i = 0; i < 6; i++) {
      if (await first.evaluate((b) => b === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    const seq: { name: string; rel: number; ring: string }[] = [];
    for (let i = 0; i < 4; i++) {
      seq.push(
        await page.evaluate(() => {
          const a = document.activeElement as HTMLElement;
          const r = a.getBoundingClientRect();
          const n = a.closest('nav')?.getBoundingClientRect();
          return {
            name: a.getAttribute('aria-label') ?? a.tagName,
            rel: n ? (r.top - n.top) / n.height : -1,
            ring: getComputedStyle(a).boxShadow,
          };
        }),
      );
      await page.keyboard.press('Tab');
    }
    await info.attach('dots by Tab', {
      body: JSON.stringify(seq, null, 1),
      contentType: 'application/json',
    });
    expect
      .soft(
        seq.every((s) => s.rel >= 0),
        'Tab reaches the 4 dots one after another',
      )
      .toBe(true);
    for (let i = 1; i < seq.length; i++)
      expect
        .soft(seq[i]!.rel, `dots are reached top to bottom (${seq.map((s) => s.name).join(' → ')})`)
        .toBeGreaterThanOrEqual(seq[i - 1]!.rel);
    for (const s of seq) expect.soft(s.ring, `'${s.name}' shows a focus ring`).not.toBe('none');
    // Enter and Space act like a click.
    const b1 = nav.getByRole('button').nth(0);
    const b2 = nav.getByRole('button').nth(3);
    await b1.focus();
    await page.keyboard.press('Enter');
    await expect.soft(b1, 'Enter presses the dot').toHaveAttribute('aria-pressed', 'true');
    await b2.focus();
    await page.keyboard.press('Space');
    await expect.soft(b2, 'Space presses the dot').toHaveAttribute('aria-pressed', 'true');
    await expect
      .soft(nav.locator('.sr-only'), 'the hidden sentence')
      .toHaveText(t('1 must-have was not found in the CV.'));
    if (meta.lang === 'az')
      expect.soft(t('1 must-have was not found in the CV.')).toBe('1 vacib tələb CV-də tapılmadı.');
    await ux.check('map by keyboard', [...STD, 'AZ']);
    // No found quotes and 2 missing must-haves: still announced in the pane (SD-61, SD-113).
    const variant = aysel(
      {},
      {
        requirements: [
          req('R1', 'BGP routing', { state: 'missing' }),
          req('R2', 'OSPF', { state: 'missing' }),
          req('R3', 'MPLS', { kind: 'nice', state: 'partly' }),
        ],
      },
    );
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockF(page, { docs: { [DID]: variant } });
    await page.reload();
    await ready(page);
    await page.waitForTimeout(600);
    await expect.soft(page.getByTestId('evidence-map'), 'no dots').toHaveCount(0);
    await expect
      .soft(
        page
          .getByTestId('cv-pane')
          .getByText(t('{n} must-haves were not found in the CV.', { n: 2 })),
        'the missing must-haves are still announced in the pane',
      )
      .toBeAttached();
  },
);

// ------------------------------------------------------------------ EM-05

uat(
  'EM-05',
  'Dense dots stay inside the strip in the normal pane',
  { on: ['D', 'T'], langs: 'EN' },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page, { docs: { [DID12]: denseDoc() } });
    await page.goto(`/#/cv/${DID12}`);
    await ready(page, 1, 10);
    await expect(mapNav(page, t)).toBeVisible();
    await expect
      .poll(async () => (await dotsOf(page)).length, { timeout: 8_000 })
      .toBeGreaterThan(0);
    await denseChecks(page, info, 'normal pane', { viewport: true, pane: true });
    await ux.check('dense dots in the pane', STD);
  },
);

// ------------------------------------------------------------------ EM-06

uat(
  'EM-06',
  'Evidence map on touch screens',
  { on: ['T', 'TL', 'A', 'I'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    await expect.poll(async () => (await dotsOf(page)).length, { timeout: 8_000 }).toBe(4);
    const dots = await dotsOf(page);
    const pages = await page.locator('[data-page]').evaluateAll((ps) =>
      ps.map((p) => {
        const r = p.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    const strip = await mapNav(page, t).evaluate((n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    await info.attach('dots and pages', {
      body: JSON.stringify({ dots, pages, strip }, null, 1),
      contentType: 'application/json',
    });
    // Each hit area ≥ 44×44, or 24 px spacing (WCAG 2.5.8): a 24 px circle on each centre meets no other.
    for (const [i, d] of dots.entries()) {
      const big = d.box.width >= 44 && d.box.height >= 44;
      if (big) continue;
      const cx = d.box.left + d.box.width / 2;
      const cy = d.box.top + d.box.height / 2;
      const near = dots
        .filter((_, j) => j !== i)
        .map((o) =>
          Math.hypot(o.box.left + o.box.width / 2 - cx, o.box.top + o.box.height / 2 - cy),
        );
      expect
        .soft(
          Math.min(...near),
          `'${d.name}' (${d.box.width}×${d.box.height}) keeps 24 px from the next target`,
        )
        .toBeGreaterThanOrEqual(24);
    }
    // The pages settle to their fitted size a moment after the dots appear: judge the settled layout.
    await expect
      .poll(
        async () =>
          mapNav(page, t).evaluate((nav) => {
            const s = nav.getBoundingClientRect();
            const hit = [...document.querySelectorAll('[data-page]')].some((el) => {
              const p = el.getBoundingClientRect();
              return (
                Math.min(s.right, p.right) - Math.max(s.left, p.left) > 0 &&
                Math.min(s.bottom, p.bottom) - Math.max(s.top, p.top) > 0
              );
            });
            return hit ? 'overlap' : 'clear';
          }),
        { message: 'the strip does not overlap a page', timeout: 5_000 },
      )
      .toBe('clear');
    await mapNav(page, t)
      .getByRole('button', {
        name: t('{requirement}, page {n}', { requirement: '5G transport experience', n: 2 }),
        exact: true,
      })
      .tap();
    const mark = page.locator('[data-page="2"] [data-testid=pdf-mark]').first();
    await expect.soft(mark).toBeAttached({ timeout: 8_000 });
    await page.waitForTimeout(800);
    const vis = await mark
      .evaluate((m) => {
        const r = m.getBoundingClientRect();
        const b = document.querySelector('[data-testid=cv-body]')!.getBoundingClientRect();
        return r.bottom > Math.max(0, b.top) && r.top < Math.min(innerHeight, b.bottom);
      })
      .catch(() => false);
    expect.soft(vis, 'the tap brings the page 2 mark into view').toBe(true);
    // With two panes side by side (TL) the page itself scrolled down to the mark and the short mock
    // Analysis leaves the CV pane no room to stay pinned, so its toolbar is under the sticky bars.
    // That is ordinary scrolling, not an overlay: look at the page from the top.
    if (meta.dev === 'TL') await page.evaluate(() => window.scrollTo(0, 0));
    await ux.check('dot tapped', [...STD, 'TGT', 'AZ']);
    await toAnalysis(page, t);
    await expect
      .soft(
        card(page, '5G transport experience').getByRole('button', { name: t('Hide in CV') }),
        "the chosen requirement is named after the tap ('Hide in CV' on its card)",
      )
      .toBeVisible();
  },
);

// ------------------------------------------------------------------ EM-07

uat(
  'EM-07',
  'Text view map and its on-screen box in the normal pane, in EN and AZ',
  { on: ['D', 'A'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    const long = longText();
    await mockF(page, {
      docs: { [DID]: aysel({}, { requirements: long.requirements }) },
      text: { [DID]: long.text },
    });
    await openReview(page);
    await ready(page);
    await page
      .getByRole('tablist', { name: t('CV view') })
      .getByRole('tab', { name: t('Text') })
      .click();
    const box = page.getByLabel(t('CV text'));
    await expect(box).toBeVisible();
    await expect
      .poll(async () => (await dotsOf(page)).map((d) => d.name).sort(), { timeout: 5_000 })
      .toEqual(['5G transport experience', 'BGP routing', 'OSPF']);
    const read = () =>
      page.evaluate((label) => {
        const el = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
        const m = document.querySelector<HTMLElement>(
          '[data-testid=evidence-map] > span[aria-hidden]',
        );
        return {
          top: m ? parseFloat(m.style.top) / 100 : null,
          want: el.scrollTop / el.scrollHeight,
          st: el.scrollTop,
        };
      }, t('CV text'));
    const s0 = await read();
    await box.evaluate((el) => el.scrollBy(0, 900));
    await page.waitForTimeout(300);
    const s1 = await read();
    await info.attach('text map', {
      body: JSON.stringify({ s0, s1 }, null, 1),
      contentType: 'application/json',
    });
    expect.soft(s1.top, 'the on-screen box shows').not.toBeNull();
    expect.soft(s1.st).toBeGreaterThan(0);
    expect
      .soft(Math.abs((s1.top ?? 9) - s1.want), 'the box follows the text box scroll within 1 %')
      .toBeLessThanOrEqual(0.01);
    await ux.check('text map', [...STD, 'AZ']);
    await mapNav(page, t)
      .getByRole('button', { name: '5G transport experience', exact: true })
      .click();
    const mark = box.locator('mark');
    await expect
      .soft(
        page.getByRole('tablist', { name: t('CV view') }).getByRole('tab', { name: t('Text') }),
        'a dot in the text view keeps the Text view',
      )
      .toHaveAttribute('aria-selected', 'true', { timeout: 2_000 });
    await expect
      .soft(mark, 'the dot marks the text')
      .toContainText('5G transport rollout', { timeout: 3_000 });
    if (!(await mark.count())) return;
    const off = () =>
      box.evaluate((el) => {
        const m = el.querySelector('mark')!.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        return Math.abs(m.top + m.height / 2 - (b.top + b.height / 2)) / b.height;
      });
    // The scroll is smooth when motion is allowed: give it time to arrive.
    await expect
      .poll(off, {
        message: 'the <mark> is scrolled to the middle of the text box',
        timeout: 4_000,
      })
      .toBeLessThanOrEqual(0.1);
  },
);

// ------------------------------------------------------------------ EM-08

uat(
  'EM-08',
  'No map for PDF problems and erased CVs; map on Word pages',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await mockF(page, {
      docs: {
        [DID13]: problemDoc(DID13, 'locked.pdf'),
        [DID11]: stateDoc(DID11, 'erased', {
          original: { available: false, view: 'none' },
          text: { available: false },
          matchId: null,
        }),
        [DID4]: leyla('pdf'),
      },
    });
    for (const id of [DID13, DID11]) {
      await page.goto(`/#/cv/${id}`);
      await page.reload();
      await page.locator('h1').waitFor();
      await page.waitForTimeout(1_200);
      await expect
        .soft(
          page.getByTestId('evidence-map'),
          `${id === DID13 ? 'locked PDF' : 'erased CV'}: no map`,
        )
        .toHaveCount(0);
    }
    await page.goto(`/#/cv/${DID4}`);
    await page.reload();
    await ready(page);
    await expect
      .poll(async () => (await dotsOf(page)).length, { timeout: 8_000 })
      .toBeGreaterThan(0);
    const names = (await dotsOf(page)).map((d) => d.name);
    for (const n of names)
      expect
        .soft(n, 'dots on the rendition pages carry a page number')
        .toMatch(meta.lang === 'az' ? /, səhifə \d$/ : /, page \d$/);
    await ux.check('Word pages map', [...STD, 'AZ']);
  },
);

void DID11;
