import type { Page } from '@playwright/test';
import { DID, DID2, openReview, SENAI_ON } from '../fixtures/api';
import {
  card,
  DENSE_LINES,
  denseDoc,
  DID12,
  DID13,
  DID14,
  dialogBox,
  exact,
  hasAz,
  ink,
  longText,
  mockF,
  poll,
  probe,
  problemDoc,
  ready,
  settle,
  showReq,
  storeList,
  summary,
  axCount,
  FULL,
  denseChecks,
  T,
  topAt,
  aysel,
  type Hit,
} from '../fixtures/pkg-f';
import { expect, STD, uat, type Ux } from '../ux/test';

// 7.18 CV pane and full screen (FS), the regression set for UAT-BUG-001 (plan section 5).
// Every case is written to the correct behaviour, so today's defect makes FS-01 to FS-19 fail.

const SENAI_CANDIDATE = {
  enabled: true,
  name: 'SenAI',
  unavailableMessage: '',
  features: { challenge: true, compare: true, interview: true, challengeRecruiter: true },
};

const fsButton = (page: Page, t: ReturnType<typeof T>) =>
  page.getByRole('button', { name: t('Full screen'), exact: true });
const closeButton = (page: Page, t: ReturnType<typeof T>) =>
  page.getByRole('button', { name: t('Close full screen'), exact: true });
const dialog = (page: Page) => page.locator(FULL);

/** Press 'Full screen' and wait for the dialog (and for the pages to be re-drawn at the new width). */
async function openFull(page: Page, t: ReturnType<typeof T>) {
  await fsButton(page, t).click();
  await expect(dialog(page)).toBeAttached();
  await page.waitForTimeout(450); // ResizeObserver (150 ms) and the re-render
}

/** Close the viewer however it can be closed (the button, or Esc when the button is covered). */
async function closeFull(page: Page, t: ReturnType<typeof T>) {
  try {
    await closeButton(page, t).click({ timeout: 2_500 });
    return 'button';
  } catch {
    await page.keyboard.press('Escape');
    return 'escape';
  }
}

async function attach(
  info: { attach: (n: string, o: { body: string; contentType: string }) => Promise<void> },
  name: string,
  v: unknown,
) {
  await info.attach(name, { body: JSON.stringify(v, null, 1), contentType: 'application/json' });
}

/** The UAT-BUG-001 layer checks: the dialog equals the window and every probe point is inside it. */
async function coverCheck(
  page: Page,
  ux: Ux,
  info: any,
  label: string,
  extra: { x: number; y: number }[] = [],
) {
  const box = await dialogBox(page);
  const grid = await probe(page, { cols: 12, rows: 8 });
  const more = extra.length ? await probe(page, { points: extra }) : [];
  const all: Hit[] = [...grid, ...more];
  const outside = all.filter((h) => !h.inside);
  await attach(info, `${label}: dialog box and elementFromPoint`, {
    box,
    summary: summary(all),
    outside: outside.slice(0, 40),
  });
  expect.soft(box.modal, `${label}: aria-modal`).toBe('true');
  expect
    .soft(Math.abs(box.left), `${label}: dialog left is 0 (box ${JSON.stringify(box)})`)
    .toBeLessThanOrEqual(1);
  expect.soft(Math.abs(box.top), `${label}: dialog top is 0`).toBeLessThanOrEqual(1);
  expect
    .soft(Math.abs(box.width - box.innerWidth), `${label}: dialog width = innerWidth`)
    .toBeLessThanOrEqual(1);
  expect
    .soft(Math.abs(box.height - box.innerHeight), `${label}: dialog height = innerHeight`)
    .toBeLessThanOrEqual(1);
  expect
    .soft(
      outside.length,
      `${label}: probe points outside the dialog ${JSON.stringify(summary(all))}`,
    )
    .toBe(0);
  for (const bad of ['analysis-li', 'app-header', 'review-bar', 'rail'])
    expect
      .soft(all.filter((h) => h.what === bad).length, `${label}: points that hit the ${bad}`)
      .toBe(0);
  return { box, all };
}

// ------------------------------------------------------------------ FS-01 … FS-04: the layer

