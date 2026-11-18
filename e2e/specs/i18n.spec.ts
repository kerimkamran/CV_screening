import type { Page } from '@playwright/test';
import { DID, ME, mockApi, openReview, ROWS } from '../fixtures/api';
import { ADMIN_ANSWERS, MFA_OFF, openWith } from '../fixtures/pkg-a';
import { ADMIN_ME } from '../fixtures/pkg-b';
import { resultsApi, DVID } from '../fixtures/pkg-d';
import { vacApi, vrow, vview } from '../fixtures/pkg-c';
import { ulidOf } from '../fixtures/files';
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

// ---------------------------------------------------------------- I18-04

/** Data that stays as entered on the administration pages: people, e-mails, model ids, matter text. */
const ADMIN_DATA = [
  /\S+@\S+/,
  /fake-?\d*/i,
  /Fake AI/i,
  /Other AI/i,
  /claude-[\w-]+/,
  /Anthropic/,
  /Nigar Quliyeva|Tural Hasanli|Sabina Rzayeva|Admin Test|Ayla Karimova|Ayten|Ramin|Ilkin/,
  'Network Engineer',
  /Core network/,
  /\bAPI\b|\bAI\b|\bCV\b|\bPDF\b|\bZIP\b/,
];

uat(
  'I18-04',
  'AZ completeness of Admin, Retention, Monitoring and account pages',
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    test.skip(
      meta.lang !== 'az',
      'The completeness check reads the Azerbaijani screens (the EN project has nothing to compare).',
    );
    ux.allow(/404|Failed to load resource/);
    const t = T('az');
    const table = {
      ...ADMIN_ANSWERS,
      'GET /auth/mfa': MFA_OFF,
      'GET /reports/mine': { reports: [] },
      // The SenAI monitoring card: its own request, with the paused-reader notice showing.
      'GET /admin/assistant/monitoring': {
        days: 30,
        total: 40,
        refused: 2,
        readBy: { rules: 30, model: 10 },
        unknown: 3,
        safeMode: 1,
        byKind: [{ name: 'explain', n: 20 }],
        byIntent: [{ name: 'compare', n: 5 }],
        flags: [{ name: 'stale', n: 2 }],
        breaker: { open: true, until: null },
      },
    };
    const clean = (where: string) => noEnglish(page, where, ADMIN_DATA);
    // 1) Each administration tab as an administrator.
    for (const [hash, h1] of [
      ['#/admin', t('Administration')],
      ['#/admin/ai', t('Administration')],
      ['#/admin/assistant', t('Administration')],
      ['#/admin/monitoring', t('Fairness monitoring')],
      ['#/admin/retention', t('Administration')],
    ] as const) {
      await openWith(page, hash, { me: ADMIN_ME, table });
      await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible();
      await page.waitForTimeout(600); // the cards fill in after their own requests
      await clean(`${hash} as administrator`);
      await ux.check(`admin ${hash}`, [...STD, 'AZ']);
    }
    // The wording the plan names.
    await openWith(page, '#/admin/assistant', { me: ADMIN_ME, table });
    for (const en of [
      'Turn the assistant on',
      'Test connection',
      'Words the assistant knows',
      'What was sent to the model',
    ])
      await expect
        .soft(page.getByText(t(en), { exact: false }).first(), `'${en}' in Azerbaijani`)
        .toBeVisible();
    await openWith(page, '#/admin/retention', { me: ADMIN_ME, table });
    await expect
      .soft(page.getByText(t('Erase expired files now')).first(), "'Erase expired files now' in AZ")
      .toBeAttached();
    // 2) Monitoring as governance, the account pages and the forced password change.
    await openWith(page, '#/admin/monitoring', { me: { roles: ['GOVERNANCE'] }, table });
    await expect(
      page.getByRole('heading', { level: 1, name: t('Fairness monitoring') }),
    ).toBeVisible();
    await page.waitForTimeout(600);
    await clean('#/admin/monitoring as governance');
    for (const hash of ['#/password', '#/security']) {
      await openWith(page, hash, { me: { roles: ['TA_PARTNER'] }, table });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(400);
      await clean(hash);
      await ux.check(`account ${hash}`, [...STD, 'AZ']);
    }
    await openWith(page, '#/', {
      me: { roles: ['TA_PARTNER'], mustChangePassword: true },
      table,
    });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await clean('forced password change');
    await ux.check('forced password change', [...STD, 'AZ']);
  },
);

