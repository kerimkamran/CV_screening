import type { Page, Route } from '@playwright/test';
import { DID, ME, MID, mockApi, SENAI_ON, type Seen } from '../fixtures/api';
import {
  ADMIN_ANSWERS,
  MFA_OFF,
  openWith,
  REPORT_ID,
  REPORT_OPENED,
  SHARED_ROWS,
} from '../fixtures/pkg-a';
import { expect, uat } from '../ux/test';

// 7.5 Role matrix (RO), screen layer (L1). UAT plan v1.1; each case is the row of the same ID.

const RECRUITER_ROUTES = [
  '#/',
  '#/vacancies',
  '#/vacancies/new',
  '#/candidates',
  `#/cv/${DID}`,
  `#/candidates/${MID}`,
  `#/screenings/${MID}`,
];
const COMMON_ROUTES = ['#/reports', '#/password', '#/security'];
const ADMIN_ROUTES = [
  '#/admin',
  '#/admin/ai',
  '#/admin/assistant',
  '#/admin/monitoring',
  '#/admin/retention',
];
const TABLE = {
  ...ADMIN_ANSWERS,
  [`GET /screenings/${MID}`]: { documentId: DID },
  'GET /reports/mine': { reports: [] },
  'GET /auth/mfa': MFA_OFF,
  'GET /assistant/preferences': { top: null },
};
const CANDIDATE_DATA = /^\/(vacancies|candidates|documents|screenings)(\/|\?|$)/;

async function go(page: Page, hash: string) {
  await page.goto(`/?ro=1${hash}`);
  await page.waitForTimeout(250);
}
const menuLinks = async (page: Page) => {
  await page.getByLabel('Account menu', { exact: true }).click();
  const links = await page.locator('header details[open] > div').getByRole('link').allInnerTexts();
  const remembers = await page
    .locator('header details[open] > div')
    .getByText('What SenAI remembers')
    .count();
  await page.keyboard.press('Escape');
  await page
    .locator('header > div > details')
    .first()
    .evaluate((d) => d.removeAttribute('open'));
  return { links, remembers };
};
const adminOnly = (page: Page) =>
  expect(page.getByRole('alert').filter({ hasText: 'Administrators only.' })).toBeVisible();
async function commonPages(page: Page) {
  await go(page, '#/reports');
  await expect(page.getByRole('heading', { level: 1, name: 'Shared with me' })).toBeVisible();
  await go(page, '#/password');
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  await go(page, '#/security');
  await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
}
async function adminPages(page: Page) {
  const tabs = page.getByRole('navigation', { name: 'Administration' });
  const check: Record<string, () => Promise<void>> = {
    '#/admin': () => expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible(),
    '#/admin/ai': () => expect(page.getByText(/Screening uses Anthropic/)).toBeVisible(),
    '#/admin/assistant': () => expect(page.getByText('Turn the assistant on')).toBeVisible(),
    '#/admin/monitoring': async () => {
      await expect(
        page.getByRole('heading', { level: 1, name: 'Fairness monitoring' }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Run the paired-CV test' })).toBeVisible();
    },
    '#/admin/retention': () =>
      expect(page.getByRole('heading', { name: 'Retention period' })).toBeVisible(),
  };
  for (const r of ADMIN_ROUTES) {
    await go(page, r);
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('link')).toHaveText([
      'Users',
      'AI models',
      'SenAI',
      'Fairness monitoring',
      'Data retention',
      'Oracle import',
    ]);
    await check[r]!();
  }
}
const railOrBar = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const noCandidateCalls = (seen: Seen, from: number, why: string) =>
  expect(
    seen.requests
      .slice(from)
      .filter((r) => CANDIDATE_DATA.test(r.url))
      .map((r) => `${r.method} ${r.url}`),
    why,
  ).toEqual([]);

uat(
  'RO-01',
  'Route matrix: recruiter and recruiting lead',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/Transition was skipped/); // the test changes routes faster than a person
    for (const roles of [['TA_PARTNER'], ['TA_LEAD']]) {
      await openWith(page, '#/', { me: { roles }, assistant: SENAI_ON, table: TABLE });
      for (const r of [...RECRUITER_ROUTES, ...COMMON_ROUTES, ...ADMIN_ROUTES]) {
        await go(page, r);
        if (r === '#/') {
          await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeAttached();
          await expect(page.getByRole('region', { name: 'Screen candidates' })).toBeVisible();
          await expect(page.getByRole('link', { name: /^New vacancy/ })).toBeVisible();
        } else if (r === '#/vacancies') {
          await expect(page.getByRole('heading', { level: 1, name: 'Vacancies' })).toBeVisible();
          await expect(page.getByRole('link', { name: 'New vacancy' }).first()).toBeVisible();
        } else if (r === '#/vacancies/new')
          await expect(page.getByRole('heading', { level: 1, name: 'New vacancy' })).toBeVisible();
        else if (r === '#/candidates')
          await expect(page.getByRole('heading', { level: 1, name: 'Candidates' })).toBeVisible();
        else if (r.startsWith('#/cv/') || r.includes(MID)) {
          await expect(page).toHaveURL(new RegExp(`#/cv/${DID}$`));
          await expect(
            page.getByRole('heading', { name: 'Aysel Məmmədova' }).first(),
          ).toBeAttached();
          const mark = page.getByLabel(/^Decision for /).first();
          await expect(mark).toBeAttached();
          await expect(mark).toBeEnabled();
        } else if (r === '#/reports')
          await expect(
            page.getByRole('heading', { level: 1, name: 'Shared with me' }),
          ).toBeVisible();
        else if (r === '#/password')
          await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
        else if (r === '#/security')
          await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
        else await adminOnly(page);
        await expect(railOrBar(page), `${roles[0]} ${r}: rail or bottom bar`).toBeVisible();
        await expect(page.getByRole('search'), `${roles[0]} ${r}: Ask bar`).toHaveCount(1);
      }
      const m = await menuLinks(page);
      expect(m.links).toEqual(['Shared with me', 'Change password', 'Security']);
      await ux.check(`${roles[0]} routes`);
    }
  },
);

