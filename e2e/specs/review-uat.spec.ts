import type { Page } from '@playwright/test';
import { DID, DID2, MID, openReview, PDF, VID } from '../fixtures/api';
import {
  AYSEL_TEXT,
  aysel,
  card,
  DID15,
  DID10,
  DID11,
  DID4,
  DID5,
  DID6,
  DID7,
  DID8,
  DID9,
  DIDX,
  DIDY,
  DIDZ,
  exact,
  ink,
  isTabs,
  leyla,
  MIDX,
  mockF,
  poll,
  raufReal,
  ready,
  req,
  S6,
  settle,
  showReq,
  stateDoc,
  T,
  toAnalysis,
} from '../fixtures/pkg-f';
import { settled } from '../ux/checks';
import { expect, STD, uat } from '../ux/test';

// 7.17 The CV review screen (CV-01 … CV-22, L1). The older e2e/specs/review.spec.ts is a plain
// Playwright smoke file; the UAT cases live here so that file stays as it is.

type Tr = ReturnType<typeof T>;
const NAME = 'Aysel Məmmədova';
const now = () => new Date().toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const decisionSel = (page: Page, t: Tr, name = NAME) =>
  page.getByRole('combobox', { name: t('Decision for {name}', { name }) });
/** The Previous/Next bar that is shown (top bar on md and wider, bottom bar on phones). */
const prevNext = (page: Page, t: Tr) =>
  page
    .getByRole('navigation', { name: t('Previous and next') })
    .filter({ visible: true })
    .first();
const puts = (seen: { requests: { method: string; url: string; body: unknown }[] }) =>
  seen.requests.filter((r) => r.method === 'PUT' && /\/candidates\/\w+\/decision$/.test(r.url));
const liveText = (page: Page) => page.locator('p[role=status][aria-live=polite].sr-only');

// ------------------------------------------------------------------ CV-01 header and top bar

