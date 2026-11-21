import type { Page } from '@playwright/test';
import { mockApi } from '../fixtures/api';
import { ADMIN_ANSWERS, openWith } from '../fixtures/pkg-a';
import {
  ADMIN_ME,
  aiOverview,
  calls,
  CATALOG,
  json,
  M1,
  M2,
  manyUsers,
  pageScrollsSideways,
  TOKEN43,
  USER_LIST,
  USERS,
} from '../fixtures/pkg-b';
import { expect, STD, uat } from '../ux/test';
import { T } from '../fixtures/pkg-h';

// 7.x Administration (AD), screen layer (L1, mocked API), second part: the cases that were left
// unbuilt in the first pass. All people, companies and keys are invented.

const sel = (scope: Page | import('@playwright/test').Locator, name: string) =>
  scope.locator(`label:has(> span:text-is("${name}")) select`);
const inViewport = async (page: Page, loc: import('@playwright/test').Locator) => {
  const b = await loc.boundingBox();
  const h = page.viewportSize()!.height;
  return !!b && b.y >= 0 && b.y + b.height <= h;
};

// ---------------------------------------------------------------- AD-04

uat(
  'AD-04',
  "Row 'Copy invite link' copies the link and gives feedback at the row",
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const users = [USERS.self, ...manyUsers(40)];
    const seen = await mockApi(page, {
      me: ADMIN_ME,
      extra: (route, url) => {
        if (url.pathname === '/admin/users' && route.request().method() === 'GET')
          return json(route, users);
        const m = /^\/admin\/users\/(\w+)\/setup-link$/.exec(url.pathname);
        if (m && route.request().method() === 'POST') {
          const u = users.find((x) => x.id === m[1])!;
          return json(route, {
            user: { id: u.id, email: u.email, displayName: u.displayName },
            setupToken: TOKEN43,
          });
        }
        return false;
      },
    });
    await page.goto('/#/admin');
    const table = page.getByRole('table', { name: 'Users' });
    await expect(table.getByRole('row')).toHaveCount(1 + users.length);
    // 1) The 35th row.
    const r = table.getByRole('row').filter({ hasText: 'person35@example.az' });
    await r.scrollIntoViewIfNeeded();
    const y0 = await page.evaluate(() => window.scrollY);
    expect(y0).toBeGreaterThan(300);
    await r.getByRole('button', { name: 'Copy invite link', exact: true }).click();
    // The admin is told first that the earlier link stops working, next to that row.
    const ask = page.getByRole('alertdialog', { name: 'New invite link' });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('Person 35');
    await expect(ask).toContainText('Their earlier link stops working');
    expect(await inViewport(page, ask)).toBe(true);
    expect(calls(seen, 'POST', /setup-link$/)).toHaveLength(0);
    await ask.getByRole('button', { name: 'Make a new link' }).click();
    // 2) The clipboard and the screen around the row.
    const link = page.getByLabel('Invitation link');
    const expected = `${new URL(page.url()).origin}/#/set-password?token=${TOKEN43}`;
    await expect(link).toHaveValue(expected);
    expect(calls(seen, 'POST', /\/admin\/users\/\w+\/setup-link$/)).toHaveLength(1);
    await expect(page.getByText('Link copied.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    expect(await inViewport(page, page.getByText('Link copied.'))).toBe(true);
    const y1 = await page.evaluate(() => window.scrollY);
    expect(Math.abs(y1 - y0), 'the page does not jump').toBeLessThan(200);
    await expect(page.getByRole('heading', { name: 'Add a user' })).not.toBeInViewport();
    await ux.check('invite link at the row');
    // Closing it leaves the table as it was.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(link).toHaveCount(0);
    // Cancel makes nothing.
    await r.getByRole('button', { name: 'Copy invite link', exact: true }).click();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toHaveCount(0);
    expect(calls(seen, 'POST', /setup-link$/)).toHaveLength(1);
  },
);

// ---------------------------------------------------------------- AD-07

uat(
  'AD-07',
  'Users: load error, empty list, long list, action error',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/500|409/);
    type H = (route: import('@playwright/test').Route, url: URL) => Promise<boolean> | boolean;
    const open = async (h: H) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      const seen = await mockApi(page, {
        me: ADMIN_ME,
        extra: (route, url) => (url.pathname.startsWith('/admin/users') ? h(route, url) : false),
      });
      await page.goto(`/?load=${Math.random().toString(36).slice(2)}#/admin`);
      return seen;
    };
    // Run 1: 500.
    await open((route) =>
      json(route, { message: 'The list could not be loaded', statusCode: 500 }, 500),
    );
    await expect(page.getByRole('alert')).toContainText('The list could not be loaded');
    await expect(page.getByRole('button', { name: 'Create user' })).toBeEnabled();
    await page.getByLabel('Email', { exact: true }).fill('new.person@example.az');
    await page.getByLabel('Name', { exact: true }).fill('New Person');
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('new.person@example.az');
    // Run 2: empty.
    await open((route) => json(route, []));
    await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible();
    const table = page.getByRole('table', { name: 'Users' });
    await expect(table.locator('thead th')).toHaveCount(6);
    await expect(table.getByRole('row')).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
    // Run 3: 300 users, rendered within 1 s, no sideways page scroll.
    const many = [USERS.self, ...manyUsers(299)];
    await open((route) => json(route, many));
    await expect(page.getByRole('table', { name: 'Users' }).getByRole('row')).toHaveCount(301);
    await page.evaluate(() => (location.hash = '#/admin/ai'));
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
    const t0 = Date.now();
    await page.evaluate(() => (location.hash = '#/admin'));
    await expect(page.getByRole('table', { name: 'Users' }).getByRole('row')).toHaveCount(301);
    expect.soft(Date.now() - t0, 'ms to render 300 rows').toBeLessThan(1000);
    expect(await pageScrollsSideways(page)).toBe(false);
    await ux.check('300 users');
    // Run 4: an action answers 409.
    const gets = { n: 0 };
    const seen4 = await open((route, url) => {
      if (url.pathname === '/admin/users' && route.request().method() === 'GET') {
        gets.n++;
        return json(route, USER_LIST);
      }
      if (url.pathname === '/admin/users' && route.request().method() === 'POST')
        return json(
          route,
          {
            user: { id: 'x', email: 'kenan.new@example.az', displayName: 'Kenan Aliyev' },
            emailSent: false,
            setupToken: TOKEN43,
          },
          201,
        );
      if (/reset-password$/.test(url.pathname))
        return json(route, { message: 'user is disabled', statusCode: 409 }, 409);
      return false;
    });
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('kenan.new@example.az');
    await page.getByLabel('Name', { exact: true }).fill('Kenan Aliyev');
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByLabel('Invitation link')).toBeVisible();
    const before = gets.n;
    await page
      .getByRole('row')
      .filter({ hasText: USERS.recruiter.displayName })
      .getByRole('button', { name: 'Reset password', exact: true })
      .click();
    await page
      .getByRole('alertdialog', { name: 'Reset password' })
      .getByRole('button', { name: 'Reset password' })
      .click();
    await expect(page.getByRole('alert')).toHaveText('user is disabled');
    await expect(page.getByLabel('Invitation link')).toHaveCount(0);
    await expect.poll(() => gets.n).toBeGreaterThan(before);
    expect(calls(seen4, 'POST', /reset-password$/)).toHaveLength(1);
  },
);

