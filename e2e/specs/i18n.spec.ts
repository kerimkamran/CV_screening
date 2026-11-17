import type { Page } from '@playwright/test';
import { DID, ME, mockApi, openReview, ROWS } from '../fixtures/api';
import { resultsApi, DVID } from '../fixtures/pkg-d';
import { vacApi, vrow, vview } from '../fixtures/pkg-c';
import { englishOnScreen, press, SENAI_H, T } from '../fixtures/pkg-h';
import { expect, STD, test, uat } from '../ux/test';

// 7.x Language (I18), layer L1. UAT plan v1.1; each case is the row of the same ID.

/** Data that may stay English on an AZ screen: names, CV text, quotes, titles, file names. */
const DATA = [
  // Text of the data itself: the CV summaries, the quotes and the vacancy text.
  /Person \d+ ran a carrier BGP and OSPF backbone for six years\./,
  /Quote for [A-Za-z0-9 ]+/,
  /Required: [^\n]*\nNice to have: [^\n]*/,
  'Ayla Karimova',
  'Aysel Mammadova',
  'Aysel Məmmədova',
  'Rauf Əliyev',
  'Network Engineer',
  'UAT Results role',
  'Ten years of carrier network design.',
  'Stated in the work history with dates.',
  'BGP routing',
  'OSPF',
  '5G transport experience',
  'CCIE certification',
  'BGP route reflectors',
  'OSPF areas',
  '5G transport rollout',
  'aysel.pdf',
  'rauf.txt',
  'cv.pdf',
  'ayla@example.az',
  'Core network',
  /Candidate \d+/,
  /Network Engineer \d+/,
  /Python scripting/,
  /\.pdf\b/,
  /BGP route reflectors and OSPF areas across a carrier backbone\./,
  /carrier/i,
];

test.describe('switches the language itself', () => {
  test.use({ presetLang: false });

  uat(
    'I18-01',
    'Switch language signed out: Sign in page, kept in the browser, html lang',
    { on: 'All' },
    async ({ page, ux, browser, meta }) => {
      const az = T('az');
      // 1) A browser in en-US with no saved choice (the project's own locale is overridden).
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });
      await mockApi(page, { signedIn: false });
      await page.goto('/#/');
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
      const select = page.getByRole('combobox', { name: 'Language' });
      await expect(select).toBeVisible();

      // 2) Choose 'Azərbaycan dili'.
      await select.selectOption({ label: 'Azərbaycan dili' });
      await expect(page.getByRole('heading', { name: az('Sign in') })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.lang)).toBe('az');
      expect(await page.evaluate(() => localStorage.getItem('cv-lang'))).toBe('az');
      await expect(page.getByLabel(az('Email'))).toBeVisible();
      await expect(page.getByRole('combobox', { name: az('Language') })).toBeVisible();
      expect(await englishOnScreen(page, ['English']), 'every sign-in text is Azerbaijani').toEqual(
        [],
      );
      await ux.check('signed out in AZ', [...STD, 'AZ']);

      // 3) Reload: AZ and lang='az' from the first paint (recorded when the root first gets content).
      await page.addInitScript(() => {
        const w = window as unknown as { __first?: { lang: string; text: string } };
        new MutationObserver((_, obs) => {
          const root = document.getElementById('root');
          if (root && root.textContent && !w.__first) {
            w.__first = { lang: document.documentElement.lang, text: root.textContent };
            obs.disconnect();
          }
        }).observe(document, { childList: true, subtree: true });
      });
      await page.reload();
      await expect(page.getByRole('heading', { name: az('Sign in') })).toBeVisible();
      const first = await page.evaluate(
        () => (window as unknown as { __first?: { lang: string; text: string } }).__first,
      );
      expect(first?.lang, 'lang at the first paint').toBe('az');
      // The first paint is the loading line ('Yüklənir…') and the footer: Azerbaijani, no English flash.
      expect(first?.text ?? '', 'the first painted text is Azerbaijani').toContain(az('Loading…'));
      for (const en of ['Loading', 'Sign in', 'AI-assisted', 'Language'])
        expect(first?.text ?? '', `no English '${en}' at the first paint`).not.toContain(en);

      // 4) A new browser in az-AZ with no saved choice: AZ at startup.
      const vp = page.viewportSize() ?? undefined;
      for (const [locale, want] of [
        ['az-AZ', 'az'],
        ['ru-RU', 'en'],
      ] as const) {
        const ctx = await browser.newContext({
          locale,
          viewport: vp,
          isMobile: meta.dev === 'A' || meta.dev === 'I',
          hasTouch: meta.touch,
        });
        const p = await ctx.newPage();
        const flush = ux.watch(p);
        await mockApi(p, { signedIn: false });
        await p.goto('/#/');
        const tt = T(want);
        await expect(
          p.getByRole('heading', { name: tt('Sign in') }),
          `${locale}: the sign-in page in ${want}`,
        ).toBeVisible();
        expect(await p.evaluate(() => document.documentElement.lang), `${locale}: html lang`).toBe(
          want,
        );
        expect(
          await p.evaluate(() => localStorage.getItem('cv-lang')),
          `${locale}: nothing saved without an action`,
        ).toBeNull();
        // 5) The select is named 'Language' or its AZ equivalent.
        await expect(p.getByRole('combobox', { name: tt('Language') })).toBeVisible();
        flush();
        await ctx.close();
      }
    },
  );
});