uat(
  'CV-01',
  'Review header and top bar on desktop',
  { on: ['D', 'DW', 'E'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const history = [
      { mark: 'shortlist', label: 'Shortlist', note: null, at: daysAgo(2), by: 'Ayla Karimova' },
    ];
    await mockF(page, { docs: { [DID]: aysel({}, { history, analyzedAt: now() }) } });
    await openReview(page);
    await ready(page);
    const back = page.getByRole('link', { name: t('← Back to {list}', { list: 'Candidates' }) });
    await expect(back).toBeVisible();
    const bar = back.locator('xpath=..');
    await expect.soft(bar, 'the top bar is sticky').toHaveCSS('position', 'sticky');
    await expect.soft(bar, 'the top bar sits 56 px from the top').toHaveCSS('top', '56px');
    const nav = prevNext(page, t);
    const prev = nav.getByRole('link', { name: t('‹ Previous CV') });
    await expect.soft(prev).toHaveAttribute('aria-disabled', 'true');
    expect
      .soft(
        await prev.evaluate((e) => (e as HTMLElement).tabIndex),
        "'‹ Previous CV' is not in the Tab order",
      )
      .toBeLessThan(0);
    await expect
      .soft(nav.getByText(t('CV {a} of {b}', { a: 1, b: 2 }), { exact: true }))
      .toBeVisible();
    await expect
      .soft(nav.getByRole('link', { name: t('Next CV ›') }))
      .toHaveAttribute('title', t('Next CV (J)'));
    await expect
      .soft(liveText(page), 'the live region')
      .toHaveText(t('CV {a} of {b}: {name}', { a: 1, b: 2, name: NAME }));
    const dial = page.getByRole('img', { name: t('Match {n}%', { n: 88 }) });
    await expect.soft(dial).toBeVisible();
    await expect.soft(dial, 'the dial shows 88').toContainText('88', { timeout: 4_000 });
    const focus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent,
      y: window.scrollY,
    }));
    expect.soft(focus.tag, 'h1 has focus').toBe('H1');
    expect.soft(focus.text).toBe(NAME);
    expect.soft(focus.y, 'the page did not scroll for the focus').toBe(0);
    await expect
      .soft(page.getByRole('link', { name: 'Network Engineer', exact: true }))
      .toHaveAttribute('href', `#/vacancies/${VID}`);
    const header = page.locator('header').filter({ has: page.locator('h1') });
    for (const chip of [
      t('Analyzed'),
      t('Strong'),
      t('Must-haves {a} of {b}', { a: 3, b: 4 }),
      t('Analyzed {when}', { when: t('just now') }),
    ])
      await expect.soft(header.getByText(chip, { exact: true }), `chip '${chip}'`).toBeVisible();
    const sel = decisionSel(page, t);
    await expect.soft(sel).toHaveValue('new');
    expect
      .soft(await sel.evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.textContent))
      .toBe(t('New'));
    const hints = header.locator('kbd').first().locator('xpath=..');
    await expect
      .soft(hints, 'key hints')
      .toHaveText(`S ${t('Shortlist')} · M ${t('Maybe')} · N ${t('Not now')}`);
    await expect
      .soft(page.getByRole('switch', { name: t('Next CV after a key decision') }))
      .toBeChecked();
    await expect.soft(page.getByPlaceholder(t('Add a note (optional)'))).toBeVisible();
    await expect.soft(page.getByRole('button', { name: t('Save note') })).toBeDisabled();
    if (meta.lang === 'az') {
      expect.soft(t('Match {n}%', { n: 88 })).toBe('Uyğunluq 88%');
      expect.soft(t('CV {a} of {b}', { a: 1, b: 2 })).toBe('CV 1 / 2');
      expect.soft(t('Next CV after a key decision')).toBe('Düymə ilə qərardan sonra növbəti CV');
    }
    await ux.check('review header', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ CV-02 deciding

uat(
  'CV-02',
  'Deciding with the Decision select, Undo and a version conflict',
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const seen = await mockF(page, { live: true });
    await openReview(page);
    await ready(page, 2);
    const sel = decisionSel(page, t);
    await sel.selectOption('maybe');
    await expect.poll(() => puts(seen).length).toBe(1);
    expect
      .soft(puts(seen)[0]!.body, 'step 1 PUT')
      .toEqual({ mark: 'maybe', note: null, expectedVersion: 0 });
    expect.soft(puts(seen)[0]!.url).toBe(`/candidates/${MID}/decision`);
    const toast = page
      .getByRole('status')
      .filter({ has: page.getByRole('button', { name: t('Undo') }) });
    await expect
      .soft(toast, "toast 'Marked Maybe.'")
      .toContainText(t('Marked {mark}.', { mark: t('Maybe') }));
    await expect
      .soft(
        page.getByText(
          t('Marked by {name} {when}', { name: 'Ayla Karimova', when: t('just now') }),
        ),
      )
      .toBeVisible();
    expect
      .soft(page.url(), 'the select never advances')
      .toMatch(new RegExp(`#/cv/${DID}\\?l=e2e-list$`));
    await expect.soft(sel).toHaveValue('maybe');
    if (meta.dev === 'A') {
      // The toast sits above the bottom bars (measured once its slide-in has finished).
      await toast.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const r = await page.evaluate(() => {
        const toast = [...document.querySelectorAll('[role=status]')]
          .find((e) => e.querySelector('button'))!
          .getBoundingClientRect();
        const bars = [...document.querySelectorAll('nav')]
          .map((n) => n.closest('div.fixed, nav.fixed'))
          .filter((x): x is Element => !!x && getComputedStyle(x).display !== 'none')
          .map((b) => b.getBoundingClientRect().top);
        return { bottom: toast.bottom, barTop: Math.min(...bars) };
      });
      expect
        .soft(r.bottom, `the toast is above the bottom bars (${JSON.stringify(r)})`)
        .toBeLessThanOrEqual(r.barTop + 0.5);
    }
    await ux.check('marked Maybe with the toast', [...STD, 'AZ']);
    await toast.getByRole('button', { name: t('Undo') }).click();
    await expect.poll(() => puts(seen).length).toBe(2);
    expect.soft(puts(seen)[1]!.body, 'Undo PUT').toMatchObject({ mark: 'new', expectedVersion: 1 });
    await expect.soft(sel).toHaveValue('new');
    // Someone else changes the decision meanwhile: the next PUT is stale.
    seen.store.set(MID, {
      mark: 'not_now',
      note: null,
      version: 9,
      decidedAt: now(),
      decidedBy: 'Rauf Quliyev',
    });
    ux.allow(/409/, /STALE_VERSION/, /Someone else changed/);
    await sel.selectOption('shortlist');
    await expect.poll(() => puts(seen).length).toBe(3);
    await expect
      .soft(sel, "the select shows the server's mark after the reload")
      .toHaveValue('not_now');
    await page.waitForTimeout(500);
    await expect
      .soft(
        page.getByRole('alert').filter({ hasText: /\w/ }).first(),
        'the 409 shows an error notice (still there after the reload)',
      )
      .toBeVisible({ timeout: 1_000 });
    await ux.check('version conflict', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ CV-03 note

uat('CV-03', 'Note and Save note', { on: ['D', 'A'] }, async ({ page, ux, meta }) => {
  const t = T(meta.lang);
  const seen = await mockF(page, { live: true });
  await openReview(page);
  await ready(page, 2);
  const note = page.getByPlaceholder(t('Add a note (optional)'));
  const save = page.getByRole('button', { name: t('Save note') });
  await expect(save).toBeDisabled();
  await note.click();
  await note.pressSequentially('Strong BGP; ask about 5G');
  await expect.soft(save).toBeEnabled();
  await save.click();
  await expect.poll(() => puts(seen).length).toBe(1);
  expect
    .soft(puts(seen)[0]!.body)
    .toEqual({ mark: 'new', note: 'Strong BGP; ask about 5G', expectedVersion: 0 });
  await expect.soft(save, 'Save note is disabled again').toBeDisabled();
  await expect.soft(note).toHaveValue('Strong BGP; ask about 5G');
  // "A short confirmation is shown or announced" (SD-102).
  const said = page
    .getByRole('status')
    .filter({ hasNotText: new RegExp(`^(${NAME}|CV \\d)`) })
    .filter({ hasText: /\w/ });
  await expect
    .soft(said.first(), 'a confirmation is shown or announced after Save note')
    .toBeAttached({ timeout: 3_000 });
  await ux.check('note saved', [...STD, 'AZ']);
  // The box stops at 2,000 characters.
  await note.fill('');
  await note.focus();
  await page.keyboard.insertText('x'.repeat(2_100));
  expect.soft((await note.inputValue()).length, 'the note stops at 2,000 characters').toBe(2_000);
  // Typing j, k, s, m, n in the note changes nothing.
  await note.fill('');
  const url = page.url();
  const before = puts(seen).length;
  await note.pressSequentially('jksmn');
  await page.waitForTimeout(400);
  expect.soft(page.url()).toBe(url);
  expect.soft(puts(seen).length, 'no PUT from typing').toBe(before);
  await expect.soft(decisionSel(page, t)).toHaveValue('new');
  if (meta.lang === 'az') await expect.soft(save).toHaveText('Qeydi saxlayın');
});

// ------------------------------------------------------------------ CV-04 note survives the refresh

uat(
  'CV-04',
  "The note being typed survives while a Word CV's pages are prepared",
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux, meta, info }) => {
    test_timeout(info, 60_000);
    const t = T(meta.lang);
    const seen = await mockF(page, {
      live: true,
      docs: { [DID4]: (n: number) => leyla(n <= 3 ? 'pending' : 'pdf') },
    });
    await page.goto(`/#/cv/${DID4}`);
    await page.locator('h1').waitFor();
    await expect
      .soft(
        page.getByText(
          t(
            'The pages of this Word file are being prepared. They appear here by themselves; the text below was read from the file.',
          ),
        ),
      )
      .toBeVisible();
    const note = page.getByPlaceholder(t('Add a note (optional)'));
    await note.click();
    await note.pressSequentially('Call on Monday');
    const caret = () => note.evaluate((e: HTMLTextAreaElement) => e.selectionStart);
    await page.waitForTimeout(9_000);
    await expect.soft(note, 'the note after two refreshes (SD-09)').toHaveValue('Call on Monday');
    expect.soft(await caret(), 'the caret is where it was').toBe(14);
    await ux.check('typing during the refreshes', STD);
    await poll(
      () => ink(page.locator('[data-page="1"] canvas')),
      (v) => v > 50,
      15_000,
      'the Word pages arrive',
    );
    await expect.soft(note, 'the note after the pages arrive').toHaveValue('Call on Monday');
    const save = page.getByRole('button', { name: t('Save note') });
    await expect.soft(save).toBeEnabled();
    if (await save.isEnabled()) {
      await save.click();
      await expect.poll(() => puts(seen).length).toBe(1);
      expect.soft((puts(seen)[0]!.body as any).note).toBe('Call on Monday');
    }
  },
);

function test_timeout(info: { setTimeout: (n: number) => void }, ms: number) {
  info.setTimeout(ms);
}

// ------------------------------------------------------------------ CV-05 Back, Previous, Next

uat(
  'CV-05',
  'Back, Previous and Next on desktop and tablet',
  { on: ['D', 'E', 'T'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const seen = await mockF(page);
    await page.addInitScript(() => {
      (window as any).__nav = [];
      new MutationObserver(() => {
        const v = document.documentElement?.dataset.nav;
        const all = (window as any).__nav as string[];
        if (v && all[all.length - 1] !== v) all.push(v);
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-nav'] });
    });
    await openReview(page);
    await ready(page);
    await expect
      .poll(
        () => seen.requests.some((r) => r.method === 'GET' && r.url === `/documents/${DID2}`),
        'GET /documents/DID2 prefetched',
      )
      .toBe(true);
    const filesBefore = seen.requests.filter((r) =>
      new RegExp(`/documents/${DID2}/(view|text|file)`).test(r.url),
    );
    expect.soft(filesBefore, 'no file of DID2 is fetched ahead').toEqual([]);
    const top = prevNext(page, t);
    if (meta.dev === 'T') {
      await expect
        .soft(top.locator('xpath=..'), 'on T the bar is at the top and sticky')
        .toHaveCSS('position', 'sticky');
    }
    await top.getByRole('link', { name: t('Next CV ›') }).click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID2}\\?l=e2e-list$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Rauf Əliyev' })).toBeVisible();
    await expect
      .soft(page.getByRole('heading', { level: 1, name: 'Rauf Əliyev' }), 'h1 focused')
      .toBeFocused();
    await expect
      .soft(liveText(page))
      .toHaveText(t('CV {a} of {b}: {name}', { a: 2, b: 2, name: 'Rauf Əliyev' }));
    await expect
      .soft(prevNext(page, t).getByRole('link', { name: t('Next CV ›') }))
      .toHaveAttribute('aria-disabled', 'true');
    await ux.check('CV 2 of 2', [...STD, 'AZ']);
    await prevNext(page, t)
      .getByRole('link', { name: t('‹ Previous CV') })
      .click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}\\?l=e2e-list$`));
    const navs = await page.evaluate(() => (window as any).__nav as string[]);
    expect.soft(navs, "html data-nav was 'next', then 'prev'").toEqual(['next', 'prev']);
    await page.getByRole('link', { name: t('← Back to {list}', { list: 'Candidates' }) }).click();
    await expect(page).toHaveURL(/#\/candidates$/);
    await expect.soft(page.getByRole('link', { name: NAME }).first()).toBeVisible();
  },
);

// ------------------------------------------------------------------ CV-06 phone bar

async function probeBar(page: Page, t: Tr) {
  return page.evaluate((label) => {
    const navs = [...document.querySelectorAll(`nav[aria-label="${label}"]`)].filter(
      (n) => getComputedStyle(n.closest('div')!).display !== 'none' && n.closest('div.fixed'),
    );
    const bar = navs[0];
    if (!bar)
      return {
        found: false,
        items: [] as { name: string; top: boolean; h: number; hit: string }[],
      };
    const items = [...bar.children].map((c) => {
      const r = c.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        name: (c.textContent ?? '').trim(),
        top: !!hit && (hit === c || c.contains(hit)),
        h: r.height,
        hit: hit ? `${hit.tagName} ${(hit.textContent ?? '').trim().slice(0, 30)}` : '',
      };
    });
    return { found: true, items };
  }, t('Previous and next'));
}

uat(
  'CV-06',
  'Phone bottom Previous/Next bar is reachable',
  { on: ['A', 'I'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await mockF(page, { live: true });
    const check = async (label: string) => {
      const r = await probeBar(page, t);
      await info.attach(label, {
        body: JSON.stringify(r, null, 1),
        contentType: 'application/json',
      });
      expect.soft(r.found, `${label}: the bottom bar is there`).toBe(true);
      for (const it of r.items) {
        expect
          .soft(
            it.top,
            `${label}: '${it.name}' is the topmost element at its centre (hit ${it.hit})`,
          )
          .toBe(true);
        if (
          it.name !== t('CV {a} of {b}', { a: 1, b: 2 }) &&
          it.name !== t('CV {a} of {b}', { a: 2, b: 2 })
        )
          expect
            .soft(it.h, `${label}: '${it.name}' is at least 44 px tall`)
            .toBeGreaterThanOrEqual(44);
      }
    };
    for (const size of [null, { width: 700, height: 900 }]) {
      const tag = size ? '700px' : `${page.viewportSize()!.width}px`;
      if (size) await page.setViewportSize(size);
      await openReview(page);
      await page.reload();
      await ready(page);
      await check(`${tag} on open`);
      await decisionSel(page, t).selectOption('shortlist');
      await expect(page.getByRole('button', { name: t('Undo') })).toBeVisible();
      await check(`${tag} with the Undo toast`);
      await ux.check(`bottom bar with toast ${tag}`, [...STD, 'AZ']);
      // The page end: the last analysis card is fully above the bar.
      await toAnalysis(page, t);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      const end = await page.evaluate((label) => {
        const lis = [...document.querySelectorAll('[data-testid=analysis-pane] li')];
        const last = lis[lis.length - 1]!.getBoundingClientRect();
        const bar = [...document.querySelectorAll(`nav[aria-label="${label}"]`)]
          .map((n) => n.closest('div.fixed'))
          .find((d) => d && getComputedStyle(d).display !== 'none');
        return {
          lastBottom: last.bottom,
          barTop: bar ? bar.getBoundingClientRect().top : innerHeight,
        };
      }, t('Previous and next'));
      expect
        .soft(end.lastBottom, `${tag}: the last analysis card is fully visible above the bar`)
        .toBeLessThanOrEqual(end.barTop);
      // Reset the decision for the next size.
      await decisionSel(page, t).selectOption('new');
    }
    // The tap opens the next CV.
    await page.evaluate(() => window.scrollTo(0, 0));
    const bar = page.locator('div.fixed').getByRole('navigation', { name: t('Previous and next') });
    await bar.getByRole('link', { name: t('Next CV ›') }).tap();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID2}\\?l=e2e-list$`));
  },
);

// ------------------------------------------------------------------ CV-07 tabs