// ---------------------------------------------------------------- AD-08

uat(
  'AD-08',
  'AI models: status notice, empty and error states',
  { on: ['D', 'T', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/500/);
    const open = async (overview: unknown, catalog: unknown, status = 200) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await mockApi(page, {
        me: ADMIN_ME,
        extra: (route, url) => {
          if (url.pathname === '/admin/ai')
            return json(route, status === 200 ? overview : { message: 'Models are down' }, status);
          if (url.pathname === '/admin/ai/catalog')
            return json(route, status === 200 ? catalog : { message: 'Catalogue is down' }, status);
          return false;
        },
      });
      await page.goto(`/?load=${Math.random().toString(36).slice(2)}#/admin/ai`);
    };
    const keys = page.getByText(/^Each company needs one API key;/);
    // (a) nothing active, nothing added.
    await open({ active: null, connections: [] }, CATALOG);
    await expect(
      page.getByText(
        'No model is active. Choose a company, choose a model, add the API key, then press "Use this". Until then uploaded CVs wait in the queue.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a model' })).toBeVisible();
    await expect(keys).toBeVisible();
    await ux.check('no model active');
    // (b) one company, fake-1 active, fake-2 not.
    await open(aiOverview('fake-1'), CATALOG);
    await expect(
      page.getByText(
        'Screening uses Fake AI · fake-1. You can switch to any other model below at any time; each assessment records the model that produced it.',
      ),
    ).toBeVisible();
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Fake AI', exact: true }) });
    await expect(card.getByText('key …ab12')).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Models you can use' })).toBeVisible();
    const m1 = card.getByRole('listitem').filter({ hasText: 'fake-1' });
    const m2 = card.getByRole('listitem').filter({ hasText: 'fake-2' });
    await expect(m1.getByRole('button', { name: 'Test', exact: true })).toBeVisible();
    await expect(m1.getByText('Active', { exact: true })).toBeVisible();
    await expect(m1.getByRole('button', { name: 'Remove fake-1' })).toBeVisible();
    await expect(m2.getByRole('button', { name: 'Use this' })).toBeVisible();
    await expect(m2.getByRole('button', { name: 'Test', exact: true })).toBeVisible();
    await expect(m2.getByRole('button', { name: 'Remove fake-2' })).toBeVisible();
    await expect(keys).toBeVisible();
    // Cards: one column on the phone and the tablet, two from 1024 px.
    const cols = await page
      .locator('div.grid.lg\\:grid-cols-2')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    const w = await page.evaluate(() => window.innerWidth);
    expect(cols).toBe(w >= 1024 ? 2 : 1);
    await ux.check('model active');
    // (c) the catalogue is empty: no 'Add a model'.
    await open(aiOverview('fake-1'), { companies: [] });
    await expect(page.getByText(/^Screening uses Fake AI/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a model' })).toHaveCount(0);
    await expect(keys).toBeVisible();
    // (d) both answer 500.
    await open(null, null, 500);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(keys).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a model' })).toHaveCount(0);
    await ux.check('models error');
  },
);