// ---------------------------------------------------------------- I18-03

async function noEnglish(page: Page, where: string, extra: (string | RegExp)[] = []) {
  const left = await englishOnScreen(page, [...DATA, ...extra]);
  expect.soft(left, `${where}: English source text on the Azerbaijani screen`).toEqual([]);
}

uat(
  'I18-03',
  'AZ completeness of recruiter screens and both SenAI panels',
  { on: ['D', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    test.skip(
      meta.lang !== 'az',
      'The completeness check reads the Azerbaijani screens (the EN project has nothing to compare).',
    );
    const t = T('az');
    // Vacancy list with rows, and the ⋯ menu.
    const { seen } = await vacApi(page, {
      assistant: SENAI_H,
      list: [
        vrow(),
        vrow({ id: '01K0000000000000000000000W', title: 'Network Engineer 2', status: 'draft' }),
      ],
      views: [vview()],
      extra: async (route, url) => {
        if (url.pathname === '/assistant/conversations')
          return route.fulfill({ json: [] }).then(() => true);
        if (url.pathname === '/reports/mine')
          return route.fulfill({ json: { reports: [] } }).then(() => true);
        return false;
      },
    });
    void seen;
    await page.goto('/#/vacancies');
    await expect(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
    await noEnglish(page, '#/vacancies');
    await ux.check('vacancy list', [...STD, 'AZ']);
    const dots = page.getByLabel(t('Actions for {title}', { title: 'Network Engineer' }), {
      exact: true,
    });
    if (await dots.isVisible()) {
      await dots.click();
      await noEnglish(page, 'row ⋯ menu');
      await page.keyboard.press('Escape');
    }
    // New vacancy.
    await page.goto('/#/vacancies/new');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noEnglish(page, '#/vacancies/new');
    await ux.check('new vacancy', [...STD, 'AZ']);
    // Candidates.
    await page.goto('/#/candidates');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Aysel Məmmədova').first()).toBeVisible();
    await noEnglish(page, '#/candidates');
    await ux.check('candidates', [...STD, 'AZ']);
    // Reports.
    await page.goto('/#/reports');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noEnglish(page, '#/reports');
    // Account menu.
    await page.getByLabel(t('Account menu'), { exact: true }).click();
    await noEnglish(page, 'account menu');
    await page.getByLabel(t('Account menu'), { exact: true }).click();
    // Pool panel (empty): open it from the Ask bar.
    await page.goto('/#/vacancies');
    const ask = page.getByRole('search').getByRole('textbox');
    await ask.click();
    await ask.press('Enter');
    const pool = page.getByRole('complementary', { name: 'SenAI' });
    await expect(pool).toBeVisible();
    await noEnglish(page, 'pool panel (empty)');
    await ux.check('pool panel', [...STD, 'AZ']);
    await page.keyboard.press('Escape');

    // CV review with the candidate panel: the starter chips are Azerbaijani.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const thread = async (route: import('@playwright/test').Route, url: URL) => {
      if (url.pathname.startsWith('/assistant/conversations'))
        return route.fulfill({ json: [] }).then(() => true);
      if (/^\/screenings\/\w+\/assistant$/.test(url.pathname))
        return route.fulfill({ json: { thread: null } }).then(() => true);
      return false;
    };
    await mockApi(page, { assistant: SENAI_H, extra: thread });
    await openReview(page, DID);
    await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' }).first()).toBeVisible();
    await noEnglish(page, '#/cv/<DID>');
    await ux.check('cv review', [...STD, 'AZ']);
    const ask2 = page.getByRole('search').getByRole('textbox');
    if (await ask2.isVisible()) {
      await ask2.click();
      await ask2.press('Enter');
    }
    const cand = page
      .getByRole('complementary')
      .filter({ has: page.getByRole('list', { name: t('Suggested questions') }) });
    await expect(cand).toBeVisible();
    const chips = (
      await cand
        .getByRole('list', { name: t('Suggested questions') })
        .getByRole('button')
        .allInnerTexts()
    ).map((s) => s.trim());
    for (const en of ['Explain more', 'Deeper evaluation', 'Weakest point', 'Interview questions'])
      expect.soft(chips, `candidate chip '${en}' is Azerbaijani`).not.toContain(en);
    await noEnglish(page, 'candidate panel');
    await ux.check('candidate panel', [...STD, 'AZ']);

    // Each vacancy tab (Results and the rest) through package D's mock.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { assistant: SENAI_H, answers: { 'GET /assistant/conversations': [] } });
    await page.route(/\/screenings\/\w+\/assistant$/, (r) => r.fulfill({ json: { thread: null } }));
    await page.goto(`/#/vacancies/${DVID}/results`);
    const tabs = page.getByRole('tablist', { name: t('Vacancy views') }).getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      await press(tabs.nth(i), page.viewportSize()!.width);
      await page.waitForTimeout(300);
      await noEnglish(page, `vacancy tab ${i + 1} (${(await tabs.nth(i).innerText()).trim()})`, [
        'UAT Results role',
        /Candidate \d+/,
        /Aysel|Rauf|Leyla|Nigar|Orxan|Kamal|Elvin|Murad|Səbinə|Nərmin/,
      ]);
    }
    await ux.check('vacancy tabs', [...STD, 'AZ']);
    void ME;
    void ROWS;
  },
);