uat(
  'CV-07',
  'CV and Analysis tabs on tablet and phone',
  { on: ['T', 'TL', 'A', 'I', 'DS'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    if (meta.dev === 'DS') await page.setViewportSize({ width: 1024, height: 768 });
    await mockF(page);
    await openReview(page);
    await ready(page);
    const list = page.getByRole('tablist', { name: t('View'), exact: true });
    if (meta.dev === 'TL') {
      // 1180 px leaves the content 60 rem or more, where the app shows the CV and the Analysis side
      // by side (the tabs are for narrower screens): no tabs here, both panes on screen.
      await expect(list, 'no tabs when the two panes fit').toBeHidden();
      await expect.soft(page.getByTestId('cv-pane')).toBeVisible();
      await expect.soft(page.getByTestId('analysis-pane')).toBeVisible();
      await expect.soft(page.getByRole('separator', { name: t('Resize the panes') })).toBeVisible();
      await ux.check('two panes', [...STD, 'AZ']);
      return;
    }
    await expect(list, "a tablist 'View'").toBeVisible();
    const cvTab = list.getByRole('tab', { name: t('CV'), exact: true });
    const anTab = list.getByRole('tab', { name: t('Analysis') });
    await expect.soft(cvTab).toHaveAttribute('aria-selected', 'true');
    await expect
      .soft(page.getByRole('separator', { name: t('Resize the panes') }), 'the divider is hidden')
      .toBeHidden();
    await expect.soft(page.getByTestId('analysis-pane'), 'the analysis is hidden').toBeHidden();
    if (meta.dev === 'A' || meta.dev === 'I') {
      const top = await page
        .getByTestId('cv-pane')
        .evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
      expect
        .soft(top, 'the top of the CV pane is within the first screen height')
        .toBeLessThan(page.viewportSize()!.height);
    }
    await ux.check('CV tab', [...STD, 'AZ']);
    await anTab.click();
    await expect.soft(page.getByTestId('analysis-pane')).toBeVisible();
    await expect.soft(page.getByTestId('cv-pane')).toBeHidden();
    await card(page, '5G transport experience')
      .getByRole('button', { name: t('Show in CV') })
      .click();
    await expect
      .soft(cvTab, "'Show in CV' switches back to 'CV'")
      .toHaveAttribute('aria-selected', 'true');
    const mark = page.locator('[data-page="2"] [data-testid=pdf-mark]').first();
    await expect.soft(mark).toBeAttached({ timeout: 8_000 });
    await page.waitForTimeout(900);
    const inView = await page.evaluate(() => {
      const p = document.querySelector('[data-page="2"]')!.getBoundingClientRect();
      return p.bottom > 0 && p.top < innerHeight;
    });
    expect.soft(inView, 'page 2 with the mark is inside the viewport').toBe(true);
    // Keys and relations of the tabs.
    await cvTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect.soft(anTab, 'ArrowRight moves to Analysis').toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect.soft(cvTab, 'ArrowLeft moves back to CV').toBeFocused();
    for (const tab of [cvTab, anTab]) {
      const id = await tab.getAttribute('aria-controls');
      expect.soft(id, 'the tab has aria-controls').toBeTruthy();
      if (id)
        expect
          .soft(
            await page.locator(`#${id}`).getAttribute('role'),
            'aria-controls points to a tabpanel',
          )
          .toBe('tabpanel');
    }
    if (meta.lang === 'az') expect.soft(t('Analysis')).toBe('Təhlil');
    await ux.check('after Show in CV', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ CV-08 divider

uat(
  'CV-08',
  'Resizing the panes with the divider',
  { on: ['D', 'DW'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    const sep = page.getByRole('separator', { name: t('Resize the panes') });
    await expect(sep).toBeVisible();
    await expect.soft(sep).toHaveAttribute('aria-orientation', 'vertical');
    await expect.soft(sep).toHaveAttribute('aria-valuemin', '28');
    await expect.soft(sep).toHaveAttribute('aria-valuemax', '72');
    await expect.soft(sep).toHaveAttribute('aria-valuenow', '50');
    const row = await sep.locator('xpath=..').boundingBox();
    const s = await sep.boundingBox();
    const dragTo = async (share: number) => {
      await page.mouse.move(s!.x + s!.width / 2, s!.y + 40);
      await page.mouse.down();
      await page.mouse.move(row!.x + row!.width * share, s!.y + 40, { steps: 8 });
      await page.mouse.up();
    };
    await dragTo(0.3);
    const v30 = Number(await sep.getAttribute('aria-valuenow'));
    expect
      .soft(Math.abs(v30 - 30), `dragging to 30 % gives about 30 (${v30})`)
      .toBeLessThanOrEqual(2);
    const basis = await page
      .getByTestId('cv-pane')
      .evaluate((e) => (e as HTMLElement).style.flexBasis);
    expect.soft(parseFloat(basis), "the CV column's flex-basis follows").toBeCloseTo(v30, 0);
    const s2 = await sep.boundingBox();
    await page.mouse.move(s2!.x + s2!.width / 2, s2!.y + 40);
    await page.mouse.down();
    await page.mouse.move(row!.x + row!.width * 0.9, s2!.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect.soft(sep, 'dragging to 90 % stops at 72').toHaveAttribute('aria-valuenow', '72');
    await sep.focus();
    const ring = await sep.evaluate((e) => getComputedStyle(e).boxShadow);
    expect.soft(ring, 'the separator has a visible focus ring').not.toBe('none');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.soft(sep).toHaveAttribute('aria-valuenow', '66');
    await page.keyboard.press('ArrowRight');
    await expect.soft(sep).toHaveAttribute('aria-valuenow', '68');
    await page.keyboard.press('Home');
    await expect.soft(sep).toHaveAttribute('aria-valuenow', '28');
    await page.keyboard.press('End');
    await expect.soft(sep).toHaveAttribute('aria-valuenow', '72');
    await page.keyboard.press('ArrowLeft');
    await ux.check('separator moved', STD);
    await page.reload();
    await ready(page);
    await expect
      .soft(
        page.getByRole('separator', { name: t('Resize the panes') }),
        'the value is kept after reload',
      )
      .toHaveAttribute('aria-valuenow', '70');
    expect.soft(await page.evaluate(() => localStorage.getItem('cv-report-split'))).toBe('70');
    // In the tabs layout it is hidden.
    await page.setViewportSize({ width: 900, height: 900 });
    await expect
      .soft(
        page.getByRole('separator', { name: t('Resize the panes') }),
        'hidden in the tabs layout',
      )
      .toBeHidden();
  },
);

// ------------------------------------------------------------------ CV-09 analysis pane

function fourteen() {
  const q = (s: string) => ({ quotes: [s] });
  return [
    req('M1', 'BGP routing', { kind: 'must', ...q('BGP route reflectors'), page: 1 }),
    req('M2', 'OSPF', { kind: 'must', state: 'partly', ...q('OSPF areas'), page: 1 }),
    req('M3', 'CCIE certification', { kind: 'must', state: 'missing', notFound: false }),
    req('M4', 'Python automation', { kind: 'must', state: 'missing', notFound: true }),
    req('M5', 'On-call experience', {
      kind: 'must',
      state: 'partly',
      unclear: true,
      ...q('5G transport rollout'),
      page: 2,
    }),
    req('M6', 'Team leadership', { kind: 'must', state: 'partly' }),
    req('N1', 'MPLS', { kind: 'nice', ...q('BGP route reflectors'), page: 1 }),
    req('N2', 'Juniper', { kind: 'nice', state: 'missing', notFound: true }),
    req('N3', 'Cisco IOS-XR', { kind: 'nice', state: 'partly', ...q('OSPF areas'), page: 1 }),
    req('N4', 'Azerbaijani', { kind: 'nice', state: 'missing' }),
    req('N5', 'English', { kind: 'nice', ...q('5G transport rollout'), page: 2 }),
    req('O1', 'Driving licence', { kind: 'other', state: 'missing', notFound: true }),
    req('O2', 'Based in Bakı', { kind: 'other', ...q('Network Engineer'), page: 1 }),
    req('O3', 'Shift work', { kind: 'other', state: 'missing', unclear: true }),
  ];
}

uat(
  'CV-09',
  'Analysis pane: summary, requirement cards, not found versus missing, history',
  { on: ['D', 'T'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const history = [
      {
        mark: 'shortlist',
        label: 'Shortlist',
        note: 'Call on Monday',
        at: daysAgo(2),
        by: 'Ayla Karimova',
      },
      { mark: 'maybe', label: 'Maybe', note: null, at: daysAgo(3), by: 'Ayla Karimova' },
    ];
    const reqs = fourteen();
    await mockF(page, {
      docs: { [DID]: aysel({}, { requirements: reqs, history, mustTotal: 6, mustFound: 2 }) },
    });
    await openReview(page);
    await ready(page);
    await toAnalysis(page, t);
    const pane = page.getByTestId('analysis-pane');
    await expect.soft(pane.getByRole('heading', { name: t('Summary') })).toBeVisible();
    await expect.soft(pane.getByText('Ten years of carrier network design.')).toBeVisible();
    for (const [name, n] of [
      [t('Must-haves'), 6],
      [t('Nice-to-haves'), 5],
      [t('Other'), 3],
    ] as const)
      await expect
        .soft(pane.getByRole('region', { name }).locator('li'), `section '${name}'`)
        .toHaveCount(n);
    const chip = (text: string) => card(page, text).locator('span.rounded-full').first();
    await expect.soft(chip('BGP routing')).toHaveText(t('Matched'));
    await expect.soft(chip('BGP routing').locator('svg'), "'Matched' has a tick").toHaveCount(1);
    await expect.soft(chip('OSPF')).toHaveText(t('Partly'));
    await expect.soft(chip('CCIE certification')).toHaveText(t('Missing'));
    await expect
      .soft(chip('Python automation'), 'not found says Not found (MATCH-04)')
      .toHaveText(t('Not found'));
    await expect.soft(chip('Juniper')).toHaveText(t('Not found'));
    await expect.soft(chip('On-call experience')).toHaveText(t('Unclear'));
    await expect
      .soft(card(page, 'BGP routing').getByText('Stated in the work history with dates.'))
      .toBeVisible();
    await expect
      .soft(card(page, 'BGP routing').getByRole('button', { name: t('Show in CV') }))
      .toBeVisible();
    await expect
      .soft(card(page, 'BGP routing').getByText(t('Page {n}', { n: 1 }), { exact: true }))
      .toBeVisible();
    for (const r of [
      'CCIE certification',
      'Python automation',
      'Team leadership',
      'Juniper',
      'Azerbaijani',
      'Driving licence',
      'Shift work',
    ])
      await expect
        .soft(card(page, r).getByText(t('Nothing to show in the CV.')), `'${r}' without quotes`)
        .toBeVisible();
    const notFoundCards = pane.locator('li').filter({ hasText: t('Not found') });
    await expect
      .soft(
        notFoundCards.filter({ hasText: new RegExp(`\\b${t('Missing')}\\b`) }),
        "a not-found card never says 'Missing'",
      )
      .toHaveCount(0);
    const hist = pane
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: t('Decision history') }) });
    await expect
      .soft(hist.locator('li').first())
      .toHaveText(
        `${t('Shortlist')} · Ayla Karimova · ${t('{n} days ago', { n: 2 })} · Call on Monday`,
      );
    await expect.soft(hist.locator('li')).toHaveCount(2);
    await page.waitForTimeout(2_000);
    const vis = await pane.locator('li').evaluateAll((lis) =>
      lis
        .filter((li) => li.closest('section[aria-label]'))
        .map((li) => ({
          op: getComputedStyle(li).opacity,
          h: li.getBoundingClientRect().height,
          tr: getComputedStyle(li).transform,
        })),
    );
    expect.soft(vis.length).toBe(14);
    expect
      .soft(
        vis.filter((v) => v.op !== '1' || v.h < 10).length,
        'all 14 cards fully visible after 2 s',
      )
      .toBe(0);
    await ux.check('analysis pane', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ CV-10 Show in CV / Hide in CV

uat('CV-10', 'Show in CV and Hide in CV', { on: ['D', 'T', 'A'] }, async ({ page, ux, meta }) => {
  const t = T(meta.lang);
  await mockF(page, { docs: { [DID2]: raufReal() } });
  await openReview(page);
  await ready(page);
  const tabs = await isTabs(page, t);
  const cvSelected = async (label: string) => {
    if (tabs)
      await expect
        .soft(
          page
            .getByRole('tablist', { name: t('View'), exact: true })
            .getByRole('tab', { name: t('CV'), exact: true }),
          `${label}: the CV tab is selected`,
        )
        .toHaveAttribute('aria-selected', 'true');
  };
  await showReq(page, t, '5G transport experience');
  await cvSelected('step 1');
  const p2 = page.locator('[data-page="2"]');
  await expect
    .soft(p2, 'page 2 flashes with a focus ring')
    .toHaveClass(/ring-4/, { timeout: 1_500 });
  await expect
    .soft(page.locator('[data-page="2"] [data-testid=pdf-mark]').first(), 'a mark on page 2')
    .toBeVisible();
  await expect
    .soft(p2, 'the ring goes after about 1.6 s')
    .not.toHaveClass(/ring-4/, { timeout: 3_000 });
  await toAnalysis(page, t);
  const c5 = card(page, '5G transport experience');
  const hide = c5.getByRole('button', { name: t('Hide in CV') });
  await expect.soft(hide).toHaveAttribute('aria-pressed', 'true');
  await expect.soft(c5, 'the card is highlighted').toHaveClass(/bg-sel/);
  await ux.check('requirement shown', [...STD, 'AZ']);
  await hide.click();
  await expect
    .soft(page.locator('[data-testid=pdf-mark]'), 'Hide removes the marks')
    .toHaveCount(0);
  await toAnalysis(page, t);
  await expect.soft(c5, 'and the highlight').not.toHaveClass(/bg-sel/);
  await showReq(page, t, 'BGP routing');
  await cvSelected('step 3');
  await expect
    .soft(page.locator('[data-page="1"] [data-testid=pdf-mark]').first(), 'step 3 marks page 1')
    .toBeVisible();
  await expect.soft(page.locator('[data-page="2"] [data-testid=pdf-mark]')).toHaveCount(0);
  // Rauf's text CV.
  await page.goto(`/#/cv/${DID2}?l=e2e-list`);
  await expect(page.getByRole('heading', { level: 1, name: 'Rauf Əliyev' })).toBeVisible();
  await showReq(page, t, 'OSPF');
  await cvSelected('step 4');
  const box = page.getByLabel(t('CV text'));
  const mark = box.locator('mark');
  await expect.soft(mark).toHaveText('OSPF areas');
  const r = await box.evaluate((el) => {
    const m = el.querySelector('mark')!.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { inside: m.top >= b.top && m.bottom <= b.bottom };
  });
  expect.soft(r.inside, 'the <mark> is in view inside the text box').toBe(true);
  if (meta.lang === 'az') {
    expect.soft(t('Show in CV')).toBe('CV-də göstərin');
    expect.soft(t('Hide in CV')).toBe('CV-də gizlədin');
  }
  await ux.check('text CV marked', [...STD, 'AZ']);
});

// ------------------------------------------------------------------ CV-11 out of date

uat(
  'CV-11',
  'Out-of-date and re-analyzing notice',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const changes = Array.from({ length: 5 }, (_, i) => ({
      version: i + 2,
      at: daysAgo(5 - i),
      by: 'Aysel Mammadova',
      description: `Changed requirement ${i + 1}`,
    }));
    const outOfDate = { scoredAgainst: daysAgo(10), changes };
    await mockF(page, {
      docs: {
        [DID]: aysel({}, { outOfDate }),
        [DID2]: {
          ...aysel(
            { documentId: DID2, matchId: '01K0000000000000000000000N' },
            { outOfDate, reanalyzing: true },
          ),
          filename: 'rauf.txt',
          kind: 'txt',
          original: { available: true, view: 'none' },
        },
      },
    });
    await openReview(page);
    await ready(page);
    await toAnalysis(page, t);
    const notice = page
      .getByTestId('analysis-pane')
      .getByRole('status')
      .filter({ hasText: t('Out of date: this match was scored against earlier requirements.') });
    await expect(notice).toBeVisible();
    const items = notice.locator('li');
    await expect.soft(items, 'exactly 4 changes').toHaveCount(4);
    const first = await items.first().textContent();
    expect
      .soft(first, "'<date> · Aysel Mammadova: <description>'")
      .toMatch(/^.+ · Aysel Mammadova: Changed requirement 1$/);
    await expect
      .soft(notice.getByRole('link', { name: t('Open the vacancy to re-analyze') }))
      .toHaveAttribute('href', `#/vacancies/${VID}`);
    await ux.check('out of date', [...STD, 'AZ']);
    await page.goto(`/#/cv/${DID2}?l=e2e-list`);
    await toAnalysis(page, t);
    await expect
      .soft(page.getByText(t('Re-analyzing against the new requirements…')))
      .toBeVisible();
    await ux.check('re-analyzing', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ CV-12 being analyzed

uat(
  'CV-12',
  'Being analyzed: the result fills in by itself',
  { on: ['D', 'A'] },
  async ({ page, ux, meta, info }) => {
    info.setTimeout(60_000);
    const t = T(meta.lang);
    const analyzing = stateDoc(DID5, 'analyzing', { matchId: null, screeningId: DID5 });
    const done = { ...aysel({ documentId: DID5 }), documentId: DID5 };
    const seen = await mockF(page, {
      docs: { [DID5]: (n: number) => (n >= 3 ? done : analyzing) },
    });
    await page.goto(`/#/cv/${DID5}`);
    await page.locator('h1').waitFor();
    const t0 = Date.now();
    await expect.soft(page.getByText(t('Being analyzed'), { exact: true })).toBeVisible();
    await toAnalysis(page, t);
    await expect.soft(page.getByText(t('This CV is being analyzed.'))).toBeVisible();
    await expect
      .soft(page.getByText(t('The result appears here by itself. You can read the CV meanwhile.')))
      .toBeVisible();
    await expect
      .soft(decisionSel(page, t), 'no decision control before there is a result')
      .toHaveCount(0);
    await ux.check('being analyzed', [...STD, 'AZ']);
    await expect(page.getByRole('img', { name: t('Match {n}%', { n: 88 }) })).toBeVisible({
      timeout: 13_000,
    });
    const gets = () =>
      seen.requests.filter((r) => r.method === 'GET' && r.url === `/documents/${DID5}`);
    const times = gets().length;
    expect.soft(Date.now() - t0, 'the result arrived by polling (about 8 s)').toBeLessThan(13_000);
    await expect.soft(decisionSel(page, t)).toBeVisible();
    await toAnalysis(page, t);
    await expect.soft(page.getByTestId('analysis-pane').locator('li').first()).toBeVisible();
    await page.waitForTimeout(5_000);
    expect.soft(gets().length, 'polling stops when the result is there').toBe(times);
    // Hidden tab: every 15 s.
    const page2 = await page.context().newPage();
    const seen2 = await mockF(page2, { docs: { [DID5]: analyzing } });
    await page2.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
    });
    await page2.goto(`/#/cv/${DID5}`);
    await page2.locator('h1').waitFor();
    await page2.waitForTimeout(16_500);
    const hidden = seen2.requests.filter(
      (r) => r.method === 'GET' && r.url === `/documents/${DID5}`,
    ).length;
    expect.soft(hidden, 'hidden: one load and one refresh in 16.5 s (every 15 s)').toBe(2);
    await page2.close();
  },
);

// ------------------------------------------------------------------ CV-13 failed and retry

uat(
  'CV-13',
  'Analysis failed and Retry the analysis',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const failed = (patch: Record<string, any> = {}) =>
      stateDoc(DID6, 'failed', {
        screeningId: S6,
        statusDetail: { error: 'The AI provider timed out.', retryable: true },
        ...patch,
      });
    let mode: 'ok' | 'fail' = 'ok';
    let retried = false;
    const seen = await mockF(page, {
      docs: {
        [DID6]: () =>
          retried ? stateDoc(DID6, 'analyzing', { screeningId: S6, matchId: null }) : failed(),
      },
      extra: async (route, url) => {
        if (url.pathname === `/screenings/${S6}/retry`) {
          await new Promise((r) => setTimeout(r, 400));
          if (mode === 'fail')
            await route.fulfill({ status: 500, json: { message: 'The retry could not start.' } });
          else {
            retried = true;
            await route.fulfill({ json: { ok: true } });
          }
          return true;
        }
        return false;
      },
    });
    await page.goto(`/#/cv/${DID6}`);
    await page.locator('h1').waitFor();
    await toAnalysis(page, t);
    const pane = page.getByTestId('analysis-pane');
    await expect.soft(pane.getByText(t('The analysis of this CV did not finish.'))).toBeVisible();
    await expect.soft(pane.getByText('The AI provider timed out.')).toBeVisible();
    const btn = pane.getByRole('button', { name: t('Retry the analysis') });
    await ux.check('failed', [...STD, 'AZ']);
    await btn.click();
    await expect.soft(pane.getByRole('button', { name: t('Retrying…') })).toBeDisabled();
    await expect.soft(page.getByText(t('This CV is being analyzed.'))).toBeVisible();
    expect
      .soft(
        seen.requests.filter((r) => r.method === 'POST' && r.url === `/screenings/${S6}/retry`)
          .length,
        'one POST',
      )
      .toBe(1);
    // Variants.
    for (const [label, doc] of [
      [
        'retryable false',
        failed({ statusDetail: { error: 'The AI provider timed out.', retryable: false } }),
      ],
      [
        'archived vacancy',
        failed({
          vacancy: { id: VID, title: 'Network Engineer', status: 'closed', archived: true },
        }),
      ],
    ] as const) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      const p = await mockF(page, { docs: { [DID6]: doc } });
      void p;
      await page.goto(`/#/cv/${DID6}`);
      await page.reload();
      await page.locator('h1').waitFor();
      await toAnalysis(page, t);
      await expect.soft(page.getByText(t('The analysis of this CV did not finish.'))).toBeVisible();
      await expect
        .soft(page.getByRole('button', { name: t('Retry the analysis') }), `${label}: no button`)
        .toHaveCount(0);
    }
    // The 500.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    retried = false;
    mode = 'fail';
    ux.allow(/500/, /retry could not start/i);
    await mockF(page, {
      docs: { [DID6]: failed() },
      extra: async (route, url) => {
        if (url.pathname === `/screenings/${S6}/retry`) {
          await route.fulfill({ status: 500, json: { message: 'The retry could not start.' } });
          return true;
        }
        return false;
      },
    });
    await page.goto(`/#/cv/${DID6}`);
    await page.reload();
    await page.locator('h1').waitFor();
    await toAnalysis(page, t);
    await page.getByRole('button', { name: t('Retry the analysis') }).click();
    await expect.soft(page.getByText(t('The retry could not start.'))).toBeVisible();
    await expect
      .soft(page.getByRole('button', { name: t('Retry the analysis') }), 'the button comes back')
      .toBeEnabled();
  },
);

// ------------------------------------------------------------------ CV-14 unreadable and needs a look

uat(
  'CV-14',
  'No readable text and Needs a human look: the person still decides',
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const unreadable = stateDoc(DID7, 'unreadable', {
      text: { available: false },
      original: { available: true, view: 'pdf' },
      statusDetail: { reason: 'The file has no text layer.' },
      matchId: '01K00000000000000000000M07',
    });
    const needsLook = {
      ...aysel({
        documentId: DID8,
        status: 'needs_look',
        statusDetail: { reason: 'Two different names in the CV.' },
      }),
    };
    const seen = await mockF(page, {
      live: true,
      docs: { [DID7]: unreadable, [DID8]: needsLook },
      view: { [DID7]: PDF },
    });
    await page.goto(`/#/cv/${DID7}`);
    await page.locator('h1').waitFor();
    await toAnalysis(page, t);
    const pane = page.getByTestId('analysis-pane');
    await expect.soft(pane.getByText(t('No readable text'), { exact: true })).toBeVisible();
    await expect.soft(pane.getByText('The file has no text layer.')).toBeVisible();
    const decide = pane.getByRole('status').filter({ hasText: t('No readable text') });
    await expect
      .soft(decide, 'a line tells the person to read the CV and decide')
      .toContainText(/decide|qərar/i);
    if (meta.dev !== 'D') {
      const said = (await decide.textContent()) ?? '';
      expect
        .soft(
          said,
          `on ${meta.dev} the CV is in a tab, so the wording does not say 'on the left' (SD-80)`,
        )
        .not.toContain(t('Read the CV on the left and decide yourself.'));
    }
    await expect
      .soft(page.getByRole('tablist', { name: t('CV view') }), "no 'Text' tab")
      .toHaveCount(0);
    const sel = decisionSel(page, t, 'Aysel Məmmədova');
    await expect.soft(sel).toBeEnabled();
    await ux.check('unreadable', [...STD, 'AZ']);
    await sel.selectOption('shortlist');
    await expect.poll(() => puts(seen).length, 'the PUT is sent').toBe(1);
    await page.goto(`/#/cv/${DID8}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await toAnalysis(page, t);
    await expect
      .soft(page.getByTestId('analysis-pane').getByText('Two different names in the CV.'))
      .toBeVisible();
    await expect
      .soft(page.getByTestId('analysis-pane').locator('li'), 'the cards are listed')
      .toHaveCount(4);
    const all = (await page.getByTestId('analysis-pane').textContent()) ?? '';
    if (meta.dev !== 'D')
      expect
        .soft(all, "no 'on the left' wording on a tabbed screen")
        .not.toContain(t('Read the CV on the left and decide yourself.'));
    await ux.check('needs a human look', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ CV-15 stopped, not analyzed, erased

uat(
  'CV-15',
  'Stopped, not analyzed and erased CVs',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const seen = await mockF(page, {
      docs: {
        [DID9]: stateDoc(DID9, 'stopped'),
        [DID10]: stateDoc(DID10, 'not_analyzed'),
        [DID11]: stateDoc(DID11, 'erased', {
          original: { available: false, view: 'none' },
          text: { available: false },
          matchId: null,
        }),
      },
    });
    await page.goto(`/#/cv/${DID9}`);
    await page.locator('h1').waitFor();
    await toAnalysis(page, t);
    await expect.soft(page.getByText(t('The analysis was stopped before this CV.'))).toBeVisible();
    await expect
      .soft(page.getByRole('link', { name: t('Open the vacancy to continue') }))
      .toHaveAttribute('href', `#/vacancies/${VID}`);
    await ux.check('stopped', [...STD, 'AZ']);
    await page.goto(`/#/cv/${DID10}`);
    await expect(page.getByText(t('Not analyzed for the current criteria')).first()).toBeAttached();
    await toAnalysis(page, t);
    await expect
      .soft(page.getByTestId('analysis-pane').getByText(t('Not analyzed for the current criteria')))
      .toBeVisible();
    await expect
      .soft(page.getByRole('link', { name: t('Open the vacancy to re-analyze') }))
      .toHaveAttribute('href', `#/vacancies/${VID}`);
    await ux.check('not analyzed', [...STD, 'AZ']);
    await page.goto(`/#/cv/${DID11}`);
    await page.locator('h1').waitFor();
    const erased = t('This CV was erased. Its file and its text are gone.');
    await expect
      .soft(page.getByTestId('cv-pane').getByText(erased), 'the CV pane says erased')
      .toBeAttached();
    await expect
      .soft(page.getByTestId('analysis-pane').getByText(erased), 'the analysis pane says erased')
      .toBeAttached();
    for (const n of ['Open in new tab', 'Download', 'Full screen', 'Zoom in', 'Zoom out'])
      await expect
        .soft(page.getByRole('button', { name: exact(t(n)) }), `no '${n}'`)
        .toHaveCount(0);
    await expect.soft(page.getByTestId('evidence-map')).toHaveCount(0);
    expect
      .soft(
        seen.requests.filter((r) => new RegExp(`/documents/${DID11}/(view|text|file)`).test(r.url)),
        'no file request',
      )
      .toEqual([]);
    await ux.check('erased', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ CV-16 loading, not found, error

uat(
  'CV-16',
  'Loading skeleton, CV not found and load error',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    ux.allow(/500/, /404/, /Server error|went wrong/i);
    const seen = await mockF(page, {
      docs: {
        [DIDX]: async () => {
          await new Promise((r) => setTimeout(r, 2_000));
          return aysel({ documentId: DIDX });
        },
        [DIDY]: { status: 404, json: { message: 'Not found' } },
        [DIDZ]: (n: number) =>
          n === 1
            ? { status: 500, json: { message: 'The service had a problem. Try again.' } }
            : aysel({ documentId: DIDZ }),
      },
    });
    await page.goto(`/#/cv/${DIDX}`);
    const sk = page.locator('[role=status][aria-busy=true]');
    await expect.soft(sk, 'a skeleton with role=status, aria-busy').toBeVisible();
    await expect.soft(sk.locator('.sr-only')).toHaveText(t('Loading…'));
    await ux.check('skeleton', ['OCC', 'OVL', 'OVF', 'AZ']);
    await expect(page.locator('h1')).toBeVisible({ timeout: 6_000 });
    // 404 inside a list.
    await openReview(page, DIDY);
    await page.reload();
    await expect
      .soft(page.getByText(t('This CV is not available to you, or it no longer exists.')))
      .toBeVisible();
    await expect
      .soft(page.getByRole('link', { name: t('← Back') }))
      .toHaveAttribute('href', '#/candidates');
    await ux.check('not found', [...STD, 'AZ']);
    // 500 once.
    await page.goto(`/#/cv/${DIDZ}`);
    await expect.soft(page.getByText(t('The service had a problem. Try again.'))).toBeVisible();
    await expect.soft(page.getByRole('link', { name: t('← Back') })).toBeVisible();
    const before = seen.requests.filter((r) => r.url === `/documents/${DIDZ}`).length;
    await page.getByRole('button', { name: t('Try again') }).click();
    await expect(page.locator('h1')).toBeVisible();
    expect
      .soft(
        seen.requests.filter((r) => r.url === `/documents/${DIDZ}`).length - before,
        'Try again sends one GET',
      )
      .toBe(1);
  },
);

// ------------------------------------------------------------------ CV-17 archived vacancy

uat(
  'CV-17',
  'Archived vacancy on the review screen',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const archived = { id: VID, title: 'Network Engineer', status: 'closed', archived: true };
    const d = aysel({ vacancy: archived }, { vacancy: archived });
    const seen = await mockF(page, { docs: { [DID]: d } });
    await openReview(page);
    await ready(page);
    await expect.soft(decisionSel(page, t)).toBeDisabled();
    await expect.soft(page.getByPlaceholder(t('Add a note (optional)'))).toHaveCount(0);
    await expect.soft(page.getByRole('button', { name: t('Save note') })).toHaveCount(0);
    await expect.soft(page.getByRole('switch')).toHaveCount(0);
    await expect.soft(page.locator('header kbd')).toHaveCount(0);
    for (const k of ['s', 'm', 'n']) await page.keyboard.press(k);
    await page.waitForTimeout(400);
    expect.soft(puts(seen), 'S, M and N send no PUT').toEqual([]);
    // A visible line says the vacancy is archived so decisions are off (SD-100).
    await expect
      .soft(
        page.locator('header').getByText(/archived|arxiv/i),
        'a visible line says the vacancy is archived',
      )
      .toBeVisible();
    await ux.check('archived', [...STD, 'AZ']);
    await page.keyboard.press('j');
    await expect.soft(page).toHaveURL(new RegExp(`#/cv/${DID2}\\?l=e2e-list$`));
  },
);

// ------------------------------------------------------------------ CV-18 no list

uat(
  'CV-18',
  'A CV opened without a list (copied link)',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const seen = await mockF(page, { live: true });
    await page.goto(`/#/cv/${DID}`);
    await ready(page);
    await expect
      .soft(page.getByRole('navigation', { name: t('Previous and next') }))
      .toHaveCount(0);
    await expect.soft(page.getByText(/CV \d of \d/)).toHaveCount(0);
    await expect.soft(page.getByRole('switch')).toHaveCount(0);
    await expect.soft(liveText(page)).toHaveText(NAME);
    const url = page.url();
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await page.waitForTimeout(400);
    expect.soft(page.url(), 'J and K do nothing').toBe(url);
    await ux.check('no list', [...STD]);
    await page.keyboard.press('s');
    await expect.poll(() => puts(seen).length).toBe(1);
    await expect
      .soft(
        page.getByRole('status').filter({ hasText: t('Marked {mark}.', { mark: t('Shortlist') }) }),
      )
      .toBeVisible();
    expect.soft(page.url(), 'S stays on the CV').toBe(url);
    // (The toast at the bottom centre covers an evidence-map dot for its 10 s; recorded as an S4
    // observation in the triage, not a failure of this case.)
    const back = page.getByRole('link', { name: '← Back to Network Engineer' });
    await expect(back).toBeVisible();
    await back.click();
    await expect.soft(page).toHaveURL(new RegExp(`#/vacancies/${VID}/candidates$`));
  },
);

// ------------------------------------------------------------------ CV-19 legacy links

uat(
  'CV-19',
  'Legacy links #/candidates/:id and #/screenings/:id',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await mockF(page, {
      extra: async (route, url) => {
        if (url.pathname === `/screenings/${MID}`) {
          await new Promise((r) => setTimeout(r, 300));
          await route.fulfill({ json: { documentId: DID } });
          return true;
        }
        if (url.pathname === `/screenings/${MIDX}`) {
          await route.fulfill({ status: 404, json: { message: 'Not found' } });
          return true;
        }
        return false;
      },
    });
    ux.allow(/404/);
    await page.goto('/#/vacancies');
    await page.waitForLoadState('networkidle');
    const h0 = await page.evaluate(() => history.length);
    await page.evaluate((m) => (location.hash = `#/candidates/${m}`), MID);
    await expect.soft(page.getByText(t('Loading…')).first()).toBeAttached();
    await expect(page).toHaveURL(new RegExp(`#/cv/${DID}$`));
    const h1 = await page.evaluate(() => history.length);
    expect
      .soft(h1 - h0, 'location.replace: one entry for the legacy link, none for the redirect')
      .toBe(1);
    await page.goBack();
    await expect.soft(page, 'Back does not return to the legacy URL').toHaveURL(/#\/vacancies$/);
    await page.goto(`/#/screenings/${MID}`);
    await expect.soft(page).toHaveURL(new RegExp(`#/cv/${DID}$`));
    await page.goto(`/#/screenings/${MIDX}`);
    await expect
      .soft(page.getByText(t('This CV is not available to you, or it no longer exists.')))
      .toBeVisible();
    await expect.soft(page).toHaveURL(new RegExp(`#/screenings/${MIDX}$`));
    await ux.check('unknown screening', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ CV-21 accessibility on 4 backgrounds

uat(
  'CV-21',
  'Accessibility of the review on all four backgrounds',
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta, info }) => {
    info.setTimeout(90_000);
    const t = T(meta.lang);
    for (const bg of ['white', 'grey', 'cream', 'dark']) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await mockF(page, { me: { background: bg }, live: true });
      await openReview(page);
      await page.reload();
      await ready(page);
      await showReq(page, t, '5G transport experience');
      await decisionSel(page, t).selectOption('maybe');
      await expect(page.getByRole('button', { name: t('Undo') })).toBeVisible();
      await settle(page);
      await ux.check(`background ${bg}`, [...STD, 'AZ']);
      await decisionSel(page, t).selectOption('new');
    }
    if (meta.dev !== 'D') return;
    // The Tab order from the Back link (desktop, two panes).
    await page.reload();
    await ready(page);
    await page.getByRole('link', { name: t('← Back to {list}', { list: 'Candidates' }) }).focus();
    const order: string[] = [];
    for (let i = 0; i < 40; i++) {
      order.push(
        await page.evaluate(() => {
          const a = document.activeElement as HTMLElement;
          const role = a.getAttribute('role') ?? a.tagName.toLowerCase();
          return `${role}:${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 28)}`;
        }),
      );
      await page.keyboard.press('Tab');
    }
    await info.attach('tab order', {
      body: JSON.stringify(order, null, 1),
      contentType: 'application/json',
    });
    const at = (re: RegExp) => order.findIndex((o) => re.test(o));
    const seq = [
      ['Back link', /^a:←/],
      ['Next', new RegExp(`^a:${t('Next CV ›')}`)],
      ['vacancy link', /^a:Network Engineer/],
      ['Decision', /^select:/],
      ['switch', /^switch:/],
      ['note', /^textarea:/],
      ['Zoom out', new RegExp(`^button:${t('Zoom out')}`)],
      ['Zoom in', new RegExp(`^button:${t('Zoom in')}`)],
      ['Download', new RegExp(`^button:${t('Download')}`)],
      ['Full screen', new RegExp(`^button:${t('Full screen')}`)],
      ['CV view tab', /^tab:/],
      [
        'map dot',
        new RegExp(
          `page \\d|${t('{requirement}, page {n}', { requirement: 'x', n: 1 }).slice(1, 4)}`,
        ),
      ],
      ['separator', /^separator:/],
      ['analysis button', new RegExp(`^button:${t('Show in CV')}`)],
    ] as const;
    let last = -1;
    for (const [name, re] of seq) {
      const i = at(re);
      expect.soft(i, `'${name}' is in the Tab order`).toBeGreaterThan(-1);
      if (i > -1)
        expect.soft(i, `'${name}' comes after the previous control`).toBeGreaterThan(last);
      if (i > -1) last = i;
    }
  },
);

// ------------------------------------------------------------------ CV-22 motion

uat(
  'CV-22',
  'Motion and reduced motion on the review',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const running = () =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running')
          // PLAN: "getAnimations() is empty" — colour fades (a card's or button's colours) are not
          // motion (WCAG 2.3.3 is about movement), so CSS colour transitions are left out here; any
          // movement (top, scale, transform, translate) still counts.
          .filter((a) => !/color$/.test((a as any).transitionProperty ?? ''))
          .map((a) => {
            const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
            const what =
              (a as any).animationName ?? (a as any).transitionProperty ?? a.constructor.name;
            return `${what} on ${el?.tagName.toLowerCase()}.${String(el?.className ?? '').slice(0, 60)}`;
          }),
      );
    // Reduced motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockF(page, { live: true });
    await openReview(page);
    await page.locator('h1').waitFor();
    const dial = page.getByRole('img', { name: 'Match 88%' });
    expect.soft(await dial.textContent(), 'reduced: the dial shows 88% at once').toContain('88');
    await ready(page);
    expect.soft(await running(), 'reduced: no animation after load').toEqual([]);
    await showReq(page, t, '5G transport experience');
    await expect(page.locator('[data-page="2"] [data-testid=pdf-mark]').first()).toBeVisible();
    expect.soft(await running(), "reduced: no animation after 'Show in CV'").toEqual([]);
    await decisionSel(page, t).selectOption('maybe');
    await expect(page.getByRole('button', { name: t('Undo') })).toBeVisible();
    expect.soft(await running(), 'reduced: no wash or toast animation').toEqual([]);
    await prevNext(page, t)
      .getByRole('link', { name: t('Next CV ›') })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Rauf Əliyev' })).toBeVisible();
    expect.soft(await running(), 'reduced: no view-transition animation').toEqual([]);
    await ux.check('reduced motion', [...STD, 'RM']);
    // Motion allowed.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`/#/cv/${DID}?l=e2e-list`);
    await page.reload();
    await page.locator('h1').waitFor();
    const early = await page.getByRole('img', { name: 'Match 88%' }).textContent();
    expect.soft(early, 'with motion the dial counts up').not.toContain('88');
    await expect
      .soft(page.getByRole('img', { name: 'Match 88%' }))
      .toContainText('88', { timeout: 3_000 });
    await page.waitForTimeout(1_500);
    await ready(page);
    await settle(page, 1_500).catch(() =>
      expect.soft('animations still running 1.5 s after load').toBe(''),
    );
    await showReq(page, t, '5G transport experience');
    await page.waitForTimeout(1_500);
    await settle(page, 500).catch(() =>
      expect.soft("animations still running 1.5 s after 'Show in CV'").toBe(''),
    );
    await decisionSel(page, t).selectOption('shortlist');
    await page.waitForTimeout(1_500);
    await settle(page, 500).catch(() =>
      expect.soft('animations still running 1.5 s after deciding').toBe(''),
    );
    await prevNext(page, t)
      .getByRole('link', { name: t('Next CV ›') })
      .click();
    await page.waitForTimeout(1_500);
    await settle(page, 500).catch(() =>
      expect.soft("animations still running 1.5 s after 'Next CV'").toBe(''),
    );
    await ux.check('motion allowed', STD);
  },
);

void DID2;
void DID4;

// ================================================================== 7.18 CV pane (FS-20 … FS-26)

const viewTabs = (page: Page, t: Tr) => page.getByRole('tablist', { name: t('CV view') });

uat(
  'FS-20',
  'Original and Text switch; the PDF is fetched once',
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const seen = await mockF(page, { text: { [DID]: AYSEL_TEXT } });
    await openReview(page);
    await ready(page);
    const tabs = viewTabs(page, t);
    await expect(tabs).toBeVisible();
    await expect
      .soft(tabs.getByRole('tab', { name: t('Original') }))
      .toHaveAttribute('aria-selected', 'true');
    await expect.soft(tabs.getByRole('tab', { name: t('Text') })).toBeVisible();
    const body = page.getByTestId('cv-body');
    await body.evaluate((e) => e.scrollTo({ top: 300, behavior: 'instant' }));
    const y0 = await body.evaluate((e) => e.scrollTop);
    await tabs.getByRole('tab', { name: t('Text') }).click();
    const box = page.getByLabel(t('CV text'));
    await expect.soft(box).toBeVisible();
    await expect
      .soft(box.getByText(t('Page {n}', { n: 2 }), { exact: true }), "the separator 'Page 2'")
      .toBeVisible();
    await expect
      .soft(
        page.getByText(
          t('The lines found are marked here. The original pages are under Original.'),
        ),
      )
      .toBeVisible();
    await ux.check('Text view', [...STD, 'AZ']);
    await tabs.getByRole('tab', { name: t('Original') }).click();
    await expect.soft(page.locator('[data-page="2"]')).toBeAttached();
    await page.waitForTimeout(500);
    expect
      .soft(
        await body.evaluate((e) => e.scrollTop),
        'Original comes back at the same scroll position',
      )
      .toBeCloseTo(y0, -1);
    await tabs.getByRole('tab', { name: t('Text') }).click();
    await tabs.getByRole('tab', { name: t('Original') }).click();
    await page.waitForTimeout(800);
    const n = (re: RegExp) =>
      seen.requests.filter((r) => r.method === 'GET' && re.test(r.url)).length;
    expect
      .soft(
        n(new RegExp(`^/documents/${DID}/view$`)),
        'exactly one GET /documents/DID/view (SD-99)',
      )
      .toBe(1);
    expect
      .soft(n(new RegExp(`^/documents/${DID}/text$`)), 'exactly one GET /documents/DID/text')
      .toBe(1);
    if (meta.lang === 'az') expect.soft([t('Original'), t('Text')]).toEqual(['Orijinal', 'Mətn']);
  },
);

uat(
  'FS-21',
  "'Zoom out' and 'Zoom in' on the pages",
  { on: ['D', 'T'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    const group = page.getByRole('group', { name: t('Zoom') });
    await expect(group).toBeVisible();
    const zin = group.getByRole('button', { name: t('Zoom in'), exact: true });
    const zout = group.getByRole('button', { name: t('Zoom out'), exact: true });
    const width = () =>
      page.locator('[data-page="1"]').evaluate((e) => e.getBoundingClientRect().width);
    // Widths are read once the zoom has finished animating (a fixed pause read them mid-way on a
    // slow runner: 1.19 instead of 1.25).
    await settled(page);
    const w0 = await width();
    const steps: number[] = [];
    for (let i = 0; i < 4; i++) {
      await zin.click();
      await page.waitForTimeout(50);
      await settled(page);
      steps.push((await width()) / w0);
    }
    expect
      .soft(
        steps.map((x) => Math.round(x * 100) / 100),
        'each Zoom in adds 25 % of the fitted width',
      )
      .toEqual([1.25, 1.5, 1.75, 2]);
    await expect.soft(zin, "'Zoom in' is disabled at 200 %").toBeDisabled();
    const down: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (await zout.isDisabled()) break;
      await zout.click();
      await page.waitForTimeout(50);
      await settled(page);
      down.push((await width()) / w0);
    }
    expect
      .soft(
        down.map((x) => Math.round(x * 100) / 100),
        'each Zoom out takes 25 % off',
      )
      .toEqual([1.75, 1.5, 1.25, 1, 0.75]);
    await expect.soft(zout, "'Zoom out' is disabled at 75 %").toBeDisabled();
    await showReq(page, t, 'BGP routing');
    await expect(page.locator('[data-page="1"] [data-testid=pdf-mark]').first()).toBeVisible();
    for (let i = 0; i < 2; i++) {
      await zin.click();
      await page.waitForTimeout(400);
      const inside = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid=pdf-mark]')].every((m) => {
          const p = m.closest('[data-page]')!.getBoundingClientRect();
          const r = m.getBoundingClientRect();
          return (
            r.left >= p.left - 1 &&
            r.right <= p.right + 1 &&
            r.top >= p.top - 1 &&
            r.bottom <= p.bottom + 1
          );
        }),
      );
      expect.soft(inside, 'marks stay inside their page boxes after the re-render').toBe(true);
    }
    expect
      .soft(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        'the window never scrolls sideways',
      )
      .toBeLessThanOrEqual(1);
    if (meta.lang === 'az') expect.soft([t('Zoom in'), t('Zoom out')]).toEqual(['Böyüt', 'Kiçilt']);
    await ux.check('zoomed with a mark', [...STD, 'AZ']);
    await viewTabs(page, t)
      .getByRole('tab', { name: t('Text') })
      .click();
    await expect
      .soft(page.getByRole('group', { name: t('Zoom') }), "the Zoom group shows only on 'Original'")
      .toHaveCount(0);
  },
);