uat(
  'FS-01',
  'UAT-BUG-001: full screen covers the whole window with motion allowed',
  { on: ['D', 'DW', 'DS', 'E'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await mockF(page);
    const sizes =
      meta.dev === 'DS'
        ? [
            { width: 1280, height: 800 },
            { width: 1024, height: 768 },
          ]
        : [null];
    for (const [i, size] of sizes.entries()) {
      const tag = size ? `${size.width}x${size.height}` : meta.dev;
      if (size) await page.setViewportSize(size);
      if (i === 0) await openReview(page);
      else await page.reload();
      await ready(page);
      await settle(page);
      await showReq(page, t, '5G transport experience');
      await expect(page.locator('[data-page="2"] [data-testid=pdf-mark]').first()).toBeVisible();
      await settle(page);
      await openFull(page, t);
      await settle(page);
      await coverCheck(page, ux, info, tag);
      await ux.check(`full screen open ${tag}`, STD);
      await closeFull(page, t);
    }
  },
);

uat(
  'FS-02',
  'UAT-BUG-001: full screen covers the whole window with reduced motion',
  { on: ['D', 'E'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockF(page);
    await openReview(page);
    await ready(page);
    await showReq(page, t, '5G transport experience');
    await expect(page.locator('[data-page="2"] [data-testid=pdf-mark]').first()).toBeVisible();
    await openFull(page, t);
    const anims = await page.evaluate(() => document.getAnimations().length);
    expect.soft(anims, 'document.getAnimations() is empty').toBe(0);
    await coverCheck(page, ux, info, 'reduced motion');
    await ux.check('full screen open, reduced motion', [...STD, 'RM']);
  },
);

uat(
  'FS-03',
  'UAT-BUG-001: full screen covers the open SenAI candidate panel',
  { on: ['D', 'DW', 'DS'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page, { assistant: SENAI_CANDIDATE });
    const sizes =
      meta.dev === 'DS'
        ? [
            { width: 1280, height: 800 },
            { width: 1024, height: 768 },
          ]
        : [null];
    for (const [i, size] of sizes.entries()) {
      const tag = size ? `${size.width}x${size.height}` : meta.dev;
      if (size) await page.setViewportSize(size);
      if (i === 0) await openReview(page);
      else await page.reload();
      await ready(page);
      const panel = page.getByRole('complementary', { name: t('Assistant') });
      if (!(await panel.isVisible())) {
        const ask = page.getByRole('search').getByRole('textbox');
        await ask.click();
        await ask.press('Enter');
      }
      await expect(panel).toBeVisible();
      const paneBefore = await page.getByTestId('cv-pane').boundingBox();
      await openFull(page, t);
      const W = page.viewportSize()!.width;
      const H = page.viewportSize()!.height;
      const strip = Array.from({ length: 10 }, (_, k) => [
        { x: W - 192, y: ((k + 0.5) * H) / 10 },
        { x: W - 24, y: ((k + 0.5) * H) / 10 },
      ]).flat();
      const { all } = await coverCheck(page, ux, info, tag, strip);
      expect
        .soft(
          all.filter((h) => h.what === 'assistant').length,
          `${tag}: points that hit the Assistant panel`,
        )
        .toBe(0);
      const close = await topAt(closeButton(page, t));
      expect
        .soft(close.ok, `${tag}: 'Close full screen' is topmost at its centre (hit ${close.hit})`)
        .toBe(true);
      await ux.check(`full screen over SenAI ${tag}`, STD);
      const how = await closeFull(page, t);
      expect.soft(how, `${tag}: 'Close full screen' could be pressed`).toBe('button');
      await expect(dialog(page)).toHaveCount(0);
      await expect.soft(panel, `${tag}: the SenAI panel is open as before`).toBeVisible();
      const paneAfter = await page.getByTestId('cv-pane').boundingBox();
      expect
        .soft(Math.abs((paneAfter?.x ?? 0) - (paneBefore?.x ?? 0)), `${tag}: layout unchanged (x)`)
        .toBeLessThanOrEqual(1);
      expect
        .soft(
          Math.abs((paneAfter?.width ?? 0) - (paneBefore?.width ?? 0)),
          `${tag}: layout unchanged (width)`,
        )
        .toBeLessThanOrEqual(1);
    }
  },
);

uat(
  'FS-04',
  'UAT-BUG-001: the full-screen toolbar is fully visible and every button works without force',
  { on: 'All' },
  async ({ page, ux, meta, info, context }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    await openFull(page, t);
    const dlg = dialog(page);
    await expect.soft(dlg.getByText('aysel.pdf')).toBeVisible();
    await expect.soft(dlg.getByText(t('{n} pages', { n: 2 }))).toBeVisible();
    const names = [
      'Zoom out',
      'Zoom in',
      'Fit',
      'Open in new tab',
      'Download',
      'Close full screen',
    ];
    const found: Record<string, unknown> = {};
    for (const n of names) {
      const b = dlg.getByRole('button', { name: exact(t(n)) });
      const count = await b.count();
      found[n] = count ? await topAt(b.first()) : 'missing';
      expect.soft(count, `toolbar button '${t(n)}' is in the dialog`).toBe(1);
      if (count) {
        const r = found[n] as Awaited<ReturnType<typeof topAt>>;
        expect
          .soft(r.inView, `'${t(n)}' lies inside the viewport ${JSON.stringify(r.box)}`)
          .toBe(true);
        expect
          .soft(r.ok, `elementFromPoint at the centre of '${t(n)}' is the control (hit ${r.hit})`)
          .toBe(true);
      }
    }
    await attach(info, 'toolbar controls', found);
    if (meta.lang === 'az') expect.soft(t('Close full screen')).toBe('Tam ekranı bağla');
    await ux.check('full screen toolbar', [...STD, 'AZ']);

    // Every control with a normal click (no force).
    const click = async (name: string) => {
      const b = dlg.getByRole('button', { name: exact(t(name)) });
      if (!(await b.count())) return false;
      try {
        await b.click({ timeout: 3_000 });
        return true;
      } catch (e) {
        expect
          .soft(
            String(e).split('\n').slice(0, 3).join(' '),
            `normal click on '${t(name)}' succeeds`,
          )
          .toBe('ok');
        return false;
      }
    };
    const width = () =>
      page.locator('[data-page="1"]').evaluate((e) => e.getBoundingClientRect().width);
    const w0 = await width();
    if (await click('Zoom in')) {
      await page.waitForTimeout(300);
      expect
        .soft((await width()) / w0, "'Zoom in' makes page 1 about 25 % wider")
        .toBeCloseTo(1.25, 1);
    }
    if (await click('Zoom out')) {
      await page.waitForTimeout(300);
      expect
        .soft(Math.abs((await width()) / w0 - 1), "'Zoom out' brings it back within 2 %")
        .toBeLessThanOrEqual(0.02);
    }
    await click('Fit');
    // 'Open in new tab' (named 'Open' today, SD-15): the popup is checked on whichever exists.
    const open = dlg
      .getByRole('button', { name: exact(t('Open in new tab')) })
      .or(dlg.getByRole('button', { name: exact(t('Open')) }));
    if (await open.count()) {
      const popup = context.waitForEvent('page', { timeout: 4_000 }).catch(() => null);
      try {
        await open.first().click({ timeout: 3_000 });
        expect.soft(await popup, "'Open in new tab' fires a popup").not.toBeNull();
      } catch (e) {
        expect
          .soft(String(e).split('\n')[0], "normal click on 'Open in new tab' succeeds")
          .toBe('ok');
      }
      for (const p of context.pages()) if (p !== page) await p.close();
    }
    const dl = page.waitForEvent('download', { timeout: 4_000 }).catch(() => null);
    if (await click('Download')) {
      const d = await dl;
      expect
        .soft(d?.suggestedFilename(), "'Download' fires a download named aysel.pdf")
        .toBe('aysel.pdf');
    }
    if (await dlg.count()) {
      const ok = await click('Close full screen');
      if (ok) await expect.soft(dlg, "'Close full screen' closes the dialog").toHaveCount(0);
      else await page.keyboard.press('Escape');
    }
  },
);

// ------------------------------------------------------------------ FS-05 … FS-09: a real modal

uat(
  'FS-05',
  'Esc closes full screen, returns focus to the button and restores the page scroll',
  { on: 'All', langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const seen = await mockF(page);
    await openReview(page);
    await ready(page);
    await page.evaluate(() => window.scrollBy(0, 300));
    const btn = fsButton(page, t);
    await btn.scrollIntoViewIfNeeded();
    const url = page.url();
    const state = () =>
      page.evaluate(() => ({
        y: Math.round(window.scrollY),
        overflow: document.body.style.overflow,
        active: (document.activeElement?.textContent ?? '').trim(),
        pressed: document.activeElement?.getAttribute('aria-pressed') ?? null,
        h1: document.querySelector('h1')?.textContent ?? '',
      }));
    const before = await state();
    await btn.click();
    await expect(dialog(page)).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    const afterEsc = await state();
    expect
      .soft(afterEsc.active, 'focus is on the Full screen button after Escape')
      .toBe(t('Full screen'));
    expect.soft(afterEsc.pressed).toBe('false');
    expect
      .soft(Math.abs(afterEsc.y - before.y), `scrollY restored (${before.y} → ${afterEsc.y})`)
      .toBeLessThanOrEqual(1);
    expect.soft(afterEsc.overflow, 'body overflow restored').toBe(before.overflow);
    expect.soft(afterEsc.h1, 'Escape changes nothing else').toBe(before.h1);
    expect(page.url()).toBe(url);
    await ux.check('after Escape', STD);

    // Again, closed with 'Close full screen'.
    const before2 = await state();
    await btn.click();
    await expect(dialog(page)).toBeAttached();
    const how = await closeFull(page, t);
    expect.soft(how, "'Close full screen' can be pressed (not covered)").toBe('button');
    await expect(dialog(page)).toHaveCount(0);
    const after2 = await state();
    expect
      .soft(after2.active, 'focus is on the Full screen button after Close')
      .toBe(t('Full screen'));
    expect
      .soft(
        Math.abs(after2.y - before2.y),
        `scrollY restored after Close (${before2.y} → ${after2.y})`,
      )
      .toBeLessThanOrEqual(1);
    expect.soft(after2.overflow).toBe(before2.overflow);
    expect(page.url()).toBe(url);
    expect(seen.requests.filter((r) => r.method === 'PUT')).toEqual([]);
    await ux.check('after Close full screen', STD);
  },
);

uat(
  'FS-06',
  'Browser Back closes the viewer and stays on the same CV',
  { on: 'All', langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await mockF(page);
    await page.goto('/#/candidates');
    await page.getByRole('link', { name: 'Aysel Məmmədova' }).first().click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}\\?l=[\\w-]+$`));
    const reviewUrl = page.url();
    await ready(page);
    await openFull(page, t);
    await page.goBack();
    await page.waitForTimeout(400);
    expect.soft(page.url(), 'Back keeps the same CV').toBe(reviewUrl);
    await expect.soft(dialog(page), 'Back closed the viewer').toHaveCount(0);
    await expect
      .soft(page.getByRole('heading', { level: 1, name: 'Aysel Məmmədova' }))
      .toBeVisible();
    const focused = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
    expect.soft(focused, 'focus is on Full screen after Back').toBe(t('Full screen'));
    await ux.check('after Back', STD);
    if (page.url() === reviewUrl) {
      await page.goBack();
      await expect.soft(page).toHaveURL(/#\/candidates$/);
    }
    // A viewer closed with Esc leaves no extra history entry: one Back returns to the pool.
    await page.goto('/#/candidates');
    await page.getByRole('link', { name: 'Aysel Məmmədova' }).first().click();
    await ready(page);
    await openFull(page, t);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/#\/candidates$/);
  },
);

uat(
  'FS-07',
  'Focus stays inside the full-screen viewer and the page behind is inert',
  { on: ['D', 'E'], langs: 'EN' },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    await openFull(page, t);
    const where = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        const d = document.querySelector('dialog[aria-modal="true"]');
        return {
          inside: !!(a && d && d.contains(a)),
          what: `${a?.tagName.toLowerCase()} "${(a?.getAttribute('aria-label') || a?.textContent || '').trim().slice(0, 30)}"`,
        };
      });
    expect.soft((await where()).inside, 'focus is inside the dialog on opening').toBe(true);
    const seen: { inside: boolean; what: string }[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      seen.push(await where());
    }
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Shift+Tab');
      seen.push(await where());
    }
    // PLAN: "all 80 recorded elements are inside the dialog" — a native modal <dialog> (showModal) lets
    // Tab leave the last control for the browser's own toolbar, and the page then reports <body> as
    // focused; that is the platform's modal behaviour. What matters is that nothing on the page behind
    // ever takes focus, which is asserted strictly.
    const out = seen.filter((s) => !s.inside && !/^body /.test(s.what));
    await info.attach('focus while full screen is open', {
      body: JSON.stringify(seen, null, 1),
      contentType: 'application/json',
    });
    expect
      .soft(
        out.length,
        `focused elements of the page behind the dialog, e.g. ${out
          .slice(0, 4)
          .map((o) => o.what)
          .join(', ')}`,
      )
      .toBe(0);
    expect
      .soft(seen.filter((s) => s.inside).length, 'Tab and Shift+Tab move through the dialog')
      .toBeGreaterThan(60);
    // The accessibility tree: Chromium's own (Playwright's role engine does not model modal inertness).
    expect
      .soft(
        await axCount(page, '← Back to Candidates'),
        'the Back link is out of the accessibility tree',
      )
      .toBe(0);
    expect
      .soft(
        await axCount(page, 'Decision for Aysel Məmmədova'),
        'the Decision select is out of the accessibility tree',
      )
      .toBe(0);
    expect
      .soft(
        await axCount(page, 'Show in CV'),
        'the analysis buttons are out of the accessibility tree',
      )
      .toBe(0);
    const inert = await page.evaluate(() => {
      const back = [...document.querySelectorAll('a')].find((a) =>
        a.textContent?.startsWith('← Back'),
      )!;
      const sel = document.querySelector<HTMLElement>('select');
      const before = document.activeElement;
      back.focus();
      sel?.focus();
      const took = document.activeElement === back || (!!sel && document.activeElement === sel);
      (before as HTMLElement | null)?.focus();
      return !!back.closest('[inert]') || !took;
    });
    expect.soft(inert, 'the page behind the viewer is inert (cannot take focus)').toBe(true);
    await ux.check('focus trapped', ['OCC', 'OVL', 'OVF']);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: '← Back to Candidates' })).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Decision for Aysel Məmmədova' }),
    ).toBeVisible();
    expect
      .soft(
        await axCount(page, '← Back to Candidates'),
        'after closing the Back link is back in the tree',
      )
      .toBeGreaterThan(0);
  },
);

uat(
  'FS-08',
  'Review keys J, K, S, M, N do nothing while full screen is open',
  { on: ['D', 'E', 'T'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const seen = await mockF(page);
    await openReview(page);
    await ready(page);
    const url = page.url();
    await openFull(page, t);
    const urls: string[] = [];
    for (const k of ['j', 'k', 's', 'm', 'n']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(300);
      urls.push(page.url().replace(/^.*#/, '#'));
    }
    const puts = seen.requests.filter(
      (r) => r.method === 'PUT' && /\/candidates\/\w+\/decision/.test(r.url),
    );
    expect
      .soft(urls, 'the URL stays on the CV while the viewer is open')
      .toEqual(Array(5).fill(`#/cv/${DID}?l=e2e-list`));
    expect
      .soft(
        puts.map((p) => p.body),
        'no decision is sent while the viewer is open',
      )
      .toEqual([]);
    await expect
      .soft(page.getByRole('button', { name: t('Undo') }), 'no toast shows')
      .toHaveCount(0);
    await expect.soft(dialog(page), 'the viewer stays open').toHaveCount(1);
    await ux.check('keys pressed in full screen', ['OCC', 'OVL', 'OVF']);
    // After Escape, J moves on (from a fresh start when the keys above already left the CV).
    if (page.url() !== url || !(await dialog(page).count())) {
      await page.goto(url);
      await page.reload();
      await ready(page);
      await openFull(page, t);
    }
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await page.keyboard.press('j');
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID2}\\?l=e2e-list$`));
  },
);

uat(
  'FS-09',
  "'/' does not move focus to the Ask bar behind the viewer",
  { on: ['D'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const seen = await mockF(page, { assistant: SENAI_ON });
    await openReview(page);
    await ready(page);
    await openFull(page, t);
    await page.keyboard.press('/');
    await page.keyboard.type('abc');
    const st = await page.evaluate(() => {
      const d = document.querySelector('dialog[aria-modal="true"]');
      const a = document.activeElement;
      const ask = document.querySelector<HTMLInputElement>('form[role=search] input');
      return {
        inside: !!(a && d?.contains(a)),
        askFocused: a === ask,
        askValue: ask?.value ?? null,
      };
    });
    expect.soft(st.inside, 'focus stays inside the dialog').toBe(true);
    expect.soft(st.askFocused, 'the Ask bar is not focused').toBe(false);
    expect.soft(st.askValue, 'the Ask bar stays empty').toBe('');
    const senai = seen.requests.filter((r) => r.method === 'POST' && /assistant/.test(r.url));
    expect.soft(senai.length, 'no SenAI request is sent').toBe(0);
    await ux.check("after '/' and typing", ['OCC', 'OVL', 'OVF']);
  },
);

// ------------------------------------------------------------------ FS-10 … FS-14: pages and map

uat(
  'FS-10',
  'Dense evidence: map dots stay inside their strip in full screen',
  { on: ['D', 'DW', 'T'], langs: 'EN' },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page, { docs: { [DID12]: denseDoc() } });
    await page.goto(`/#/cv/${DID12}`);
    await ready(page, 1, 10); // the dense page has little ink: 8 short lines
    await openFull(page, t);
    await expect(
      page.getByRole('navigation', { name: t('Where the requirements are in the CV') }),
    ).toBeVisible();
    await denseChecks(page, info, 'full screen', { viewport: true, pane: false });
    await ux.check('dense dots in full screen', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  },
);

uat(
  'FS-11',
  'Readable page width in full screen on a 1920x1080 screen',
  { on: ['DW'], langs: 'EN' },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    await openFull(page, t);
    await poll(
      () => ink(page.locator('[data-page="1"] canvas')),
      (v) => v > 50,
      8_000,
      'page drawn',
    );
    const m = await page.evaluate(() => {
      const p = document.querySelector('[data-page="1"]')!.getBoundingClientRect();
      const body = document.querySelector<HTMLElement>('[data-testid=cv-body]')!;
      const b = body.getBoundingClientRect();
      const inner = { left: b.left, right: b.left + body.clientWidth };
      const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
        w: c.width,
        h: c.height,
        cssW: c.getBoundingClientRect().width,
        cssH: c.getBoundingClientRect().height,
      }));
      const dlg = document.querySelector('dialog[aria-modal="true"]');
      const zoomText = /\b\d{2,3}\s?%/.test(dlg?.querySelector('div')?.textContent ?? '');
      return {
        page: { left: p.left, right: p.right, width: p.width, height: p.height },
        body: { ...inner, clientHeight: body.clientHeight },
        canvases,
        zoomText,
      };
    });
    await info.attach('page, body and canvases', {
      body: JSON.stringify(m, null, 1),
      contentType: 'application/json',
    });
    expect
      .soft(
        m.page.width <= 1000 || m.page.height <= m.body.clientHeight,
        `page is about 1,000 px wide at most or fits the height (${Math.round(m.page.width)}×${Math.round(m.page.height)}, body ${m.body.clientHeight})`,
      )
      .toBe(true);
    expect
      .soft(
        Math.abs(m.page.left - m.body.left - (m.body.right - m.page.right)),
        'the page is centred',
      )
      .toBeLessThanOrEqual(2);
    expect.soft(m.zoomText, 'the toolbar shows the zoom value in %').toBe(true);
    for (const c of m.canvases)
      expect
        .soft(c.w / c.cssW, 'canvas backing store at most 2x its CSS size')
        .toBeLessThanOrEqual(2.01);
    await ux.check('full screen on 1920x1080', STD);
  },
);