// ---------------------------------------------------------------- AD-13, AD-14 (the Assistant tab)

type Json = Record<string, unknown>;
const OVERVIEW = (over: Json = {}, settings: Json = {}) => {
  const base = ADMIN_ANSWERS['GET /admin/assistant'] as Json;
  return {
    ...base,
    settings: {
      ...(base.settings as Json),
      enabled: false,
      name: 'SenAI',
      modelRowId: null,
      understandModelRowId: null,
      warnPct: 80,
      ...settings,
    },
    models: [
      { id: M1, modelId: 'fake-1', label: 'fake-1', provider: 'Fake AI' },
      { id: M2, modelId: 'fake-2', label: 'fake-2', provider: 'Fake AI' },
    ],
    activeModel: { provider: 'Fake AI', model: 'fake-1' },
    usage: { today: 3, month: 10 },
    warn: false,
    testFresh: false,
    log: [],
    ...over,
  };
};
const MONITORING = {
  days: 30,
  total: 12,
  refused: 1,
  readBy: { rules: 8, model: 4 },
  unknown: 1,
  safeMode: 0,
  byKind: [{ name: 'explain', n: 7 }],
  byIntent: [{ name: 'compare', n: 3 }],
  flags: [],
  breaker: { open: false, until: null },
};

/** The routes the Assistant tab calls besides its own overview. */
function assistantRoutes(over: {
  overview: (route: import('@playwright/test').Route) => Promise<boolean> | boolean;
}) {
  return async (route: import('@playwright/test').Route, url: URL) => {
    const p = url.pathname;
    if (p === '/admin/assistant' && route.request().method() === 'GET') return over.overview(route);
    if (p === '/admin/assistant/audit') return json(route, { turns: [] });
    if (p === '/admin/assistant/payloads') return json(route, { allowed: [], calls: [] });
    if (p === '/admin/assistant/monitoring') return json(route, MONITORING);
    if (p === '/admin/assistant/skills') return json(route, []);
    if (p === '/admin/ai') return json(route, { active: null, connections: [] });
    if (p === '/admin/ai/catalog') return json(route, CATALOG);
    return false;
  };
}