uat(
  'RO-02',
  'Route matrix: administrator without recruiter role',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/Transition was skipped/);
    const seen = await openWith(page, '#/', {
      me: { roles: ['ADMIN'] },
      assistant: SENAI_ON,
      table: TABLE,
    });
    const from = seen.requests.length;
    for (const r of RECRUITER_ROUTES) {
      await go(page, r);
      const sentence =
        'Administrators manage users and AI models under Administration. Candidate data is available only to recruiters.';
      if (r === '#/') {
        // The landing page is Home: the administration functions, with the same explanation.
        await expect(page.getByRole('region', { name: 'Administration' })).toBeVisible();
        await expect(page.getByText(sentence)).toBeVisible();
        await expect(page.getByRole('link', { name: /^Candidates/ })).toHaveCount(0);
      } else await expect(page.getByRole('status').filter({ hasText: sentence })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${r.replace(/[/#]/g, '\\$&')}$`));
    }
    noCandidateCalls(seen, from, 'no request to candidate data');
    await adminPages(page);
    await commonPages(page);
    await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(0);
    expect((await menuLinks(page)).links).toEqual([
      'Shared with me',
      'Fairness monitoring',
      'Administration',
      'Change password',
      'Security',
    ]);
    await expect
      .soft(
        page.getByRole('search'),
        'no Ask bar for an administrator without the recruiter role, even with SenAI on',
      )
      .toHaveCount(0);
    await expect
      .soft(page.getByRole('complementary', { name: 'SenAI' }), 'no SenAI panel')
      .toHaveCount(0);
    await ux.check('admin');
  },
);

uat(
  'RO-03',
  'Route matrix: administrator who is also a recruiter',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/Transition was skipped/);
    await openWith(page, '#/', {
      me: { roles: ['ADMIN', 'TA_PARTNER'] },
      assistant: SENAI_ON,
      table: TABLE,
    });
    for (const r of RECRUITER_ROUTES) {
      await go(page, r);
      if (r === '#/') {
        await expect(page.getByRole('region', { name: 'Screen candidates' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Administration' })).toBeVisible();
      } else if (r === '#/vacancies')
        await expect(page.getByRole('link', { name: 'New vacancy' }).first()).toBeVisible();
      else if (r === '#/vacancies/new')
        await expect(page.getByRole('heading', { level: 1, name: 'New vacancy' })).toBeVisible();
      else if (r === '#/candidates')
        await expect(page.getByRole('heading', { level: 1, name: 'Candidates' })).toBeVisible();
      else await expect(page).toHaveURL(new RegExp(`#/cv/${DID}$`));
      await expect(railOrBar(page)).toBeVisible();
      await expect(page.getByRole('search')).toHaveCount(1);
    }
    await adminPages(page);
    await commonPages(page);
    const m = await menuLinks(page);
    expect(m.links).toEqual([
      'Shared with me',
      'Fairness monitoring',
      'Administration',
      'Change password',
      'Security',
    ]);
    expect(m.remembers).toBe(1);
    await expect(page.locator('header a[title]').first()).toHaveAttribute('href', '#/');
    await ux.check('admin+TA');
  },
);

uat('RO-04', 'Route matrix: governance', { on: ['D', 'A'], langs: 'EN' }, async ({ page, ux }) => {
  ux.allow(/Transition was skipped/);
  const seen = await openWith(page, '#/', {
    me: { roles: ['GOVERNANCE'] },
    assistant: SENAI_ON,
    table: TABLE,
  });
  const from = seen.requests.length;
  for (const r of [...RECRUITER_ROUTES, '#/admin/monitoring']) {
    await go(page, r);
    if (r === '#/') {
      // Home for governance: monitoring, the assistant review and shared reports, nothing else.
      await expect(page.getByRole('region', { name: 'Oversight' })).toBeVisible();
      await expect(page.getByRole('link', { name: /^Fairness monitoring/ })).toBeVisible();
      await expect(page.getByRole('link', { name: /^Users/ })).toHaveCount(0);
      continue;
    }
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fairness monitoring' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Run the paired-CV test/ })).toHaveCount(0);
  }
  noCandidateCalls(seen, from, 'no request to candidate or document endpoints');
  for (const r of ['#/admin', '#/admin/ai', '#/admin/retention']) {
    await go(page, r);
    await adminOnly(page);
  }
  // SX-08: governance reads the assistant's recent answers and payload log, and nothing to edit.
  await go(page, '#/admin/assistant');
  await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Recent answers/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  await commonPages(page);
  await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(0);
  expect((await menuLinks(page)).links).toEqual([
    'Shared with me',
    'Fairness monitoring',
    'Change password',
    'Security',
  ]);
  await expect
    .soft(page.getByRole('search'), 'no Ask bar for governance, even with SenAI on')
    .toHaveCount(0);
  await ux.check('governance');
});

uat(
  'RO-05',
  'Route matrix: report viewer with no role',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/Transition was skipped/);
    const seen = await openWith(page, '#/', {
      me: { roles: [] },
      assistant: SENAI_ON,
      table: {
        ...TABLE,
        'GET /reports/mine': { reports: [SHARED_ROWS[0]] },
        [`GET /reports/${REPORT_ID}`]: REPORT_OPENED,
      },
    });
    const from = seen.requests.length;
    for (const r of RECRUITER_ROUTES) {
      await go(page, r);
      await expect(page.getByRole('heading', { level: 1, name: 'Shared with me' })).toBeVisible();
    }
    noCandidateCalls(seen, from, 'no request to candidate endpoints');
    await go(page, `#/reports/${REPORT_ID}`);
    await expect(page.getByRole('article', { name: 'Shared evaluation report' })).toBeVisible();
    for (const r of ADMIN_ROUTES) {
      await go(page, r);
      await adminOnly(page);
    }
    await go(page, '#/password');
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
    await go(page, '#/security');
    await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
    await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(0);
    expect((await menuLinks(page)).links).toEqual([
      'Shared with me',
      'Change password',
      'Security',
    ]);
    await expect
      .soft(page.getByRole('search'), 'no Ask bar for a report viewer, even with SenAI on')
      .toHaveCount(0);
    await ux.check('viewer');
  },
);

uat(
  'RO-06',
  'Route matrix: signed-out and temporary-password accounts',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/Transition was skipped/);
    const TOKEN = 'D'.repeat(43);
    const ALL = [...RECRUITER_ROUTES, ...COMMON_ROUTES, ...ADMIN_ROUTES];
    const check = {
      'POST /auth/setup-link/check': {
        email: 'new.user@example.az',
        displayName: 'Leyla Həsənova',
      },
    };
    // 1) Signed out.
    await openWith(page, '#/', {
      signedIn: false,
      table: {
        ...TABLE,
        ...check,
        '/me': (route: Route) =>
          route.request().headers().authorization === 'Bearer t-ro6'
            ? route.fulfill({ json: ME })
            : route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
        'POST /auth/login': { token: 't-ro6', expiresIn: 3600, mustChangePassword: false },
      },
    });
    for (const r of ALL) {
      await go(page, r);
      await expect(
        page.getByRole('button', { name: 'Sign in', exact: true }),
        `signed out ${r}`,
      ).toBeVisible();
    }
    await go(page, `#/set-password?token=${TOKEN}`);
    await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
    await ux.check('signed out');
    // 2) Sign in on #/candidates: the typed route is kept.
    await go(page, '#/candidates');
    await page.getByLabel('Email').fill('ayla@example.az');
    await page.getByLabel('Password', { exact: true }).fill('Correct-horse-battery-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Candidates' })).toBeVisible();
    await expect(page).toHaveURL(/#\/candidates$/);
    // 3) The temporary-password account.
    await page.evaluate(() => sessionStorage.removeItem('cv.session'));
    await openWith(page, '#/', {
      me: { roles: ['TA_PARTNER'], mustChangePassword: true },
      table: { ...TABLE, ...check },
    });
    for (const r of ALL) {
      await go(page, r);
      await expect(
        page.getByRole('heading', { name: 'Choose your own password' }),
        `must-change ${r}`,
      ).toBeVisible();
    }
    await go(page, `#/set-password?token=${TOKEN}`);
    await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
    await expect(
      page.getByText('Welcome, Leyla Həsənova. Choose a password for your account:'),
    ).toBeVisible();
    await ux.check('must-change');
    void mockApi;
  },
);
