import type { Page } from '@playwright/test';
import { mockApi } from '../fixtures/api';
import {
  ADMIN_ME,
  aiOverview,
  calls,
  CATALOG,
  CONN_ID,
  json,
  M1,
  M2,
  pageScrollsSideways,
  retention,
  RET_VACS,
  TOKEN43,
  USER_LIST,
  USERS,
} from '../fixtures/pkg-b';
import { expect, test, uat } from '../ux/test';

// 7.x Administration (AD), screen layer (L1, mocked API). All people and keys are invented.

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
const btn = (page: Page, name: string, row?: string) =>
  (row ? page.getByRole('row').filter({ hasText: row }) : page).getByRole('button', {
    name,
    exact: true,
  });

/** Did the click open a confirmation (browser dialog or an in-page dialog)? Records browser dialogs. */
function watchDialogs(page: Page, answer: () => boolean) {
  const seen: string[] = [];
  page.on('dialog', (d) => {
    seen.push(d.message());
    void (answer() ? d.accept() : d.dismiss());
  });
  return seen;
}
/** A select inside a Field: its label text includes the options, so match the label's own span. */
const sel = (scope: Page | import('@playwright/test').Locator, name: string) =>
  scope.locator(`label:has(> span:text-is("${name}")) select`);
const inPageConfirm = (page: Page) => page.getByRole('dialog').or(page.getByRole('alertdialog'));

// ---------------------------------------------------------------- Users