uat(
  'AD-13',
  'Assistant tab opens and saves the basic settings',
  { on: ['D', 'T', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/500|400/);
    let mode: 'slow' | 'error' | 'ok' | 'warn' = 'ok';
    let putAnswer: 'ok' | 'bad' = 'ok';
    const puts: unknown[] = [];
    const seen = await mockApi(page, {
      me: ADMIN_ME,
      extra: async (route, url) => {
        if (url.pathname === '/admin/assistant' && route.request().method() === 'PUT') {
          puts.push(route.request().postDataJSON());
          return putAnswer === 'ok'
            ? json(route, OVERVIEW({}, { enabled: true, name: 'Sena', modelRowId: M2 }))
            : json(route, { message: 'The name must be 3 to 30 characters', statusCode: 400 }, 400);
        }
        return assistantRoutes({
          overview: async (r) => {
            if (mode === 'slow') await new Promise((res) => setTimeout(res, 1000));
            if (mode === 'error')
              return json(r, { message: 'The assistant settings are down' }, 500);
            return json(r, OVERVIEW(mode === 'warn' ? { warn: true } : {}));
          },
        })(route, url);
      },
    });
    const load = async () => {
      await page.goto(`/?load=${Math.random().toString(36).slice(2)}#/admin/assistant`);
    };
    // 1) The delayed answer, the 500 and the normal answer.
    mode = 'slow';
    await load();
    await expect(page.getByText('Loading…').first()).toBeVisible();
    mode = 'error';
    await load();
    await expect(page.getByRole('alert')).toContainText('The assistant settings are down');
    await expect(page.getByRole('heading', { name: 'Assistant', exact: true })).toHaveCount(0);
    mode = 'ok';
    await load();
    await expect(
      page.getByText(
        'SenAI is off. Recruiters do not see it. It explains stored matches; it never scores, ranks or decides.',
      ),
    ).toBeVisible();
    for (const h of [
      'Assistant',
      'Functions',
      'Data terms',
      'Limits and usage',
      'Changes',
      'Recent answers (for review)',
      'How SenAI is doing',
      'Words the assistant knows',
      'What was sent to the model',
    ])
      await expect(page.getByRole('heading', { name: h, exact: true }), h).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add an API for SenAI' })).toBeVisible();
    await expect(page.getByText('Nothing yet.')).toBeVisible();
    await expect(page.getByText('No questions yet.')).toBeVisible();
    await expect(page.getByText('No words added yet.')).toBeVisible();
    await expect(page.getByText('No model call yet.')).toBeVisible();
    await expect(sel(page, 'Model').locator('option').first()).toHaveText(
      'Same as scoring (Fake AI · fake-1)',
    );
    await expect(
      sel(page, 'Faster model for reading questions (optional)').locator('option').first(),
    ).toHaveText('Same as the model above');
    await expect(page.getByText('Not tested in the last hour.')).toBeVisible();
    await ux.check('assistant tab');
    // 3) The period.
    await page.getByLabel('Period').selectOption({ label: 'Last 7 days' });
    await expect.poll(() => calls(seen, 'GET', /monitoring\?days=7$/).length).toBeGreaterThan(0);
    // 4) Save the basic settings.
    await page.getByLabel('Turn the assistant on').check();
    await page.getByLabel('Name (working name, can change any time)').fill('Sena');
    await sel(page, 'Model').selectOption(M2);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.getByText('Saved.', { exact: true });
    await expect(saved).toBeVisible();
    expect(await inViewport(page, saved)).toBe(true);
    await expect(page.getByText('Sena is on for recruiters.')).toBeVisible();
    const body = puts[0] as Json;
    expect(body).toMatchObject({ enabled: true, name: 'Sena', modelRowId: M2, attest: false });
    expect(body).not.toHaveProperty('attestedByName');
    expect(body).not.toHaveProperty('attestedAt');
    // 5) The server refuses.
    putAnswer = 'bad';
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('The name must be 3 to 30 characters');
    // 6) A limit has been passed.
    mode = 'warn';
    await load();
    await expect(page.getByText('Usage has passed 80% of a limit.')).toBeVisible();
  },
);