uat('FS-22', 'Download the original file', { on: ['D', 'A'] }, async ({ page, ux, meta }) => {
  const t = T(meta.lang);
  await mockF(page, { file: { [DID]: { body: PDF, type: 'application/pdf', delay: 1_200 } } });
  await openReview(page);
  await ready(page);
  const dl = page.waitForEvent('download');
  const btn = page.getByRole('button', { name: t('Download'), exact: true });
  await btn.click();
  await expect.soft(btn, "'Download' is disabled while it runs").toBeDisabled();
  await expect
    .soft(
      page.getByRole('button', { name: t('Open in new tab') }),
      "'Open' is disabled while it runs",
    )
    .toBeDisabled();
  const d = await dl;
  expect.soft(d.suggestedFilename()).toBe('aysel.pdf');
  const path = await d.path();
  const { readFileSync } = await import('node:fs');
  expect.soft(readFileSync(path).subarray(0, 4).toString(), 'the PDF bytes').toBe('%PDF');
  await expect.soft(btn).toBeEnabled();
  if (meta.lang === 'az') expect.soft(t('Download')).toBe('Yükləyin');
  await ux.check('downloaded', [...STD, 'AZ']);
  // 404.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  ux.allow(/404/, /no longer available/);
  await mockF(page, {
    file: {
      [DID]: { status: 404, json: { message: 'The original file is no longer available.' } },
    },
  });
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: t('Download'), exact: true }).click();
  const err = page.getByRole('region', { name: t('CV') }).getByRole('alert');
  await expect
    .soft(err, 'the 404 shows an error notice in the pane')
    .toHaveText(t('The original file is no longer available.'));
  if (meta.lang === 'az')
    await expect
      .soft(err, 'the error is Azerbaijani')
      .not.toHaveText('The original file is no longer available.');
});