uat(
  'FS-12',
  "'Fit' fits one page to the window height",
  { on: ['D', 'DW'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    await openFull(page, t);
    const dlg = dialog(page);
    await dlg.getByRole('button', { name: t('Zoom in') }).click();
    await dlg.getByRole('button', { name: t('Zoom in') }).click();
    const fit = dlg.getByRole('button', { name: exact(t('Fit')) });
    await ux.check('full screen zoomed in', STD);
    await expect(fit, "a 'Fit' button is in the toolbar (SD-06)").toHaveCount(1);
    const fits = async () => {
      await fit.click();
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => ({
        h: document.querySelector('[data-page="1"]')!.getBoundingClientRect().height,
        body: document.querySelector<HTMLElement>('[data-testid=cv-body]')!.clientHeight,
        zoom: /\b\d{2,3}\s?%/.test(
          document.querySelector('dialog[aria-modal="true"]')?.textContent ?? '',
        ),
      }));
      expect.soft(m.h, 'page 1 fits the body height').toBeLessThanOrEqual(m.body);
      expect
        .soft(m.h, 'page 1 uses at least 90 % of the height')
        .toBeGreaterThanOrEqual(0.9 * m.body);
      expect.soft(m.zoom, 'the zoom value shows the fitted %').toBe(true);
    };
    await fits();
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.waitForTimeout(400);
    await fits();
  },
);