// ---------------------------------------------------------------- I18-06

uat(
  'I18-06',
  'Slogan and assistant name in the English UI',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    for (const name of ['SenAI', 'Elon']) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await mockApi(page, {
        assistant: { ...SENAI_H, name },
        extra: async (route, url) =>
          url.pathname.startsWith('/assistant/conversations')
            ? route.fulfill({ json: [] }).then(() => true)
            : false,
      });
      await page.goto(`/?n=${name}#/vacancies`);
      const ask = page.getByRole('search').getByRole('textbox');
      await expect(ask).toBeVisible();
      const ph = (await ask.getAttribute('placeholder')) ?? '';
      await ask.click();
      await ask.press('Enter');
      const panel = page.getByRole('complementary', { name });
      await expect(panel).toBeVisible();
      const sub = panel.locator('header p').first();
      const subText = (await sub.innerText()).trim();
      const subLang = await sub.evaluate((e) => e.closest('[lang]')?.getAttribute('lang') ?? '');
      // The slogan writes the assistant's name as configured. For the default name the approved
      // line (docs/decisions.md: "Sən istə, Senai tapsın") stays as it is; any other name replaces it.
      if (name === 'SenAI') {
        expect
          .soft(ph, 'SenAI: the approved slogan in the Ask bar')
          .toContain('Sən istə, Senai tapsın');
      } else {
        expect
          .soft(ph, `${name}: the Ask bar placeholder carries the name`)
          .toContain(`${name} tapsın`);
        expect
          .soft(ph, `${name}: the Ask bar placeholder does not misspell the name`)
          .not.toMatch(/\bSenai\b/);
        expect
          .soft(subText, `${name}: the panel subtitle does not misspell the name`)
          .not.toMatch(/\bSenai\b/);
      }
      if (meta.lang === 'en') {
        // English UI: English, or the Azerbaijani line is marked lang='az'. A placeholder cannot carry
        // a language mark (and the approved slogan is the Ask bar hint in both languages, SH-04), so
        // only the panel's subtitle is held to the mark.
        expect
          .soft(
            !/Sən istə/.test(subText) || subLang === 'az',
            `${name}: the AZ subtitle in the EN panel is marked lang='az' ('${subText}')`,
          )
          .toBe(true);
      } else {
        expect.soft(subText, 'AZ: the AZ slogan shows').toMatch(/Sən istə/);
      }
      await ux.check(`panel ${name}`, [...STD, 'AZ']);
      void t;
    }
  },
);