uat(
  'FS-23',
  'Open in a new browser tab, also with pop-ups blocked',
  { on: ['D', 'E'], langs: 'EN' },
  async ({ page, ux, meta, context }) => {
    const t = T(meta.lang);
    await mockF(page);
    await openReview(page);
    await ready(page);
    const open = page.getByRole('button', { name: t('Open in new tab'), exact: true });
    await expect.soft(open, "the button names what it does ('Open in new tab')").toBeVisible();
    await expect
      .soft(page.getByRole('button', { name: t('Full screen'), exact: true }))
      .toBeVisible();
    const popupP = context.waitForEvent('page');
    await open.click();
    const popup = await popupP;
    await popup.waitForURL(/^blob:/, { timeout: 8_000 }).catch(() => undefined);
    expect.soft(popup.url(), 'the popup is on a blob: URL').toMatch(/^blob:/);
    expect
      .soft(
        await popup.evaluate(() => window.opener === null).catch(() => null),
        'window.opener is null',
      )
      .toBe(true);
    await popup.close();
    await ux.check('after Open in new tab', STD);
    // Pop-ups blocked.
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: t('Open in new tab'), exact: true }).click();
    await page.waitForTimeout(500);
    expect
      .soft(page.url(), 'the app tab stays on the CV')
      .toMatch(new RegExp(`#/cv/${DID}\\?l=e2e-list$`));
    await expect
      .soft(page.getByText(t('The browser blocked the new tab. Use Download instead.')))
      .toBeVisible();
    await expect
      .soft(page.getByRole('button', { name: t('Download'), exact: true }), "'Download' is offered")
      .toBeVisible();
  },
);