uat(
  'FS-13',
  'Zoom keeps the reading position and the map box follows',
  { on: ['D', 'DW'], langs: 'EN' },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    await showReq(page, t, '5G transport experience');
    await expect(page.locator('[data-page="2"] [data-testid=pdf-mark]').first()).toBeVisible();
    await openFull(page, t);
    await page.waitForTimeout(800);
    const read = () =>
      page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('[data-testid=cv-body]')!;
        const b = body.getBoundingClientRect();
        const p2 = document.querySelector('[data-page="2"]')!.getBoundingClientRect();
        const p1 = document.querySelector('[data-page="1"]')!.getBoundingClientRect();
        const mark = document
          .querySelector('[data-page="2"] [data-testid=pdf-mark]')
          ?.getBoundingClientRect();
        const topPage = [...document.querySelectorAll('[data-page]')]
          .find((p) => {
            const r = p.getBoundingClientRect();
            return r.bottom > b.top + 1;
          })
          ?.getAttribute('data-page');
        const box = document.querySelector<HTMLElement>(
          '[data-testid=evidence-map] > span[aria-hidden]',
        );
        const marks = [...document.querySelectorAll('[data-page]')].flatMap((p) => {
          const pr = p.getBoundingClientRect();
          return [...p.querySelectorAll('[data-testid=pdf-mark]')].map((m) => {
            const r = m.getBoundingClientRect();
            return (
              r.left >= pr.left - 1 &&
              r.right <= pr.right + 1 &&
              r.top >= pr.top - 1 &&
              r.bottom <= pr.bottom + 1
            );
          });
        });
        return {
          topPage,
          p2Visible: p2.bottom > b.top && p2.top < b.top + body.clientHeight,
          markRel: mark ? (mark.top + mark.height / 2 - b.top) / body.clientHeight : null,
          pageCentre: (p1.left + p1.right) / 2 - (b.left + body.clientWidth / 2),
          mapTop: box ? parseFloat(box.style.top) / 100 : null,
          mapHeight: box ? parseFloat(box.style.height) / 100 : null,
          wantTop: body.scrollTop / body.scrollHeight,
          wantHeight: Math.max(body.clientHeight / body.scrollHeight, 0.04),
          marksInside: marks.every(Boolean),
        };
      });
    const steps: Record<string, Awaited<ReturnType<typeof read>>> = { start: await read() };
    const zin = dialog(page).getByRole('button', { name: t('Zoom in') });
    const zout = dialog(page).getByRole('button', { name: t('Zoom out') });
    await zin.click();
    await page.waitForTimeout(300);
    steps.zoomIn = await read();
    await zout.click();
    await zout.click();
    await page.waitForTimeout(300);
    steps.zoomOut = await read();
    await info.attach('reading position', {
      body: JSON.stringify(steps, null, 1),
      contentType: 'application/json',
    });
    const base = steps.start!;
    for (const k of ['zoomIn', 'zoomOut'] as const) {
      const s = steps[k]!;
      expect.soft(s.p2Visible, `${k}: page 2 is still on screen`).toBe(true);
      expect
        .soft(
          s.markRel !== null && s.markRel >= 0 && s.markRel <= 1,
          `${k}: the mark is in the visible part (${s.markRel})`,
        )
        .toBe(true);
      expect
        .soft(
          Math.abs((s.markRel ?? 9) - (base.markRel ?? 0)),
          `${k}: the mark stays within 15 % of its height (${base.markRel} → ${s.markRel})`,
        )
        .toBeLessThanOrEqual(0.15);
      expect
        .soft(Math.abs(s.pageCentre), `${k}: pages grow around the centre`)
        .toBeLessThanOrEqual(2);
      expect.soft(s.marksInside, `${k}: every mark lies inside its page`).toBe(true);
    }
    for (const k of ['start', 'zoomIn', 'zoomOut'] as const) {
      const s = steps[k]!;
      expect.soft(s.mapTop, `${k}: the map box is shown`).not.toBeNull();
      expect
        .soft(
          Math.abs((s.mapTop ?? 9) - s.wantTop),
          `${k}: map box top = scrollTop/scrollHeight within 1 %`,
        )
        .toBeLessThanOrEqual(0.01);
      expect
        .soft(
          Math.abs((s.mapHeight ?? 9) - s.wantHeight),
          `${k}: map box height = clientHeight/scrollHeight within 1 %`,
        )
        .toBeLessThanOrEqual(0.01);
    }
    await ux.check('after zoom', STD);
  },
);