uat(
  'AD-14',
  "Assistant: 'Test connection' keeps unsaved changes, including a model just added",
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const M3 = '01K00000000000000000000MD3';
    let added = false;
    const puts: Json[] = [];
    const seen = await mockApi(page, {
      me: ADMIN_ME,
      extra: async (route, url) => {
        const m = route.request().method();
        if (url.pathname === '/admin/assistant/test' && m === 'POST')
          return json(route, { ok: true, detail: 'Passed (310 ms).' });
        if (url.pathname === '/admin/ai/connections' && m === 'POST') {
          added = true;
          return json(route, { id: 'c1' });
        }
        if (url.pathname === '/admin/assistant' && m === 'PUT') {
          puts.push(route.request().postDataJSON() as Json);
          return json(route, OVERVIEW());
        }
        return assistantRoutes({
          overview: (r) =>
            json(
              r,
              OVERVIEW(
                added
                  ? {
                      models: [
                        { id: M1, modelId: 'fake-1', label: 'fake-1', provider: 'Fake AI' },
                        { id: M2, modelId: 'fake-2', label: 'fake-2', provider: 'Fake AI' },
                        { id: M3, modelId: 'fake-3', label: 'fake-3', provider: 'Fake AI' },
                      ],
                    }
                  : {},
              ),
            ),
        })(route, url);
      },
    });
    await page.goto('/#/admin/assistant');
    const name = page.getByLabel('Name (working name, can change any time)');
    const model = sel(page, 'Model');
    await expect(name).toBeVisible();
    // 1-2) Unsaved: a new name and the second model; then 'Test connection'.
    await name.fill('Sena');
    await model.selectOption(M2);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Passed (310 ms).')).toBeVisible();
    expect(calls(seen, 'POST', /assistant\/test$/)[0]!.body).toEqual({ modelRowId: M2 });
    // 3) Still there; Save carries it.
    await expect(name).toHaveValue('Sena');
    await expect(model).toHaveValue(M2);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toMatchObject({ name: 'Sena', modelRowId: M2 });
    // 4) Add a model through 'Add an API for SenAI', follow its message.
    await name.fill('Sena 2');
    await page.locator('label:has(> span:text-is("API key")) input').fill('sk-fake-0001');
    await page.getByRole('checkbox', { name: /fake-3/ }).check();
    await page.getByRole('button', { name: /^Save company and model/ }).click();
    await expect(
      page.getByText(
        'Saved. It is now chosen as the model for the assistant above. Press "Test connection", then "Save".',
      ),
    ).toBeVisible();
    await expect(model).toHaveValue(M3);
    await expect(name).toHaveValue('Sena 2');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect.poll(() => calls(seen, 'POST', /assistant\/test$/).length).toBe(2);
    expect(calls(seen, 'POST', /assistant\/test$/)[1]!.body).toEqual({ modelRowId: M3 });
    await expect(model).toHaveValue(M3);
    await expect(name).toHaveValue('Sena 2');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => puts.length).toBe(2);
    expect(puts[1]).toMatchObject({ name: 'Sena 2', modelRowId: M3 });
    await ux.check('assistant after test');
  },
);

// ---------------------------------------------------------------- AD-15, AD-16 (monitoring)