uat(
  'AD-01',
  'Users tab: form, table and row actions by state',
  { on: ['D', 'DS', 'T', 'A'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    await mockApi(page, {
      me: ADMIN_ME,
      extra: (route, url) => (url.pathname === '/admin/users' ? json(route, USER_LIST) : false),
    });
    await page.goto('/#/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Administration' });
    await expect(tabs.getByRole('link')).toHaveText([
      'Users',
      'AI models',
      'Assistant',
      'Monitoring',
      'Data retention',
    ]);
    await expect(tabs.getByRole('link', { name: 'Users' })).toHaveClass(/bg-accent/);
    // The form.
    await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
    const role = sel(page, 'Role');
    await expect(role.locator('option')).toHaveText([
      'Recruiter',
      'Recruiting lead',
      'Governance (read-only)',
      'Administrator',
      'Report viewer only (no other access)',
    ]);
    await expect(role).toHaveValue('TA_PARTNER');
    await expect(page.getByRole('button', { name: 'Create user' })).toBeVisible();
    await expect(page.getByText(/^The user gets an email with a one-time link/)).toBeVisible();
    // The table.
    const table = page.getByRole('table', { name: 'Users' });
    await expect(table.locator('thead th')).toHaveText(
      ['Name', 'Email', 'Roles', 'Status', 'Last seen', 'Actions'],
      { ignoreCase: true },
    );
    await expect(table.getByRole('row')).toHaveCount(1 + 5);
    await expect(page.getByText(USERS.system.displayName)).toHaveCount(0);
    await expect(row(page, USERS.recruiter.displayName).getByRole('cell').nth(3)).toHaveText(
      'Active',
    );
    await expect(row(page, USERS.lead.displayName).getByRole('cell').nth(3)).toHaveText('Invited');
    await expect(row(page, USERS.governance.displayName).getByRole('cell').nth(3)).toHaveText(
      'Disabled',
    );
    await expect(row(page, USERS.viewer.displayName).getByRole('cell').nth(3)).toContainText(
      '· two-step on',
    );
    await expect(row(page, USERS.viewer.displayName).getByRole('cell').nth(2)).toHaveText(
      'Report viewer only',
    );
    // Row actions.
    const actions = async (name: string) => row(page, name).getByRole('button').allInnerTexts();
    expect(await actions(USERS.recruiter.displayName)).toEqual([
      'Copy invite link',
      'Reset password',
      'Disable',
    ]);
    expect(await actions(USERS.lead.displayName)).toEqual([
      'Copy invite link',
      'Reset password',
      'Disable',
    ]);
    expect(await actions(USERS.viewer.displayName)).toEqual([
      'Copy invite link',
      'Reset password',
      'Reset two-step',
      'Disable',
    ]);
    expect(await actions(USERS.governance.displayName)).toEqual(['Enable']);
    const own = await actions(USERS.self.displayName);
    expect(own).toContain('Copy invite link');
    expect(own).not.toContain('Disable');
    await ux.check('users', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    // 4) On the phone the table scrolls inside its card; the page does not.
    if (meta.dev === 'A') {
      const box = table.locator('xpath=..');
      const sc = await box.evaluate((el) => ({
        sw: el.scrollWidth,
        cw: el.clientWidth,
        ox: getComputedStyle(el).overflowX,
      }));
      expect(sc.ox).toBe('auto');
      expect(sc.sw).toBeGreaterThan(sc.cw);
      await box.evaluate((el) => el.scrollBy(200, 0));
      expect(await box.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    }
    expect(await pageScrollsSideways(page)).toBe(false);
  },
);

uat(
  'AD-02',
  'Add a user: emailed, not emailed, link only, copy link, duplicate',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const answers: ((r: import('@playwright/test').Route) => Promise<void>)[] = [];
    const user = {
      id: '01K000000000000000000000N1',
      email: 'kenan.new@example.az',
      displayName: 'Kenan Aliyev',
    };
    const seen = await mockApi(page, {
      me: ADMIN_ME,
      extra: async (route, url) => {
        if (url.pathname === '/admin/users' && route.request().method() === 'POST') {
          await answers.shift()!(route);
          return true;
        }
        if (url.pathname === '/admin/users') return json(route, USER_LIST);
        return false;
      },
    });
    ux.allow(/409/);
    await page.goto('/#/admin');
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();
    const fill = async () => {
      await page.getByLabel('Email', { exact: true }).fill(user.email);
      await page.getByLabel('Name', { exact: true }).fill(user.displayName);
    };
    const link = page.getByLabel('Invitation link');
    const origin = new URL(page.url()).origin;
    const expected = `${origin}/#/set-password?token=${TOKEN43}`;

    // 1) Answer (a), emailed; slow, so the busy state can be seen.
    answers.push(async (r) => {
      await new Promise((res) => setTimeout(res, 700));
      await r.fulfill({ status: 201, json: { user, emailSent: true, setupToken: TOKEN43 } });
    });
    await sel(page, 'Role').selectOption({ label: 'Recruiting lead' });
    await fill();
    const gets = () => calls(seen, 'GET', /^\/admin\/users$/).length;
    const before = gets();
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByRole('button', { name: 'Create user' })).toBeDisabled();
    await expect(
      page.getByText(
        `Credentials were emailed to ${user.email}. You can also send an invitation link yourself.`,
      ),
    ).toBeVisible();
    expect(calls(seen, 'POST', /^\/admin\/users$/)[0]!.body).toEqual({
      email: user.email,
      displayName: user.displayName,
      role: 'TA_LEAD',
    });
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
    await expect(sel(page, 'Role')).toHaveValue('TA_LEAD');
    expect(gets()).toBeGreaterThan(before);
    await expect(link).toHaveValue(expected);
    // 2) Copy link.
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('Link copied.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    await ux.check('link copied', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    // 3) Focus selects the whole value.
    await link.focus();
    const sel1 = await link.evaluate((el: HTMLInputElement) => [
      el.selectionStart,
      el.selectionEnd,
      el.value.length,
    ]);
    expect(sel1[0]).toBe(0);
    expect(sel1[1]).toBe(sel1[2]);

    // 4) Answer (b), email failed; the clipboard is blocked.
    answers.push((r) =>
      r.fulfill({ status: 201, json: { user, emailSent: false, setupToken: TOKEN43 } }),
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = () =>
        Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    });
    await fill();
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /^Email could not be sent \(check the email settings\)\./ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(
      page.getByText(
        'Your browser blocked copying. The link is selected above: press Ctrl+C (Cmd+C on Mac).',
      ),
    ).toBeVisible();
    const sel2 = await link.evaluate((el: HTMLInputElement) => [
      el.selectionStart,
      el.selectionEnd,
      el.value.length,
      document.activeElement === el,
    ]);
    expect
      .soft(sel2[3], 'the invitation link field holds the focus after a blocked copy')
      .toBe(true);
    expect.soft(sel2[0], 'selectionStart').toBe(0);
    expect.soft(sel2[1], 'selectionEnd equals the length').toBe(sel2[2]);
    await ux.check('copy blocked', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);

    // 5) Answer (c), link only.
    answers.push((r) => r.fulfill({ status: 201, json: { user, setupToken: TOKEN43 } }));
    await fill();
    await page.getByRole('button', { name: 'Create user' }).click();
    const warn = page.getByRole('status').filter({ hasText: /^Copy this link and send it to/ });
    await expect(warn).toBeVisible();
    await expect(warn).not.toContainText('Email could not be sent');
    // 6) Answer (d), duplicate.
    answers.push((r) =>
      r.fulfill({
        status: 409,
        json: { message: 'An account with this email already exists', statusCode: 409 },
      }),
    );
    await fill();
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByRole('alert')).toHaveText('An account with this email already exists');
    await expect(link).toHaveCount(0);
  },
);