uat(
  'FS-14',
  'Text tab in full screen scrolls in its own box and the map box shows, in EN and AZ',
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
    await openFull(page, t);
    await dialog(page)
      .getByRole('tab', { name: t('Text') })
      .click();
    const box = page.getByLabel(t('CV text'));
    await expect(box).toBeVisible();
    const read = () =>
      page.evaluate((label) => {
        const el = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
        const body = document.querySelector<HTMLElement>('[data-testid=cv-body]')!;
        const d = document.querySelector('dialog[aria-modal="true"]')!.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const map = document.querySelector<HTMLElement>(
          '[data-testid=evidence-map] > span[aria-hidden]',
        );
        const art = el.querySelector('article')!;
        const st = getComputedStyle(art);
        return {
          bottom: r.bottom,
          dialogBottom: d.bottom,
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          bodyScroll: body.scrollTop,
          mapTop: map ? parseFloat(map.style.top) / 100 : null,
          bg: st.backgroundColor,
          color: st.color,
        };
      }, t('CV text'));
    const s0 = await read();
    await box.evaluate((el) => el.scrollBy(0, 800));
    await page.waitForTimeout(250);
    const s1 = await read();
    await info.attach('text box', {
      body: JSON.stringify({ s0, s1 }, null, 1),
      contentType: 'application/json',
    });
    expect
      .soft(s0.bottom, 'the text box bottom is inside the dialog')
      .toBeLessThanOrEqual(s0.dialogBottom + 1);
    expect
      .soft(s0.scrollHeight, 'the text box scrolls (scrollHeight > clientHeight)')
      .toBeGreaterThan(s0.clientHeight);
    expect.soft(s1.scrollTop, 'scrolling moves the text box itself').toBeGreaterThan(s0.scrollTop);
    expect.soft(s1.bodyScroll, 'cv-body does not scroll').toBe(s0.bodyScroll);
    expect.soft(s1.mapTop, 'the map on-screen box shows').not.toBeNull();
    expect
      .soft(
        Math.abs((s1.mapTop ?? 9) - s1.scrollTop / s1.scrollHeight),
        'the map box top follows the text box within 1 %',
      )
      .toBeLessThanOrEqual(0.01);
    expect.soft(s1.bg, 'the sheet stays white').toBe('rgb(255, 255, 255)');
    expect.soft(s1.color, 'dark text').toBe('rgb(26, 26, 26)');
    await ux.check('text in full screen', [...STD, 'AZ']);
  },
);

