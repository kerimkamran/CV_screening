import type { Page } from '@playwright/test';
import { ME, SENAI_ON, VID } from '../fixtures/api';
import { openWith } from '../fixtures/pkg-a';
import { expect, uat } from '../ux/test';

// 7.30 Home (HM), screen layer (L1). #/ is the menu of what a person can do: a greeting, an
// assistant prompt, tiles by role, the last vacancies, and the account links.

const VACANCIES = [
  { id: VID, title: 'Network Engineer', status: 'open', archived: false },
  { id: '01K0000000000000000000000W', title: 'Data Analyst', status: 'open', archived: false },
  { id: '01K0000000000000000000000X', title: 'Retired role', status: 'closed', archived: true },
].map((v) => ({
  department: null,
  location: null,
  owner: { id: ME.userId, name: ME.displayName },
  canEdit: true,
  documents: 0,
  analyzed: 0,
  outOfDate: 0,
  strong: 0,
  decisions: { shortlist: 0, maybe: 0, notNow: 0 },
  running: 0,
  stopped: 0,
  version: 1,
  updatedAt: '2026-11-10T09:00:00Z',
  createdAt: '2026-11-01T09:00:00Z',
  ...v,
}));

const main = (page: Page) => page.locator('main');
/** The links of the Home page itself (not the rail and not the header). */
const homeLinks = async (page: Page) =>
  Object.fromEntries(
    await main(page)
      .getByRole('link')
      .evaluateAll((els) =>
        els.map((a) => [(a.textContent ?? '').replace(/\s+/g, ' ').trim(), a.getAttribute('href')]),
      ),
  ) as Record<string, string>;
const startsWith = (links: Record<string, string>, text: string) =>
  Object.entries(links).find(([k]) => k.startsWith(text))?.[1];