uat(
  'AD-03',
  'Reset password, Reset two-step and Disable ask first; no Reset password on your own row',
  { on: ['D', 'T'], langs: 'EN' },
  async ({ page, ux }) => {
    let accept = false;
    const dialogs = watchDialogs(page, () => accept);
    const seen = await mockApi(page, {
      me: ADMIN_ME,
      extra: (route, url) => {
        if (url.pathname === '/admin/users') return json(route, USER_LIST);
        if (/^\/admin\/users\/\w+\/(reset-password|mfa-reset|status)$/.test(url.pathname))
          return json(route, { ok: true });
        return false;
      },
    });
    await page.goto('/#/admin');
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();
    const cases: [string, string, RegExp, RegExp][] = [
      [
        'Reset password',
        USERS.recruiter.displayName,
        /reset-password$/,
        /signed out|temporary password/i,
      ],
      ['Reset two-step', USERS.viewer.displayName, /mfa-reset$/, /two-step/i],
      ['Disable', USERS.recruiter.displayName, /status$/, /cannot sign in|can.t sign in/i],
    ];
    for (const [action, who, path, effect] of cases) {
      const n0 = dialogs.length;
      const posts0 = calls(seen, 'POST', path).length;
      // 1)-2) Press, then Cancel.
      accept = false;
      await btn(page, action, who).click();
      await page.waitForTimeout(400);
      const inPage = await inPageConfirm(page).isVisible();
      const asked = dialogs.length > n0 || inPage;
      expect.soft(asked, `${action} on ${who} asks for confirmation first`).toBe(true);
      if (dialogs.length > n0) {
        expect.soft(dialogs.at(-1)!, `${action}: names the person`).toContain(who);
        expect.soft(dialogs.at(-1)!, `${action}: names the effect`).toMatch(effect);
      }
      if (inPage) await inPageConfirm(page).getByRole('button', { name: 'Cancel' }).click();
      expect
        .soft(calls(seen, 'POST', path).length - posts0, `${action}: Cancel sends no POST`)
        .toBe(0);
      // 4) Confirm: exactly one POST.
      accept = true;
      const posts1 = calls(seen, 'POST', path).length;
      await btn(page, action, who).click();
      if (await inPageConfirm(page).isVisible())
        await inPageConfirm(page)
          .getByRole('button')
          .filter({ hasNotText: 'Cancel' })
          .first()
          .click();
      await page.waitForTimeout(400);
      expect
        .soft(calls(seen, 'POST', path).length - posts1, `${action}: confirming sends one POST`)
        .toBe(1);
    }
    await ux.check('after actions', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    // 5) The admin's own row.
    const own = row(page, USERS.self.displayName);
    await expect
      .soft(own.getByRole('button', { name: 'Reset password' }), 'own row offers no Reset password')
      .toHaveCount(0);
    await expect
      .soft(own.getByRole('button', { name: 'Disable' }), 'own row offers no Disable')
      .toHaveCount(0);
  },
);

// ---------------------------------------------------------------- AI models

/** Answers the AI model routes; `state.active` is the active model id. */
async function mockAi(
  page: Page,
  over: {
    overview?: () => unknown;
    discover?: (key: string) => [number, unknown];
    test?: (id: string) => unknown;
    slow?: number;
  } = {},
) {
  return mockApi(page, {
    me: ADMIN_ME,
    extra: async (route, url) => {
      const p = url.pathname;
      const m = route.request().method();
      if (over.slow && m !== 'GET') await new Promise((r) => setTimeout(r, over.slow));
      if (p === '/admin/ai/catalog') return json(route, CATALOG);
      if (p === '/admin/ai' && m === 'GET')
        return json(route, over.overview ? over.overview() : { active: null, connections: [] });
      if (p === '/admin/ai/discover') {
        const key = (route.request().postDataJSON() as { apiKey: string }).apiKey;
        const [s, b] = over.discover ? over.discover(key) : [200, { live: false, models: [] }];
        return json(route, b, s);
      }
      if (/^\/admin\/ai\/models\/\w+\/test$/.test(p))
        return json(route, over.test ? over.test(p.split('/')[4]!) : { ok: true, ms: 100 });
      if (p === '/admin/ai/connections' && m === 'POST') return json(route, { id: CONN_ID }, 201);
      if (p.startsWith('/admin/ai/')) return json(route, { ok: true });
      return false;
    },
  });
}
const models = (n: number, prefix = 'live') =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    label: `${prefix} model ${i + 1}`,
  }));