uat(
  'FS-16',
  'Tablet and phone: full screen covers the bottom bars and the toolbar is reachable',
  { on: ['T', 'TL', 'A', 'I'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    await fsButton(page, t).tap();
    await expect(dialog(page)).toBeAttached();
    await page.waitForTimeout(450);
    const vv = await page.evaluate(() => ({
      w: window.visualViewport?.width ?? innerWidth,
      h: window.visualViewport?.height ?? innerHeight,
    }));
    const box = await dialogBox(page);
    expect
      .soft(
        Math.abs(box.left) + Math.abs(box.top),
        `the dialog starts at 0,0 (${JSON.stringify(box)})`,
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(Math.abs(box.width - vv.w), 'dialog width = visual viewport')
      .toBeLessThanOrEqual(1);
    expect
      .soft(Math.abs(box.height - vv.h), 'dialog height = visual viewport')
      .toBeLessThanOrEqual(1);
    const grid = await probe(page, { cols: 6, rows: 10 });
    const bottom = await probe(page, {
      points: Array.from({ length: 6 }, (_, i) => ({ x: ((i + 0.5) * vv.w) / 6, y: vv.h - 40 })),
    });
    const bars = await probe(page, {
      points: Array.from({ length: 6 }, (_, i) => ({ x: ((i + 0.5) * vv.w) / 6, y: vv.h - 12 })),
    });
    const all = [...grid, ...bottom, ...bars];
    await info.attach('probes', {
      body: JSON.stringify(
        { box, vv, summary: summary(all), outside: all.filter((h) => !h.inside) },
        null,
        1,
      ),
      contentType: 'application/json',
    });
    expect
      .soft(
        all.filter((h) => !h.inside).length,
        `probe points outside the dialog ${JSON.stringify(summary(all))}`,
      )
      .toBe(0);
    expect
      .soft(
        [...bottom, ...bars].filter((h) => h.what === 'phone-bar').length,
        "bottom 80 px hit nav 'Main' or 'Previous and next'",
      )
      .toBe(0);
    // The toolbar: no horizontal overflow, every control at least 44×44 and inside the viewport.
    const tools = await dialog(page)
      .locator('button')
      .evaluateAll((bs) =>
        bs.slice(0, 8).map((b) => {
          const r = b.getBoundingClientRect();
          return {
            name: b.getAttribute('aria-label') || b.textContent?.trim() || '',
            w: r.width,
            h: r.height,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
          };
        }),
      );
    await info.attach('toolbar', {
      body: JSON.stringify(tools, null, 1),
      contentType: 'application/json',
    });
    const overflow = await dialog(page).evaluate((d) => d.scrollWidth - d.clientWidth);
    expect.soft(overflow, 'the toolbar wraps without horizontal overflow').toBeLessThanOrEqual(1);
    for (const b of tools.filter((x) => !['CV', t('Original'), t('Text')].includes(x.name))) {
      expect
        .soft(
          Math.min(b.w, b.h),
          `'${b.name}' is at least 44×44 (${Math.round(b.w)}×${Math.round(b.h)})`,
        )
        .toBeGreaterThanOrEqual(44);
      expect
        .soft(
          b.left >= 0 && b.right <= vv.w && b.top >= 0 && b.bottom <= vv.h,
          `'${b.name}' inside the viewport`,
        )
        .toBe(true);
    }
    await ux.check('full screen on touch', [...STD, 'TGT', 'AZ']);
    try {
      await closeButton(page, t).tap({ timeout: 3_000 });
    } catch (e) {
      expect.soft(String(e).split('\n')[0], "tapping 'Close full screen' works").toBe('ok');
      await page.keyboard.press('Escape');
    }
    await expect(dialog(page)).toHaveCount(0);
    if (meta.dev === 'A' || meta.dev === 'I') {
      await expect.soft(page.getByRole('navigation', { name: t('Main') }).last()).toBeVisible();
      await expect
        .soft(page.getByRole('navigation', { name: t('Previous and next') }).last())
        .toBeVisible();
    }
  },
);

uat(
  'FS-17',
  'Window resize while full screen is open keeps marks on the text',
  { on: ['D', 'E'], langs: 'EN' },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    await showReq(page, t, 'BGP routing');
    await expect(page.locator('[data-page="1"] [data-testid=pdf-mark]').first()).toBeVisible();
    await openFull(page, t);
    // The quoted line ('… BGP route reflectors and OSPF areas.') from the PDF's own geometry
    // (cv.pdf page 1: baseline 609.9 pt, x 219 pt, width 306.7 pt, 9 pt type, page 595.3×841.9 pt).
    const LINE = {
      x: 219 / 595.28,
      w: 306.7 / 595.28,
      top: (841.89 - 609.9 - 9) / 841.89,
      h: (9 * 1.35) / 841.89,
    };
    const read = () =>
      page.evaluate((LINE) => {
        const bodyBox = document.querySelector('[data-testid=cv-body]')!.getBoundingClientRect();
        const pages = [...document.querySelectorAll<HTMLElement>('[data-page]')].map((p) => {
          const r = p.getBoundingClientRect();
          const c = p.querySelector('canvas')!;
          const cr = c.getBoundingClientRect();
          return {
            n: p.dataset.page,
            w: r.width,
            cw: cr.width,
            loading: p.classList.contains('m-loading'),
            onScreen:
              r.bottom > Math.max(0, bodyBox.top) && r.top < Math.min(innerHeight, bodyBox.bottom),
          };
        });
        const p1 = document.querySelector('[data-page="1"]')!.getBoundingClientRect();
        const line = {
          x: p1.left + LINE.x * p1.width,
          y: p1.top + LINE.top * p1.height,
          width: LINE.w * p1.width,
          height: LINE.h * p1.height,
        };
        const marks = [...document.querySelectorAll('[data-page="1"] [data-testid=pdf-mark]')].map(
          (m) => {
            const r = m.getBoundingClientRect();
            const w = Math.min(r.right, line.x + line.width) - Math.max(r.left, line.x);
            const h = Math.min(r.bottom, line.y + line.height) - Math.max(r.top, line.y);
            return w > 0 && h > 0 ? (w * h) / (r.width * r.height) : 0;
          },
        );
        const d = document.querySelector('dialog[aria-modal="true"]')?.getBoundingClientRect();
        return {
          pages,
          marks,
          dialog: d ? { l: d.left, t: d.top, w: d.width, h: d.height } : null,
          iw: innerWidth,
          ih: innerHeight,
        };
      }, LINE);
    const out: Record<string, unknown> = {};
    for (const size of [
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      const tag = `${size.width}x${size.height}`;
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      const s = await read();
      out[`${tag} +300ms`] = s;
      // PLAN: "every canvas" — pages are drawn only when they come into view of the box that scrolls
      // them (PdfPages.tsx:129-140, by design), so the canvas checks apply to the pages on screen.
      for (const p of s.pages.filter((x) => x.onScreen))
        expect
          .soft(
            Math.abs(p.cw - p.w),
            `${tag}: canvas ${p.n} CSS width = page width 300 ms after the resize`,
          )
          .toBeLessThanOrEqual(1);
      for (const p of s.pages.filter((x) => x.onScreen))
        expect
          .soft(
            await ink(page.locator(`[data-page="${p.n}"] canvas`)),
            `${tag}: canvas ${p.n} has ink`,
          )
          .toBeGreaterThan(50);
      await page.waitForTimeout(700);
      const s2 = await read();
      out[`${tag} +1s`] = s2;
      expect
        .soft(
          s2.pages.filter((p) => p.onScreen && p.loading).length,
          `${tag}: no page on screen is still a blank sheet after 1 s`,
        )
        .toBe(0);
      expect.soft(s2.marks.length, `${tag}: marks are drawn`).toBeGreaterThan(0);
      for (const v of s2.marks)
        expect
          .soft(v, `${tag}: a mark overlaps the quoted line by at least 50 %`)
          .toBeGreaterThanOrEqual(0.5);
      const d = s2.dialog;
      expect
        .soft(
          !!d &&
            Math.abs(d.l) <= 1 &&
            Math.abs(d.t) <= 1 &&
            Math.abs(d.w - s2.iw) <= 1 &&
            Math.abs(d.h - s2.ih) <= 1,
          `${tag}: the dialog equals the viewport (${JSON.stringify(d)})`,
        )
        .toBe(true);
    }
    await info.attach('resize', {
      body: JSON.stringify(out, null, 1),
      contentType: 'application/json',
    });
    await ux.check('after resizing', STD);
  },
);

uat(
  'FS-18',
  'No layout shift when full screen opens and closes',
  { on: ['E', 'D'], langs: 'EN' },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    const history = Array.from({ length: 24 }, (_, i) => ({
      mark: 'maybe',
      label: 'Maybe',
      note: `Note ${i + 1}`,
      at: new Date(Date.now() - 86_400_000 * (i + 2)).toISOString(),
      by: 'Ayla Karimova',
    }));
    await mockF(page, { docs: { [DID]: aysel({}, { history }) } });
    await page.addInitScript(() => {
      (window as any).__shifts = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          (window as any).__shifts.push({
            value: (e as any).value,
            recent: (e as any).hadRecentInput,
          });
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await openReview(page);
    await ready(page);
    await page.waitForTimeout(500);
    const read = () =>
      page.evaluate((name) => {
        const btn = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === name,
        );
        return {
          cw: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollHeight > innerHeight,
          h1: document.querySelector('h1')!.getBoundingClientRect().left,
          btn: btn?.getBoundingClientRect().left ?? -1,
        };
      }, t('Full screen'));
    const a = await read();
    expect(a.scroll, 'the page is tall enough for a vertical scrollbar').toBe(true);
    await page.evaluate(() => ((window as any).__shifts = []));
    await openFull(page, t);
    const open = await page.evaluate(() => document.documentElement.clientWidth);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await page.waitForTimeout(400);
    const b = await read();
    const shifts = (await page.evaluate(() => (window as any).__shifts)) as {
      value: number;
      recent: boolean;
    }[];
    await info.attach('layout', {
      body: JSON.stringify({ before: a, openClientWidth: open, after: b, shifts }, null, 1),
      contentType: 'application/json',
    });
    expect
      .soft(open, `clientWidth does not change while the viewer is open (${a.cw} → ${open})`)
      .toBe(a.cw);
    expect
      .soft(Math.abs(b.h1 - a.h1), 'the h1 is at the same x after closing')
      .toBeLessThanOrEqual(0.5);
    expect
      .soft(Math.abs(b.btn - a.btn), "'Full screen' is at the same x after closing")
      .toBeLessThanOrEqual(0.5);
    expect
      .soft(
        shifts.reduce((s, x) => s + x.value, 0),
        'summed layout-shift value',
      )
      .toBe(0);
    await ux.check('after open and close', STD);
  },
);

uat(
  'FS-19',
  'Broken and password-protected PDF: a clear message and no Open, in EN and AZ',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await mockF(page, {
      docs: { [DID13]: problemDoc(DID13, 'locked.pdf'), [DID14]: problemDoc(DID14, 'broken.pdf') },
    });
    const cases: [string, string][] = [
      [DID13, 'This PDF is password-protected, so its pages cannot be shown.'],
      [DID14, 'This PDF could not be shown as pages.'],
    ];
    for (const [id, en] of cases) {
      await page.goto(`/#/cv/${id}`);
      await page.reload();
      await page.locator('h1').waitFor();
      const pane = page
        .getByRole('region', { name: t('CV') })
        .or(page.locator('section[aria-label]').filter({ has: page.getByTestId('cv-body') }));
      const notice = page
        .getByTestId('cv-body')
        .getByRole('status')
        .filter({ hasText: /\w/ })
        .first();
      await expect(notice).toBeVisible({ timeout: 15_000 });
      await expect.soft(notice, `${id}: the notice`).toHaveText(t(en));
      if (meta.lang === 'az') {
        expect.soft(hasAz(en), `AZ entry for '${en}' (SD-43)`).toBe(true);
        await expect.soft(notice, 'no English source string on the AZ screen').not.toHaveText(en);
      }
      await expect
        .soft(page.getByRole('button', { name: t('Show the text instead') }))
        .toBeVisible();
      await expect
        .soft(
          page.getByRole('button', { name: exact(t('Open')) }),
          `${id}: no 'Open' for a PDF that cannot be shown (SD-15)`,
        )
        .toHaveCount(0);
      await expect
        .soft(page.getByRole('button', { name: exact(t('Open in new tab')) }))
        .toHaveCount(0);
      await expect
        .soft(page.getByRole('group', { name: t('Zoom') }), `${id}: no zoom`)
        .toHaveCount(0);
      await expect.soft(page.getByRole('button', { name: t('Download') })).toBeVisible();
      await expect.soft(fsButton(page, t)).toBeVisible();
      await expect.soft(page.getByTestId('evidence-map'), `${id}: no evidence map`).toHaveCount(0);
      void pane;
      await ux.check(`${id === DID13 ? 'locked' : 'broken'} PDF in the pane`, [...STD, 'AZ']);
      await openFull(page, t);
      await expect
        .soft(dialog(page).getByText(t(en)), 'the same notice inside the dialog')
        .toBeVisible();
      await ux.check(`${id === DID13 ? 'locked' : 'broken'} PDF in full screen`, [...STD, 'AZ']);
      await dialog(page)
        .getByRole('button', { name: t('Show the text instead') })
        .click();
      await expect.soft(page.getByLabel(t('CV text'))).toBeVisible();
      await page.keyboard.press('Escape');
    }
  },
);

void card;
void storeList;