// ---------------------------------------------------------------- I18-07

uat(
  'I18-07',
  'Dates, times and counts in AZ',
  { on: ['D'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    ux.allow(/404|Failed to load resource/);
    const t = T(meta.lang);
    // The browser says the other language: the screen must follow the UI language, not the browser.
    const other = meta.lang === 'az' ? 'en-US' : 'az-AZ';
    await page.addInitScript((l) => {
      Object.defineProperty(navigator, 'language', { get: () => l });
      Object.defineProperty(navigator, 'languages', { get: () => [l] });
    }, other);
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const MIN = 60_000;
    const ages = [
      30_000,
      5 * MIN,
      3 * 60 * MIN,
      26 * 60 * MIN,
      5 * 24 * 60 * MIN,
      40 * 24 * 60 * MIN,
    ];
    const titles = ages.map((_, i) => `Age row ${i + 1}`);
    await vacApi(page, {
      list: ages.map((a, i) =>
        vrow({
          id: ulidOf('AGE', i + 1),
          title: titles[i],
          updatedAt: ago(a),
          documents: [0, 1, 2, 21, 1, 3][i],
          analyzed: [0, 1, 2, 21, 1, 3][i],
        }),
      ),
      views: [vview()],
    });
    await page.goto('/#/vacancies');
    const li = (i: number) =>
      page
        .getByRole('listitem')
        .filter({ has: page.getByRole('link', { name: titles[i]!, exact: true }) });
    await expect(li(5)).toBeVisible();
    const cells = async (i: number) =>
      (await li(i).locator('> span').allInnerTexts()).map((x) => x.trim());
    const last = async (i: number) => (await cells(i)).at(-1) ?? '';
    // 1) Relative times use the words of the UI language.
    expect.soft(await last(0), 'just now').toBe(t('just now'));
    expect.soft(await last(1), '5 minutes').toBe(t('{n} min ago', { n: 5 }));
    expect.soft(await last(2), '3 hours').toBe(t('{n} h ago', { n: 3 }));
    expect.soft(await last(3), 'a day').toBe(t('yesterday'));
    expect.soft(await last(4), '5 days').toBe(t('{n} days ago', { n: 5 }));
    // 2) Older than 14 days: a date in the UI language, not in the browser's.
    const old = await last(5);
    if (meta.lang === 'az')
      expect
        .soft(old, 'Azerbaijani month name')
        .toMatch(/^\d{1,2} (yan|fev|mar|apr|may|iyn|iyl|avq|sen|okt|noy|dek) \d{4}$/);
    else expect.soft(old, 'English (en-GB) date').toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    // 3) Counts read as they should: no '1 CVs', 'of' pairs in the UI language, one number format.
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    expect.soft(text, "no '1 CVs'").not.toMatch(/\b1 CVs\b/);
    expect.soft(text, 'the 21 of 21 count').toContain(t('{a} of {b}', { a: 21, b: 21 }));
    expect.soft(text, 'no thousands separators in small counts').not.toMatch(/\d,\d{3}\b/);
    await ux.check('times and counts', [...STD, 'AZ']);
    // 4) The Reports page: dates of when a report was shared.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await vacApi(page, {
      views: [vview()],
      extra: async (route, url) =>
        url.pathname === '/reports/mine'
          ? route
              .fulfill({
                json: {
                  reports: [
                    {
                      id: ulidOf('REP', 1),
                      title: 'Network Engineer report',
                      sharedBy: 'Aysel Mammadova',
                      sharedAt: '2026-10-30T09:00:00Z',
                      expiresAt: '2026-11-30T09:00:00Z',
                    },
                  ],
                },
              })
              .then(() => true)
          : false,
    });
    await page.goto('/#/reports');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const rep = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (meta.lang === 'az') expect.soft(rep, 'Azerbaijani month names').toMatch(/oktyabr|noyabr/);
    else expect.soft(rep, 'English month names').toMatch(/October|Oct|30\/10|10\/30/);
    expect.soft(rep).not.toMatch(/\bM1[0-2]\b/); // a browser without data prints "M11" for a month
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