uat(
  'FS-24',
  'Word CV: pages being prepared, rendition note, pages not available',
  { on: ['D', 'A'] },
  async ({ page, ux, meta, info }) => {
    info.setTimeout(60_000);
    const t = T(meta.lang);
    let phase = 0;
    await mockF(page, {
      docs: {
        [DID4]: (n: number) => leyla(phase === 0 && n <= 3 ? 'pending' : 'pdf'),
        [DID15]: { ...leyla('none', DID15) },
      },
    });
    await page.goto(`/#/cv/${DID4}`);
    await page.locator('h1').waitFor();
    const pending = t(
      'The pages of this Word file are being prepared. They appear here by themselves; the text below was read from the file.',
    );
    await expect.soft(page.getByText(pending)).toBeVisible();
    await expect.soft(viewTabs(page, t), "no 'CV view' tabs while pending").toHaveCount(0);
    await expect.soft(page.getByLabel(t('CV text')), 'only the text view shows').toBeVisible();
    await ux.check('Word pages pending', [...STD, 'AZ']);
    await expect(viewTabs(page, t)).toBeVisible({ timeout: 15_000 });
    await expect
      .soft(
        viewTabs(page, t).getByRole('tab', { name: t('Original') }),
        'the pane switches to Original by itself',
      )
      .toHaveAttribute('aria-selected', 'true');
    await expect
      .soft(
        page.getByText(
          t('These pages were made from the Word file, so the layout can differ a little.'),
        ),
      )
      .toBeVisible();
    await viewTabs(page, t)
      .getByRole('tab', { name: t('Text') })
      .click();
    await page.waitForTimeout(5_000);
    await expect
      .soft(viewTabs(page, t).getByRole('tab', { name: t('Text') }), 'after Text it stays on Text')
      .toHaveAttribute('aria-selected', 'true');
    phase = 1;
    await page.goto(`/#/cv/${DID15}`);
    await page.locator('h1').waitFor();
    await expect
      .soft(
        page.getByText(
          t(
            'The pages of this Word file are not available. The text below was read from the file; the original can be downloaded.',
          ),
        ),
      )
      .toBeVisible();
    await expect.soft(viewTabs(page, t)).toHaveCount(0);
    await expect
      .soft(page.getByRole('button', { name: exact(t('Open in new tab')) }))
      .toHaveCount(0);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: t('Download'), exact: true }).click();
    expect.soft((await dl).suggestedFilename(), 'Word stays Word').toBe('leyla.docx');
    await ux.check('Word without pages', [...STD, 'AZ']);
  },
);