uat(
  'AD-09',
  'Add a model in three steps',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    let added = false;
    const seen = await mockAi(page, {
      overview: () => (added ? aiOverview(null) : { active: null, connections: [] }),
      discover: (key) =>
        key === 'goodkey-123'
          ? [200, { live: true, models: models(15) }]
          : key === 'docskey-123'
            ? [200, { live: false, models: models(12, 'doc') }]
            : [400, { message: 'Key refused', statusCode: 400 }],
    });
    ux.allow(/400/);
    await page.goto('/#/admin/ai');
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Add a model' }) });
    await expect(card).toBeVisible();
    const company = sel(card, 'Company');
    const key = card.getByLabel(/^API key/);
    const load = card.getByRole('button', { name: /^Load all .* models$/ });
    // 1) Company change clears the model, key and options.
    await card.getByRole('checkbox').first().check();
    await key.fill('somekey-1');
    await company.selectOption({ label: 'Other AI' });
    await company.selectOption({ label: 'Fake AI' });
    await expect(key).toHaveValue('');
    await expect(card.getByRole('checkbox', { checked: true })).toHaveCount(0);
    // 2) The load button is disabled with its hint until the key has 8 characters.
    await expect(load).toBeDisabled();
    await expect(load).toHaveAttribute('title', 'Add the API key first (step 3)');
    await key.fill('short12');
    await expect(load).toBeDisabled();
    // 3) A good key loads 15 models.
    await key.fill('goodkey-123');
    await expect(load).toBeEnabled();
    await load.click();
    await expect(card.getByText('15 models available to this key.')).toBeVisible();
    await expect(
      card.getByText('All Fake AI models this key can use. Tick one or more.'),
    ).toBeVisible();
    // 4) The filter narrows the list; two ticks plus a typed id.
    const filter = card.getByLabel('Filter models');
    await expect(filter).toBeVisible();
    await filter.fill('model 1');
    const list = card.getByRole('list', { name: 'Models' });
    const n = await list.getByRole('listitem').count();
    expect(n).toBeLessThan(15);
    await list.getByRole('checkbox').nth(0).check();
    await list.getByRole('checkbox').nth(1).check();
    await card.getByLabel(/^Other model ID/).fill('my-model');
    // 5) The extra field.
    await sel(card, 'Region').selectOption({ label: 'West Europe' });
    await ux.check('form filled', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    // 6) Save.
    const save = card.getByRole('button', { name: 'Save company and model (3 models)' });
    await expect(save).toBeEnabled();
    added = true;
    await save.click();
    await expect(
      card.getByText(
        'Saved. Press "Test" on the model below, then "Use this" to make it the screening model.',
      ),
    ).toBeVisible();
    const post = calls(seen, 'POST', /^\/admin\/ai\/connections$/)[0]!.body as {
      company: string;
      apiKey: string;
      settings: object;
      models: { modelId: string; label: string }[];
    };
    expect(post.company).toBe('fake');
    expect(post.apiKey).toBe('goodkey-123');
    expect(post.settings).toEqual({ region: 'westeurope' });
    expect(post.models).toHaveLength(3);
    for (const m of post.models) expect(Object.keys(m).sort()).toEqual(['label', 'modelId']);
    expect(post.models.map((m) => m.modelId)).toContain('my-model');
    await expect(key).toHaveValue('');
    await expect(company.locator('option:checked')).toHaveText('Fake AI (key added)');
    // 8) The existing company: key hint and 'Save'.
    await expect(
      card.getByText('Key ending …ab12 is on file. Leave empty to keep it.'),
    ).toBeVisible();
    await expect(card.getByRole('button', { name: /^Save( \(|$)/ })).toBeVisible();
    // 7) Other Fake-like company keys: the documented list and a refused key (on 'Other AI', no key on file).
    await company.selectOption({ label: 'Other AI' });
    await key.fill('docskey-123');
    await load.click();
    await expect(
      card.getByRole('status').filter({ hasText: 'Showing the documented models.' }),
    ).toBeVisible();
    await key.fill('badkey-123');
    await load.click();
    await expect(card.getByRole('alert')).toHaveText('Key refused');
  },
);

uat(
  'AD-10',
  'Company card: Test, Use this, key and settings, Remove company',
  { on: ['D', 'T'], langs: 'EN' },
  async ({ page, ux }) => {
    let active: 'fake-1' | 'fake-2' = 'fake-1';
    let fake2ok = false;
    let accept = false;
    const dialogs = watchDialogs(page, () => accept);
    const seen = await mockAi(page, {
      overview: () => aiOverview(active),
      test: (id) =>
        id === M1
          ? { ok: true, ms: 420 }
          : fake2ok
            ? { ok: true, ms: 380 }
            : { ok: false, error: 'Model not found' },
      slow: 400,
    });
    await page.route('**/admin/ai/active', async (r) => {
      active = 'fake-2';
      await r.fulfill({ json: { ok: true } });
    });
    await page.goto('/#/admin/ai');
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Fake AI', exact: true }) });
    await expect(card).toBeVisible();
    await expect(card.getByText('key …ab12')).toBeVisible();
    const item = (m: string) => card.getByRole('listitem').filter({ hasText: m });
    // 1) Test fake-1: the result in the card, in view; buttons disabled while it runs.
    await item('fake-1').getByRole('button', { name: 'Test' }).click();
    await expect(item('fake-2').getByRole('button', { name: 'Use this' })).toBeDisabled();
    await expect(card.getByText('fake-1 works (420 ms).')).toBeInViewport();
    // 2) Use this on a failing fake-2: the reason, no PUT.
    await item('fake-2').getByRole('button', { name: 'Use this' }).click();
    await expect(card.getByRole('alert')).toHaveText(/Model not found/);
    expect(calls(seen, 'PUT', /^\/admin\/ai\/active$/)).toHaveLength(0);
    // 3) Now passing: test, then PUT {modelId}; the badge and the top notice move.
    fake2ok = true;
    await item('fake-2').getByRole('button', { name: 'Use this' }).click();
    await expect(item('fake-2').getByText('Active', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Screening uses Fake AI · fake-2.' }),
    ).toBeVisible();
    await ux.check('switched', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    // 4) Key and settings.
    await card.getByText('Key and settings').click();
    const save = card.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();
    await card.getByLabel(/^Replace API key/).fill('newkey-4567');
    await sel(card, 'Region').selectOption({ label: 'North Europe' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(card.getByText('Saved.', { exact: true })).toBeVisible();
    const put = seen.requests
      .filter((r) => r.method === 'PUT' && r.url === `/admin/ai/connections/${CONN_ID}`)
      .at(-1)!;
    expect(put.body).toEqual({ apiKey: 'newkey-4567', settings: { region: 'northeurope' } });
    // 5) Remove company: dismiss sends nothing, accept sends DELETE.
    accept = false;
    await card.getByRole('button', { name: 'Remove company' }).click();
    await page.waitForTimeout(300);
    expect(dialogs.at(-1)).toBe(
      'Remove Fake AI, its key and its models? If one of them is active, no model will be active until you choose another.',
    );
    expect(calls(seen, 'DELETE', /^\/admin\/ai\/connections\//)).toHaveLength(0);
    accept = true;
    await card.getByRole('button', { name: 'Remove company' }).click();
    await expect.poll(() => calls(seen, 'DELETE', /^\/admin\/ai\/connections\//).length).toBe(1);
  },
);

uat(
  'AD-11',
  'Removing a model, above all the active one, asks first',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    let removed = false;
    let accept = false;
    const dialogs = watchDialogs(page, () => accept);
    const seen = await mockAi(page, {
      overview: () =>
        removed
          ? {
              active: null,
              connections: [
                {
                  ...aiOverview(null).connections[0],
                  models: [aiOverview(null).connections[0]!.models[1]],
                },
              ],
            }
          : aiOverview('fake-1'),
    });
    let deletes = 0;
    await page.route(`**/admin/ai/models/${M1}`, async (r) => {
      // This route answers the DELETE itself, so the shared request log does not see it.
      if (r.request().method() === 'DELETE') deletes++;
      removed = true;
      await r.fulfill({ json: { ok: true } });
    });
    await page.goto('/#/admin/ai');
    const del = () => deletes;
    // 1)-2) Press 'Remove fake-1', Cancel.
    accept = false;
    await page.getByRole('button', { name: 'Remove fake-1' }).click();
    await page.waitForTimeout(500);
    const inPage = await inPageConfirm(page).isVisible();
    const asked = dialogs.length > 0 || inPage;
    expect.soft(asked, 'removing the active model asks for confirmation').toBe(true);
    if (dialogs.length) expect.soft(dialogs[0]!).toMatch(/no model will be active/i);
    if (inPage) await inPageConfirm(page).getByRole('button', { name: 'Cancel' }).click();
    expect.soft(del(), 'Cancel sends no DELETE').toBe(0);
    // 3) Confirm.
    if (del() === 0) {
      accept = true;
      await page.getByRole('button', { name: 'Remove fake-1' }).click();
      if (await inPageConfirm(page).isVisible())
        await inPageConfirm(page)
          .getByRole('button')
          .filter({ hasNotText: 'Cancel' })
          .first()
          .click();
    }
    await expect.poll(del).toBe(1);
    await expect(
      page.getByRole('status').filter({ hasText: /^No model is active\./ }),
    ).toBeVisible();
    await ux.check('removed', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  },
);

// ---------------------------------------------------------------- Data retention

async function mockRetention(
  page: Page,
  state: Record<string, unknown> = {},
  opts: { put?: (b: { days?: number }) => [number, unknown] } = {},
) {
  return mockApi(page, {
    me: ADMIN_ME,
    extra: async (route, url) => {
      const p = url.pathname;
      const m = route.request().method();
      if (p === '/admin/retention' && m === 'GET') return json(route, retention(state));
      if (p === '/admin/retention' && m === 'PUT') {
        const [s, b] = opts.put ? opts.put(route.request().postDataJSON()) : [200, { ok: true }];
        return json(route, b, s);
      }
      if (p === '/admin/retention/run') {
        const dry = (route.request().postDataJSON() as { dryRun: boolean }).dryRun;
        return json(route, {
          documents: 3,
          heldBack: 1,
          dryRun: dry,
          certificateId: dry ? null : '01K0000000000000000000CERT',
        });
      }
      if (/^\/admin\/vacancies\/\w+\/legal-hold$/.test(p)) return json(route, { ok: true });
      return false;
    },
  });
}

uat(
  'AD-17',
  'Data retention: period, preview, legal hold and certificates',
  { on: ['D', 'T', 'A', 'I'], langs: 'EN', timeout: 45_000 },
  async ({ page, ux, meta, browser }) => {
    // 1) Delayed, then failing, then normal.
    {
      const ctx = await browser.newContext({
        baseURL: new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:4310' : page.url())
          .origin,
        viewport: page.viewportSize()!,
      });
      const p = await ctx.newPage();
      const flush = ux.watch(p);
      ux.allow(/500/);
      await mockApi(p, {
        me: ADMIN_ME,
        extra: async (route, url) => {
          if (url.pathname !== '/admin/retention') return false;
          await new Promise((r) => setTimeout(r, 1000));
          return json(route, { message: 'Server error' }, 500);
        },
      });
      await p.goto('/#/admin/retention');
      await expect(p.getByText('Loading…')).toBeVisible();
      await expect(p.getByRole('alert')).toBeVisible();
      await expect(p.getByRole('heading', { name: 'Retention period' })).toHaveCount(0);
      flush();
      await ctx.close();
    }
    const seen = await mockRetention(
      page,
      {},
      {
        put: (b) =>
          b.days !== undefined && (b.days < 30 || b.days > 3650)
            ? [400, { message: 'days must be between 30 and 3650', statusCode: 400 }]
            : [200, { ok: true }],
      },
    );
    ux.allow(/400/);
    await page.goto('/#/admin/retention');
    for (const h of ['Retention period', 'Legal hold', 'Deletion certificates'])
      await expect(page.getByRole('heading', { name: h })).toBeVisible();
    await expect(page.getByText('No purge has run yet.')).toBeVisible();
    await expect(
      page.getByText(
        'Right now: 3 file(s) older than 180 days and not on hold; 1 more on hold. The preview and the button use the saved period.',
      ),
    ).toBeVisible();
    await ux.check('retention', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    // 2) Days 29, empty, 3651, 30.
    await page.getByLabel('Erase automatically').check();
    const days = page.getByLabel(/^Keep CV files for/);
    const save = page.getByRole('button', { name: 'Save', exact: true });
    const puts = () => calls(seen, 'PUT', /^\/admin\/retention$/).map((r) => r.body);
    for (const [v, sent] of [
      ['29', 29],
      ['', 0],
      ['3651', 3651],
    ] as const) {
      await days.fill(v);
      await save.click();
      await expect(page.getByRole('alert')).toHaveText('days must be between 30 and 3650');
      expect(puts().at(-1)).toEqual({ enabled: true, days: sent });
    }
    await days.fill('30');
    await save.click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    // 3) Preview.
    await page.getByRole('button', { name: 'Preview what would be erased' }).click();
    await expect(
      page.getByText('Preview: 3 file(s) would be erased; 1 kept because of a legal hold.'),
    ).toBeVisible();
    expect(calls(seen, 'POST', /^\/admin\/retention\/run$/).at(-1)!.body).toEqual({ dryRun: true });
    // 4) Place hold: 3 characters or more.
    const matter = page.getByLabel('Matter reference for Network Engineer');
    const place = page
      .getByRole('row')
      .filter({ hasText: 'Network Engineer' })
      .getByRole('button', { name: 'Place hold' });
    await matter.fill('HR');
    await expect(place).toBeDisabled();
    await matter.fill('HR-7');
    await expect(place).toBeEnabled();
    await place.click();
    await expect.poll(() => calls(seen, 'PUT', /legal-hold$/).length).toBe(1);
    expect(calls(seen, 'PUT', /legal-hold$/)[0]!.body).toEqual({ hold: true, matter: 'HR-7' });
    // 5) Lift hold on Data Analyst.
    const da = page.getByRole('row').filter({ hasText: 'Data Analyst' });
    await expect(da.getByRole('cell').nth(2)).toHaveText(/^HR-2026-01 \(Admin Test, .+\)$/);
    await da.getByRole('button', { name: 'Lift hold' }).click();
    await expect.poll(() => calls(seen, 'PUT', /legal-hold$/).length).toBe(2);
    expect(calls(seen, 'PUT', /legal-hold$/)[1]!.body).toEqual({ hold: false });

    // 6) Two certificates, then 500 vacancies.
    const certs = [
      {
        id: '01K000000000000000000CERT1',
        runAt: '2026-11-01T03:00:00Z',
        trigger: 'schedule',
        days: 180,
        documents: 12,
        heldBack: 2,
        vacancies: 3,
        by: 'system',
      },
      {
        id: '01K000000000000000000CERT2',
        runAt: '2026-11-02T10:00:00Z',
        trigger: 'manual',
        days: 90,
        documents: 5,
        heldBack: 0,
        vacancies: 1,
        by: 'Admin Test',
      },
    ];
    const many = Array.from({ length: 500 }, (_, i) => ({
      ...RET_VACS[0]!,
      id: `01K0000000000000000000${String(i).padStart(4, '0')}`,
      title: `Vacancy ${i + 1}`,
    }));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockRetention(page, { certificates: certs, vacancies: many });
    const t0 = Date.now();
    await page.reload();
    await expect(
      page.getByRole('table', { name: 'Vacancies and legal hold' }).getByRole('row'),
    ).toHaveCount(501);
    expect(Date.now() - t0).toBeLessThan(2000 + 1500); // reload included
    const ct = page.getByRole('table', { name: 'Deletion certificates' });
    await expect(ct.getByRole('row').nth(1)).toContainText('Scheduled');
    await expect(ct.getByRole('row').nth(1)).toContainText('180 days');
    await expect(ct.getByRole('row').nth(1)).toContainText(certs[0]!.id);
    await expect(ct.getByRole('row').nth(2)).toContainText('Admin Test');
    await expect(ct.getByRole('row').nth(2)).toContainText('90 days');
    if (meta.dev === 'A' || meta.dev === 'I') {
      for (const name of ['Vacancies and legal hold', 'Deletion certificates']) {
        const box = page.getByRole('table', { name }).locator('xpath=..');
        const ox = await box.evaluate((el) => getComputedStyle(el).overflowX);
        expect.soft(ox, `${name}: the table scrolls inside its card`).toMatch(/auto|scroll/);
      }
    }
    expect.soft(await pageScrollsSideways(page), 'no sideways page scroll').toBe(false);
    await ux.check('certificates', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  },
);

uat(
  'AD-18',
  'Erase now: a real confirmation with Cancel; a double-click does not erase',
  { on: ['D', 'T'], langs: 'EN', timeout: 60_000 },
  async ({ page, ux }) => {
    const seen = await mockRetention(page);
    await page.goto('/#/admin/retention');
    const erase = page.getByRole('button', { name: 'Erase expired files now' });
    const wet = () =>
      calls(seen, 'POST', /^\/admin\/retention\/run$/).filter(
        (r) => (r.body as { dryRun: boolean }).dryRun === false,
      ).length;
    // 1) Double-click.
    const first = (await erase.boundingBox())!;
    await erase.dblclick();
    await page.waitForTimeout(500);
    expect.soft(wet(), 'a double-click sends no erase').toBe(0);
    if (wet() > 0) {
      // The armed button took the place of the first; the rest of the case cannot follow.
      return;
    }
    // 2) The confirmation: 3 files, cannot be undone, a Cancel, not in the spot of the first click.
    const confirmBtn = page
      .getByRole('button', { name: /erase now/i })
      .filter({ hasNotText: 'Erase expired files now' });
    await expect(page.getByText(/3 files/)).toBeVisible();
    await expect(page.getByText(/cannot be undone/)).toBeVisible();
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await expect.soft(cancel, 'a Cancel control').toBeVisible();
    const cb = await confirmBtn.boundingBox();
    expect
      .soft(
        cb && Math.abs(cb.x - first.x) < 4 && Math.abs(cb.y - first.y) < 4,
        'confirm button not where the first click was',
      )
      .toBe(false);
    await ux.check('armed', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
    // 3) Cancel.
    if (await cancel.isVisible()) {
      await cancel.click();
      await expect(erase).toBeVisible();
      expect(wet()).toBe(0);
    }
    // 4) Arm, wait 30 s: the armed state ends.
    await erase.click();
    await page.waitForTimeout(30_500);
    await expect.soft(erase, 'the armed state times out').toBeVisible();
    // 5) Confirm: one POST, the result.
    if (await erase.isVisible()) await erase.click();
    await confirmBtn.click();
    await expect(
      page.getByText('Done: 3 file(s) erased; 1 kept because of a legal hold.'),
    ).toBeVisible();
    expect(wet()).toBe(1);
    // 6) Due 0.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockRetention(page, { due: 0 });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Erase expired files now' })).toBeDisabled();
  },
);

for (const [id, title, on, langs] of [
  [
    'AD-04',
    "Row 'Copy invite link' copies the link and gives feedback at the row",
    ['D', 'A'],
    'EN',
  ],
  ['AD-07', 'Users: load error, empty list, long list, action error', ['D', 'A'], 'EN'],
  ['AD-08', 'AI models: status notice, empty and error states', ['D', 'T', 'A'], 'EN'],
  ['AD-13', 'Assistant tab opens and saves the basic settings', ['D', 'T', 'A'], 'EN'],
  [
    'AD-14',
    "Assistant: 'Test connection' keeps unsaved changes, including a model just added",
    ['D'],
    'EN',
  ],
  [
    'AD-15',
    'Fairness monitoring for admins: run the paired-CV test and read the results',
    ['D', 'T', 'A'],
    'EN+AZ',
  ],
  ['AD-16', 'Fairness monitoring for governance: read-only', ['D', 'A'], 'EN+AZ'],
  ['AD-20', 'Admin pages in Azerbaijani and on all four backgrounds', ['D', 'A'], 'EN+AZ'],
] as const)
  uat(id, title, { on: [...on], langs }, async () => {
    test.skip(true, 'Not built: P2/P3, outside the time budget of package B');
  });