const ARM = (arm: 'masked' | 'unmasked', differing: number, verdict: string) => ({
  arm,
  pairs: 12,
  differing,
  meanAbsDelta: differing ? 4 : 0,
  maxAbsDelta: differing ? 9 : 0,
  worst: differing ? { template: 'strong', variant: 'az_f', delta: 9 } : null,
  noise: differing ? 1 : 0,
  verdict,
});
const RUN = (over: Json = {}) => ({
  id: '01K0000000000000000000RUN2',
  state: 'done',
  startedAt: '2026-11-13T10:00:00Z',
  finishedAt: '2026-11-13T10:05:00Z',
  startedBy: 'Admin Test',
  progress: 48,
  total: 48,
  error: null,
  provider: 'Fake AI',
  model: 'fake-1',
  result: { summary: [ARM('masked', 0, 'consistent'), ARM('unmasked', 3, 'review')] },
  ...over,
});
const DESIGN = (ADMIN_ANSWERS['GET /admin/eval'] as Json).design;

uat(
  'AD-15',
  'Fairness monitoring for admins: run the paired-CV test and read the results',
  { on: ['D', 'T', 'A'], langs: 'EN+AZ', timeout: 120_000 },
  async ({ page, ux, meta }) => {
    ux.allow(/500/);
    const t = T(meta.lang);
    const evals: Json[] = [
      { runs: [], design: DESIGN },
      { runs: [RUN({ state: 'running', progress: 12, total: 48, result: null })], design: DESIGN },
      { runs: [RUN({ state: 'running', progress: 12, total: 48, result: null })], design: DESIGN },
      { runs: [RUN()], design: DESIGN },
    ];
    let evalCalls = 0;
    let started = false;
    let failedRun = false;
    let fairness: 'ok' | 'slow' | 'error' = 'ok';
    const seen = await mockApi(page, {
      me: ADMIN_ME,
      extra: async (route, url) => {
        const m = route.request().method();
        if (url.pathname === '/admin/fairness') {
          if (fairness === 'slow') await new Promise((r) => setTimeout(r, 1500));
          return fairness === 'error'
            ? json(route, { message: 'Figures are down', statusCode: 500 }, 500)
            : json(route, ADMIN_ANSWERS['GET /admin/fairness']);
        }
        if (url.pathname === '/admin/eval/paired' && m === 'POST') {
          started = true;
          return route.fulfill({ status: 202, json: {} }).then(() => true);
        }
        if (url.pathname === '/admin/eval') {
          if (failedRun)
            return json(route, {
              runs: [RUN({ state: 'failed', error: null, result: null })],
              design: DESIGN,
            });
          const i = started ? Math.min(1 + Math.max(0, evalCalls - 1), 3) : 0;
          if (started) evalCalls++;
          return json(route, evals[started ? i : 0]);
        }
        return false;
      },
    });
    await page.clock.install({ time: new Date('2026-11-13T10:00:00Z') });
    await page.goto(`/?load=${Math.random().toString(36).slice(2)}#/admin/monitoring`);
    // 1) The page.
    await expect(
      page.getByRole('heading', { level: 1, name: t('Fairness monitoring') }),
    ).toBeVisible();
    const tabs = page.getByRole('navigation', { name: t('Administration') });
    await expect(tabs.getByRole('link', { name: t('Fairness monitoring') })).toHaveClass(
      /bg-accent/,
    );
    await expect(page.getByRole('heading', { name: t('Paired-CV test') })).toBeVisible();
    for (const v of ['Base', 'Azerbaijani female name', 'Career break line'])
      await expect(page.getByText(new RegExp(`^${t(v)}:`))).toBeVisible();
    await expect(
      page.getByText(
        t(
          'Uses the active AI model: 48 short calls. Only synthetic CVs are used, never candidate data.',
        ),
      ),
    ).toBeVisible();
    // 2) Run the test.
    const run = page.getByRole('button', { name: t('Run the paired-CV test') });
    await run.click();
    expect(calls(seen, 'POST', /\/admin\/eval\/paired$/)).toHaveLength(1);
    const running = page.getByRole('button', { name: t('Running…') });
    await expect(running).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: /12/ })).toHaveText(
      t('{done} of {total} calls done', { done: 12, total: 48 }),
    );
    // 3) The poll every 4 s, stopping when done.
    const polls = () => calls(seen, 'GET', /^\/admin\/eval$/).length;
    const p0 = polls();
    await page.clock.runFor(4000);
    await expect.poll(polls).toBe(p0 + 1);
    await page.clock.runFor(4000);
    await expect.poll(polls).toBe(p0 + 2);
    await expect(page.getByRole('button', { name: t('Run the paired-CV test') })).toBeEnabled();
    const p1 = polls();
    await page.clock.runFor(12_000);
    expect(polls(), 'no polling once the run is done').toBe(p1);
    // 4) The result.
    const lastRun = page.locator('p').filter({ hasText: /Fake AI \/ fake-1/ });
    await expect(lastRun).toBeVisible();
    await expect(lastRun).toContainText('Admin Test');
    const arms = page.getByRole('table').first();
    await expect(arms.locator('thead th')).toHaveCount(5);
    await expect(arms.getByText(t('As the tool works (identity masked)'))).toBeVisible();
    await expect(arms.getByText(t('Without masking (for comparison)'))).toBeVisible();
    await expect(page.getByRole('heading', { name: t('Outcomes by group') })).toBeVisible();
    await expect(
      page.getByText(
        t('{files} files, {scored} scored, {unread} could not be read.', {
          files: 40,
          scored: 38,
          unread: 2,
        }),
      ),
    ).toBeVisible();
    const groups = page.getByRole('table').nth(1);
    await expect(groups.locator('thead th')).toHaveCount(9);
    await expect(page.getByText(t('No group is large enough to show yet.'))).toBeVisible();
    await expect(
      page.getByText(t('{n} files are in groups too small to show.', { n: 3 })),
    ).toBeVisible();
    if (meta.dev === 'A' || meta.dev === 'T')
      for (const tb of await page.getByRole('table').all())
        expect(
          await tb.evaluate((el) => el.parentElement!.scrollWidth >= el.parentElement!.clientWidth),
        ).toBe(true);
    expect(await pageScrollsSideways(page)).toBe(false);
    await ux.check('monitoring result', [...STD, 'AZ']);
    // 5) A failed run.
    failedRun = true;
    await page.goto(`/?load=${Math.random().toString(36).slice(2)}#/admin/monitoring`);
    await expect(page.getByText(t('The run failed.'))).toBeVisible();
    // 6) The figures are slow, then fail.
    failedRun = false;
    started = false;
    fairness = 'slow';
    await page.goto(`/?load=${Math.random().toString(36).slice(2)}#/admin/monitoring`);
    await expect(page.getByText(t('Loading…'))).toBeVisible();
    await page.clock.runFor(2000);
    fairness = 'error';
    await page.goto(`/?load=${Math.random().toString(36).slice(2)}#/admin/monitoring`);
    await expect(page.getByRole('alert')).toContainText('Figures are down');
  },
);