uat(
  'FS-25',
  'Plain text, loading, missing original and no-text states',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    ux.allow(/404/, /409/, /500/, /no longer available|cannot be shown|could not be read/);
    const { DID16, DID17, DID18 } = await import('../fixtures/pkg-f');
    const docx18 = {
      ...leyla('none', DID18),
      text: { available: false },
      statusDetail: { reason: 'Scanned image without text.' },
    };
    let textMode: 'slow' | 'fail' | 'cut' = 'slow';
    await mockF(page, {
      viewDelay: 3_000,
      docs: {
        [DID16]: { ...aysel({ documentId: DID16, filename: 'gone.pdf' }) },
        [DID17]: { ...aysel({ documentId: DID17, filename: 'odd.pdf' }) },
        [DID18]: docx18,
      },
      extra: async (route, url) => {
        if (url.pathname !== `/documents/${DID2}/text`) return false;
        if (textMode === 'slow') {
          await new Promise((r) => setTimeout(r, 2_000));
          await route.fulfill({ json: (await import('../fixtures/api')).TEXT });
        } else if (textMode === 'fail')
          await route.fulfill({ status: 500, json: { message: 'The text could not be read.' } });
        else
          await route.fulfill({
            json: { ...(await import('../fixtures/api')).TEXT, truncated: true },
          });
        return true;
      },
    });
    const cvPane = page.getByRole('region', { name: t('CV') });
    await openReview(page);
    await expect
      .soft(
        cvPane.getByRole('status').filter({ hasText: t('Loading the pages…') }),
        "'Loading the pages…' (role=status)",
      )
      .toBeVisible();
    await ready(page);
    await expect
      .soft(page.locator('[data-page="1"]'), 'no sheen once drawn')
      .not.toHaveClass(/m-loading/);
    // Plain text, with the /text delay.
    await page.goto(`/#/cv/${DID2}?l=e2e-list`);
    await expect
      .soft(cvPane.getByText(t('Loading…'), { exact: true }), "the /text delay shows 'Loading…'")
      .toBeVisible();
    await expect
      .soft(cvPane.getByText(t('This is a plain text file, so it has no pages.')))
      .toBeVisible();
    await expect.soft(viewTabs(page, t), "no 'Original' tab").toHaveCount(0);
    await expect
      .soft(page.getByLabel(t('CV text')).locator('article'))
      .toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await ux.check('plain text', [...STD, 'AZ']);
    for (const [id, en] of [
      [DID16, 'The original file is no longer available.'],
      [DID17, 'The original cannot be shown as pages.'],
    ] as const) {
      await page.goto(`/#/cv/${id}`);
      await expect.soft(cvPane.getByText(t(en)), `${id}: '${en}'`).toBeVisible({ timeout: 10_000 });
      if (meta.lang === 'az')
        await expect
          .soft(cvPane.getByText(en, { exact: true }), 'no English on the AZ screen')
          .toHaveCount(0);
    }
    await page.goto(`/#/cv/${DID18}`);
    await expect.soft(cvPane.getByText(t('Scanned image without text.'))).toBeVisible();
    await ux.check('no text', [...STD, 'AZ']);
    textMode = 'fail';
    await page.goto(`/#/cv/${DID2}`);
    await page.reload();
    await expect.soft(cvPane.getByRole('alert'), 'the /text 500 shows its error').toBeVisible();
    textMode = 'cut';
    await page.reload();
    await expect
      .soft(page.getByLabel(t('CV text')))
      .toContainText(t('Only the first part of this CV is shown.'));
  },
);