uat(
  'HM-01',
  'Home is a menu of functions by role, and every tile is a real link',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, tx }) => {
    const L = {
      screen: tx('Screen candidates', 'Namizədləri yoxlayın'),
      admin: tx('Administration', 'İdarəetmə'),
      oversight: tx('Oversight', 'Nəzarət'),
      newV: tx('New vacancy', 'Yeni vakansiya'),
      vacs: tx('Vacancies', 'Vakansiyalar'),
      cands: tx('Candidates', 'Namizədlər'),
      shared: tx('Shared with me', 'Mənimlə paylaşılanlar'),
      users: tx('Users', 'İstifadəçilər'),
      models: tx('AI models', 'Süni intellekt modelləri'),
      assistant: tx('SenAI', 'SenAI'),
      monitoring: tx('Fairness monitoring', 'Ədalətlilik monitorinqi'),
      retention: tx('Data retention', 'Məlumatın saxlanma müddəti'),
      password: tx('Change password', 'Parolu dəyişin'),
      security: tx('Security', 'Təhlükəsizlik'),
      hello: tx(
        /^Good (morning|afternoon|evening), Ayla$/,
        /^(Sabahınız|Günortanız|Axşamınız) xeyir, Ayla$/,
      ),
    };
    const table = { 'GET /reports/mine': { reports: [] } };
    ux.allow(/reports|404|Failed to load resource/);

    // 1) A recruiter: the screening functions, the account links, nothing for administrators.
    await openWith(page, '#/', { me: { roles: ['TA_PARTNER'] }, vacancies: VACANCIES, table });
    await expect(
      page.getByRole('heading', { level: 1, name: tx('Home', 'Ana səhifə') }),
    ).toBeAttached();
    await expect(page.getByText(L.hello)).toBeVisible();
    const region = page.getByRole('region', { name: L.screen });
    await expect(region).toBeVisible();
    const rec = await homeLinks(page);
    expect(startsWith(rec, L.newV)).toBe('#/vacancies/new');
    expect(startsWith(rec, L.vacs)).toBe('#/vacancies');
    expect(startsWith(rec, L.cands)).toBe('#/candidates');
    expect(startsWith(rec, L.shared)).toBe('#/reports');
    expect(rec[L.password]).toBe('#/password');
    expect(rec[L.security]).toBe('#/security');
    expect(Object.values(rec).some((h) => h.startsWith('#/admin'))).toBe(false);
    await ux.check('recruiter home', ['AZ', 'OCC', 'OVL', 'OVF']);

    // 2) A tile leads where it says.
    await region.getByRole('link', { name: new RegExp(`^${L.vacs}`) }).click();
    await expect(page).toHaveURL(/#\/vacancies$/);
    await expect(page.getByRole('heading', { name: L.vacs, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('region', { name: L.screen })).toBeVisible();
    await page
      .getByRole('region', { name: L.screen })
      .getByRole('link', { name: new RegExp(`^${L.newV}`) })
      .click();
    await expect(page).toHaveURL(/#\/vacancies\/new$/);

    // 3) An administrator: the administration functions and the explanation, no candidate data.
    await openWith(page, '#/', { me: { roles: ['ADMIN'], displayName: 'Ayla Karimova' }, table });
    await expect(page.getByRole('region', { name: L.admin })).toBeVisible(); // rendered before reading
    const admin = await homeLinks(page);
    expect(startsWith(admin, L.users)).toBe('#/admin');
    expect(startsWith(admin, L.models)).toBe('#/admin/ai');
    expect(startsWith(admin, L.assistant)).toBe('#/admin/assistant');
    expect(startsWith(admin, L.monitoring)).toBe('#/admin/monitoring');
    expect(startsWith(admin, L.retention)).toBe('#/admin/retention');
    expect(admin[L.shared]).toBe('#/reports');
    expect(Object.values(admin).some((h) => h === '#/candidates' || h === '#/vacancies/new')).toBe(
      false,
    );
    await expect(page.getByRole('region', { name: L.admin })).toBeVisible();
    await expect(page.getByRole('navigation', { name: tx('Main', 'Əsas') })).toHaveCount(0);
    await ux.check('administrator home', ['AZ', 'OCC', 'OVL', 'OVF']);

    // 4) Governance: monitoring and the assistant review.
    await openWith(page, '#/', { me: { roles: ['GOVERNANCE'] }, table });
    await expect(page.getByRole('region', { name: L.oversight })).toBeVisible();
    const gov = await homeLinks(page);
    expect(startsWith(gov, L.monitoring)).toBe('#/admin/monitoring');
    expect(startsWith(gov, L.assistant)).toBe('#/admin/assistant');
    expect(startsWith(gov, L.users)).toBeUndefined();
    await expect(page.getByRole('region', { name: L.oversight })).toBeVisible();
    await ux.check('governance home', ['AZ', 'OCC', 'OVL', 'OVF']);

    // 5) Someone who is both: the screening tiles and a row of administration tiles.
    await openWith(page, '#/', { me: { roles: ['ADMIN', 'TA_PARTNER'] }, table });
    await expect(page.getByRole('region', { name: L.screen })).toBeVisible();
    await expect(page.getByRole('region', { name: L.admin }).getByRole('link')).toHaveCount(5);

    // 6) No role: the shared reports, as before; Home is not offered.
    await openWith(page, '#/', { me: { roles: [] }, table });
    await expect(
      page.getByRole('heading', {
        name: tx('Shared with me', 'Mənimlə paylaşılanlar'),
      }),
    ).toBeVisible();
  },
);

uat(
  'HM-02',
  'The prompt bar and the Ask tile open the assistant, and exist only when it is on',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, tx }) => {
    ux.allow(/assistant|404|Failed to load resource/);
    const prompt = page.getByRole('textbox', {
      name: tx(
        'Ask SenAI about your candidates',
        'SenAI adlı köməkçidən namizədləriniz barədə soruşun',
      ),
    });
    const panel = page.getByRole('complementary', { name: 'SenAI' });

    // 1) Off: no prompt, no Ask tile.
    await openWith(page, '#/', { me: { roles: ['TA_PARTNER'] } });
    await expect(
      page.getByRole('region', { name: tx('Screen candidates', 'Namizədləri yoxlayın') }),
    ).toBeVisible();
    await expect(prompt).toHaveCount(0);
    await expect(main(page).getByRole('button')).toHaveCount(0);

    // 2) On: type a question and press Enter: the assistant opens with it.
    await openWith(page, '#/', {
      me: { roles: ['TA_PARTNER'] },
      assistant: SENAI_ON,
      vacancies: VACANCIES,
    });
    await expect(prompt).toBeVisible();
    await ux.check('prompt', ['AZ', 'OCC', 'OVL', 'OVF']);
    const q = 'Who knows BGP?';
    await prompt.fill(q);
    await prompt.press('Enter');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(q).first()).toBeVisible();
    await expect(prompt).toHaveValue('');

    // 3) The Ask tile opens it without a question.
    await openWith(page, '#/', {
      me: { roles: ['TA_PARTNER'] },
      assistant: SENAI_ON,
      vacancies: VACANCIES,
    });
    await expect(panel).toHaveCount(0);
    // The tile, not the prompt's own send button (whose name begins the same way).
    const tile = main(page).locator('button.home-tile');
    await expect(tile).toHaveCount(1);
    await expect(tile).toContainText(tx('Ask SenAI', 'SenAI adlı köməkçidən soruşun'));
    await tile.click();
    await expect(panel).toBeVisible();
  },
);