uat(
  'AD-16',
  'Fairness monitoring for governance: read-only',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const table = {
      'GET /admin/fairness': ADMIN_ANSWERS['GET /admin/fairness'],
      'GET /admin/eval': { runs: [RUN()], design: DESIGN },
      'GET /admin/assistant/audit': { turns: [] },
      'GET /admin/assistant/payloads': { allowed: [], calls: [] },
    };
    const seen = await openWith(page, '#/', {
      me: { roles: ['GOVERNANCE'] },
      table,
    });
    // 1-2) Home, then Monitoring.
    await page
      .getByRole('link', { name: new RegExp(t('Fairness monitoring')) })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: t('Fairness monitoring') }),
    ).toBeVisible();
    await expect(
      page
        .locator('main p')
        .filter({ hasText: /Admin Test/ })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole('table').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: t('Administration') })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('Run the paired-CV test') })).toHaveCount(0);
    await ux.check('governance monitoring', [...STD, 'AZ']);
    // 3) The administration pages.
    for (const hash of ['#/admin', '#/admin/ai', '#/admin/retention']) {
      await openWith(page, hash, { me: { roles: ['GOVERNANCE'] }, table });
      await expect(page.getByText(t('Administrators only.'))).toBeVisible();
    }
    // The assistant page: governance reads what was answered and sent, and changes nothing.
    await openWith(page, '#/admin/assistant', { me: { roles: ['GOVERNANCE'] }, table });
    await expect(
      page.getByRole('heading', { name: t('Recent answers (for review)') }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: t('What was sent to the model') }),
    ).toBeVisible();
    await expect(page.getByLabel(t('Turn the assistant on'))).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('Save'), exact: true })).toHaveCount(0);
    expect(seen.requests.filter((r) => r.method !== 'GET' && r.url !== '/me')).toHaveLength(0);
  },
);