uat(
  'FS-26',
  'Accessibility of the CV pane and the viewer on all four backgrounds',
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta, info }) => {
    info.setTimeout(90_000);
    const t = T(meta.lang);
    for (const bg of ['white', 'grey', 'cream', 'dark']) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await mockF(page, { me: { background: bg } });
      await openReview(page);
      await page.reload();
      await ready(page);
      await showReq(page, t, 'BGP routing');
      await expect(page.locator('[data-page="1"] [data-testid=pdf-mark]').first()).toBeVisible();
      await settle(page);
      await ux.check(`${bg}: mark shown`, [...STD, 'AZ']);
      await viewTabs(page, t)
        .getByRole('tab', { name: t('Text') })
        .click();
      await ux.check(`${bg}: text`, [...STD, 'AZ']);
      await viewTabs(page, t)
        .getByRole('tab', { name: t('Original') })
        .click();
      await page.getByRole('button', { name: t('Full screen'), exact: true }).click();
      await page.waitForTimeout(500);
      await ux.check(`${bg}: full screen`, [...STD, 'AZ']);
      await page.keyboard.press('Escape');
    }
    await expect
      .soft(page.getByRole('img', { name: t('Page {n}', { n: 1 }), exact: true }))
      .toBeAttached();
    await expect
      .soft(page.getByRole('img', { name: t('Page {n}', { n: 2 }), exact: true }))
      .toBeAttached();
    await expect.soft(page.getByRole('group', { name: t('Zoom') })).toBeVisible();
    await expect
      .soft(page.getByRole('button', { name: t('Full screen'), exact: true }))
      .toHaveAttribute('aria-pressed', 'false');
    await expect.soft(viewTabs(page, t).getByRole('tab')).toHaveCount(2);
    await viewTabs(page, t)
      .getByRole('tab', { name: t('Text') })
      .click();
    const box = page.getByLabel(t('CV text'));
    await box.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect.soft(box, "the 'CV text' box takes focus").toBeFocused();
    expect
      .soft(await box.evaluate((e) => getComputedStyle(e).boxShadow), 'with a visible ring')
      .not.toBe('none');
    // Forced colours: the marks show as an outline.
    await page.emulateMedia({ forcedColors: 'active' });
    await viewTabs(page, t)
      .getByRole('tab', { name: t('Original') })
      .click();
    await showReq(page, t, '5G transport experience');
    const mark = page.locator('[data-testid=pdf-mark]').first();
    await expect(mark).toBeAttached({ timeout: 8_000 });
    const st = await mark.evaluate((m) => ({
      o: getComputedStyle(m).outlineStyle,
      b: getComputedStyle(m).borderStyle,
    }));
    expect
      .soft(
        st.o !== 'none' || st.b !== 'none',
        `with forced colours the marks show as an outline (${JSON.stringify(st)})`,
      )
      .toBe(true);
  },
);