uat(
  'HM-03',
  'Home moves softly, and with "reduce motion" nothing moves and everything is there',
  { on: ['D'], langs: 'EN+AZ' },
  async ({ page }) => {
    const tiles = () => main(page).locator('.home-tile');
    // 1) Reduce motion: no animation at all, every tile fully visible at once.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWith(page, '#/', {
      me: { roles: ['TA_PARTNER'] },
      assistant: SENAI_ON,
      vacancies: VACANCIES,
    });
    await expect(tiles().first()).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    for (const o of await tiles().evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity)))
      expect(o).toBe('1');
    await tiles().nth(1).hover();
    expect(
      await tiles()
        .nth(1)
        .evaluate((e) => getComputedStyle(e).translate),
      'no lift with reduced motion',
    ).toMatch(/^(none|0px)( 0px)?$/);

    // 2) Motion allowed: the tiles rise in one after another and settle fully visible.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openWith(page, '#/', {
      me: { roles: ['TA_PARTNER'] },
      assistant: SENAI_ON,
      vacancies: VACANCIES,
    });
    await expect(tiles().first()).toBeVisible();
    const delays = await tiles().evaluateAll((els) =>
      els.map((e) => parseFloat(getComputedStyle(e).animationDelay)),
    );
    expect(delays.length).toBeGreaterThanOrEqual(5);
    expect(delays[delays.length - 1]!, 'later tiles start later').toBeGreaterThan(delays[0]!);
    await expect
      .poll(async () =>
        (await tiles().evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity))).every(
          (o) => o === '1',
        ),
      )
      .toBe(true);

    // 3) A tile gives way to the pointer: it lifts and its arrow arrives.
    await page.mouse.move(1, 1); // the pointer from step 1 is still over a tile after the reload
    const t = tiles().nth(1);
    const arrow = t.locator('.home-arrow');
    await expect.poll(() => arrow.evaluate((e) => getComputedStyle(e).opacity)).toBe('0'); // it fades out
    await t.hover();
    await expect
      .poll(async () =>
        parseFloat((await t.evaluate((e) => getComputedStyle(e).translate)).split(' ')[1] ?? '0'),
      )
      .toBeLessThan(0);
    await expect.poll(() => arrow.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    // The prompt bar shows a focus ring.
    await main(page).getByRole('textbox').focus();
    expect(
      await main(page)
        .locator('.home-prompt')
        .evaluate((e) => getComputedStyle(e).boxShadow),
    ).not.toBe('none');
  },
);