// ---------------------------------------------------------------- AD-20

uat(
  'AD-20',
  'Admin pages in Azerbaijani and on all four backgrounds',
  { on: ['D', 'A'], langs: 'EN+AZ', timeout: 150_000 },
  async ({ page, ux, meta, context }) => {
    const t = T(meta.lang);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const table = {
      ...ADMIN_ANSWERS,
      'GET /admin/users': USER_LIST,
      'GET /admin/ai': aiOverview('fake-1'),
      'GET /admin/ai/catalog': CATALOG,
      'GET /admin/assistant': OVERVIEW(),
      'GET /admin/assistant/monitoring': MONITORING,
      'GET /admin/retention': {
        enabled: true,
        days: 90,
        due: 3,
        heldBack: 1,
        cutoff: '2026-08-15T00:00:00Z',
        certificates: [
          {
            id: '01K0000000000000000000CER1',
            runAt: '2026-11-12T03:00:00Z',
            trigger: 'schedule',
            days: 90,
            documents: 4,
            heldBack: 0,
            vacancies: 1,
            by: 'Scheduler',
          },
        ],
        vacancies: [
          {
            id: '01K00000000000000000000VA1',
            title: 'Network Engineer',
            legalHold: false,
            matter: null,
            since: null,
            by: null,
            documents: 4,
          },
          {
            id: '01K00000000000000000000VA2',
            title: 'Data Analyst',
            legalHold: true,
            matter: 'HR-2026-01',
            since: '2026-11-01T10:00:00Z',
            by: 'Admin Test',
            documents: 2,
          },
        ],
      },
    };
    const open = (hash: string) =>
      openWith(page, hash, {
        me: ADMIN_ME,
        table,
        extra: (route, url) =>
          /^\/admin\/users\/\w+\/setup-link$/.test(url.pathname)
            ? json(route, {
                user: {
                  id: USERS.recruiter.id,
                  email: USERS.recruiter.email,
                  displayName: USERS.recruiter.displayName,
                },
                setupToken: TOKEN43,
              })
            : false,
      });
    // 1-2) Every tab: the h1, the tab names, no English source text.
    await open('#/admin');
    await expect(page.getByRole('heading', { level: 1, name: t('Administration') })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: t('Administration') });
    await expect(tabs.getByRole('link')).toHaveText(
      ['Users', 'AI models', 'SenAI', 'Fairness monitoring', 'Data retention', 'Oracle import'].map(
        (x) => t(x),
      ),
    );
    // 'Link copied.' shown on Users.
    await page
      .getByRole('row')
      .filter({ hasText: USERS.recruiter.displayName })
      .getByRole('button', { name: t('Copy invite link'), exact: true })
      .click();
    await page
      .getByRole('alertdialog', { name: t('New invite link') })
      .getByRole('button', { name: t('Make a new link') })
      .click();
    await expect(page.getByText(t('Link copied.'))).toBeVisible();
    await ux.check('admin users', [...STD, 'AZ']);
    for (const hash of [
      '#/admin/ai',
      '#/admin/assistant',
      '#/admin/monitoring',
      '#/admin/retention',
    ]) {
      await open(hash);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForTimeout(500);
      await ux.check(`admin ${hash}`, [...STD, 'AZ']);
    }
  },
);