uat(
  'HM-04',
  'Home reads well on all four backgrounds, including dark',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    for (const background of ['white', 'grey', 'cream', 'dark'] as const) {
      await openWith(page, '#/', {
        me: { roles: ['TA_PARTNER'], background },
        assistant: SENAI_ON,
        vacancies: VACANCIES,
      });
      await expect(page.locator('html')).toHaveAttribute('data-bg', background);
      await expect(main(page).locator('.home-tile').first()).toBeVisible();
      // The gradient greeting is real text in the colour of the page's ink at the least.
      const greeting = main(page).locator('.home-greeting');
      await expect(greeting).toBeVisible();
      // Every tile's text is readable on its own container (4.5:1 from the measured colours).
      const worst = await main(page)
        .locator('.home-tile:not(.home-lead)')
        .evaluateAll((els) => {
          const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const lum = (c: number[]) => {
            const f = (v: number) => {
              const s = v / 255;
              return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
          };
          let min = 99;
          for (const e of els) {
            const cs = getComputedStyle(e);
            const a = lum(rgb(cs.backgroundColor));
            const b = lum(rgb(cs.color));
            min = Math.min(min, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
          }
          return min;
        });
      expect(worst, `${background}: tile text contrast`).toBeGreaterThanOrEqual(4.5);
      await ux.check(`home on ${background}`, ['OCC', 'OVL', 'OVF']);
    }
  },
);

uat(
  'HM-05',
  'Home is in the rail, the brand leads back to it, and the last vacancies are one tap away',
  { on: ['D', 'A', 'T'], langs: 'EN+AZ' },
  async ({ page, ux, tx }) => {
    ux.allow(/404|Failed to load resource/);
    const phone = (page.viewportSize()?.width ?? 1200) < 640;
    const L = {
      main: tx('Main', 'Əsas'),
      home: tx('Home', 'Ana səhifə'),
      vacs: tx('Vacancies', 'Vakansiyalar'),
      cands: tx('Candidates', 'Namizədlər'),
    };
    await openWith(page, '#/', {
      me: { roles: ['TA_PARTNER'] },
      assistant: SENAI_ON,
      vacancies: VACANCIES,
    });
    const nav = page.getByRole('navigation', { name: L.main }).filter({ visible: true });
    await expect(nav).toBeVisible();
    if (phone) {
      // The bottom bar keeps its three items (long Azerbaijani labels still fit); the brand is Home.
      await expect(nav.getByRole('link')).toHaveCount(2);
      await expect(nav.getByRole('link', { name: L.home })).toHaveCount(0);
    } else {
      await expect(nav.getByRole('link')).toHaveText([L.home, L.vacs, L.cands]);
      await expect(nav.getByRole('link', { name: L.home })).toHaveAttribute('aria-current', 'page');
    }
    await ux.check('home frame', ['AZ', 'OCC', 'OVL', 'OVF']);

    // The last vacancies: one tap to the vacancy page; archived ones are not offered.
    const recent = page.getByRole('region', {
      name: tx('Pick up where you left off', 'Qaldığınız yerdən davam edin'),
    });
    await expect(recent.getByRole('link')).toHaveText(['Network Engineer', 'Data Analyst']);
    await expect(recent.getByRole('link', { name: 'Retired role' })).toHaveCount(0);
    await recent.getByRole('link', { name: 'Data Analyst' }).click();
    await expect(page).toHaveURL(/#\/vacancies\/01K0000000000000000000000W/);

    // The brand leads back to Home from any page, and the rail marks it.
    await page
      .getByRole('link', { name: /parallax/ })
      .first()
      .click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(
      page.getByRole('region', { name: tx('Screen candidates', 'Namizədləri yoxlayın') }),
    ).toBeVisible();
    if (!phone) {
      await page
        .getByRole('navigation', { name: L.main })
        .getByRole('link', { name: L.vacs })
        .click();
      await expect(page).toHaveURL(/#\/vacancies$/);
      await expect(
        page.getByRole('navigation', { name: L.main }).getByRole('link', { name: L.vacs }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(
        page.getByRole('navigation', { name: L.main }).getByRole('link', { name: L.home }),
      ).not.toHaveAttribute('aria-current', 'page');
    }
  },
);
