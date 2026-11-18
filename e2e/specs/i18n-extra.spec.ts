import type { Page } from '@playwright/test';
import { DID, ME, MID, mockApi, openReview, showAnalysis } from '../fixtures/api';
import { ADMIN_ANSWERS, MFA_OFF, openWith } from '../fixtures/pkg-a';
import { batchApi, BVID, coffeebay, DVID, resultsApi, startBatch } from '../fixtures/pkg-d';
import { ulidOf } from '../fixtures/files';
import { vacApi, vrow, vview } from '../fixtures/pkg-c';
import { AZ } from '../../apps/web/src/i18n/az';
import { poolApi } from '../fixtures/pkg-e';
import { CFG, senaiRoutes, threadPair } from '../fixtures/pkg-g';
import { T } from '../fixtures/pkg-h';
import { bottomBar, fits, headerOverlaps, recruiterApp } from '../fixtures/pkg-i18n';
import { expect, STD, uat } from '../ux/test';

// 7.x Language (I18), layer L1, the screens-and-wording rows I18-08, I18-09 and I18-10.

const ADMIN_ME = { roles: ['ADMIN', 'TA_PARTNER'] };

// ---------------------------------------------------------------- I18-08

type Scene = {
  name: string;
  /** Opens the screen (a fresh mock and a full load). */
  open: (page: Page, t: ReturnType<typeof T>) => Promise<void>;
  /** A panel that is a bottom sheet on phones: what it covers is covered on purpose. */
  sheet?: boolean;
  bar?: boolean;
};

/** The pool panel with an answer: the Ask bar on wide screens, the bottom bar's item on phones. */
async function openPoolWithAnswer(page: Page) {
  await recruiterApp(page);
  await page.goto('/?p=1#/vacancies');
  const ask = page.getByRole('search').getByRole('textbox');
  const phoneAsk = page.getByRole('navigation').last().getByRole('button').last();
  await expect(ask.or(phoneAsk).first()).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'SenAI' });
  if (await ask.isVisible()) {
    await ask.fill('Who has BGP routing?');
    await ask.press('Enter');
  } else {
    await phoneAsk.click();
    const comp = panel.getByRole('textbox').last();
    await comp.fill('Who has BGP routing?');
    await comp.press('Enter');
  }
  await expect(panel.locator('[data-answer]')).toBeVisible();
}

const ADMIN_TABLE = {
  ...ADMIN_ANSWERS,
  'GET /auth/mfa': MFA_OFF,
  'GET /reports/mine': { reports: [] },
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

const SCENES: Scene[] = [
  {
    name: 'vacancies, header and bottom bar',
    bar: true,
    open: async (page) => {
      await recruiterApp(page);
      await page.goto('/?v=1#/vacancies');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'candidates with a selection',
    bar: true,
    open: async (page, t) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await poolApi(page, { assistant: CFG });
      await page.goto('/?c=1#/candidates');
      await expect(page.getByText('Aysel Məmmədova').first()).toBeVisible();
      await page
        .getByRole('checkbox', { name: t('Select {name}', { name: 'Aysel Məmmədova' }) })
        .check();
      await page
        .getByRole('checkbox', { name: t('Select {name}', { name: 'Rauf Əliyev' }) })
        .check();
      await expect(page.getByRole('region', { name: t('Selected candidates') })).toBeVisible();
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'pool panel with an answer',
    sheet: true,
    open: openPoolWithAnswer,
  },
  {
    name: 'results',
    bar: true,
    open: async (page) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await resultsApi(page, { assistant: CFG, answers: { 'GET /assistant/conversations': [] } });
      await page.goto(`/?r=1#/vacancies/${DVID}/results`);
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'CV review',
    bar: true,
    open: async (page) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await mockApi(page, { assistant: CFG, extra: senaiRoutes({ asks: [], cand: [] }) });
      await openReview(page, DID);
      await expect(page.getByRole('heading', { name: 'Aysel Məmmədova' }).first()).toBeVisible();
      await showAnalysis(page);
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'candidate panel on the CV screen',
    sheet: true,
    open: async (page) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await mockApi(page, {
        assistant: CFG,
        extra: senaiRoutes({ asks: [], cand: [] }, { thread: { [MID]: threadPair(1) } }),
      });
      await openReview(page, DID);
      await page.evaluate((k) => localStorage.setItem(k, '1'), `cv-assistant-open:${ME.userId}`);
      await page.reload();
      await showAnalysis(page);
      await expect(page.getByRole('complementary', { name: 'SenAI' })).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  ...(['#/admin', '#/admin/ai', '#/admin/assistant', '#/admin/retention'] as const).map(
    (hash): Scene => ({
      name: `admin ${hash}`,
      open: async (page) => {
        await openWith(page, hash, { me: ADMIN_ME, assistant: CFG, table: ADMIN_TABLE });
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForTimeout(700);
      },
    }),
  ),
];

uat(
  'I18-08',
  'Long AZ labels fit on small screens',
  { on: ['A', 'I', 'T', 'DS'], timeout: 300_000 },
  async ({ page, ux, meta }) => {
    ux.allow(/404|Failed to load resource/);
    const t = T(meta.lang);
    const problems: string[] = [];
    const ask = t('Ask {name}', { name: 'SenAI' });

    const pass = async (tag: string) => {
      for (const s of SCENES.filter(
        (x) => !process.env.UAT_SCENE || x.name.includes(process.env.UAT_SCENE),
      )) {
        const where = `${tag} · ${s.name}`;
        // Each screen starts with the SenAI panel closed (an earlier screen may have left it open).
        await page
          .evaluate((k) => localStorage.removeItem(k), `cv-assistant-open:${ME.userId}`)
          .catch(() => undefined);
        await s.open(page, t);
        for (const f of await fits(page)) problems.push(`${where}: ${f}`);
        for (const o of await headerOverlaps(page)) problems.push(`${where}: header ${o}`);
        if (s.bar) {
          const bar = await bottomBar(page);
          if (bar) {
            // Phones: the three items fit the bar, in at most two lines, of one height.
            const hs = bar.items.map((i) => Math.round(i.height));
            if (bar.items.length !== 3)
              problems.push(`${where}: the bottom bar has ${bar.items.length} items, not 3`);
            if (Math.max(...hs) - Math.min(...hs) > 1)
              problems.push(
                `${where}: the bottom-bar items differ in height (${hs.join(', ')} px)`,
              );
            for (const i of bar.items) {
              if (i.lines > 2)
                problems.push(`${where}: '${i.label}' takes ${i.lines} lines in the bottom bar`);
              if (i.overflowX)
                problems.push(`${where}: '${i.label}' does not fit its bottom-bar item`);
            }
            for (let k = 1; k < bar.items.length; k++)
              if (bar.items[k]!.left < bar.items[k - 1]!.right - 1)
                problems.push(`${where}: bottom-bar items overlap`);
            if (!bar.items.some((i) => i.label.includes(ask)))
              problems.push(
                `${where}: the bottom bar has no '${ask}' item (${bar.items.map((i) => i.label).join(' | ')})`,
              );
          }
        }
        await ux.check(where, [...STD, 'AZ'], s.sheet ? { overlay: 'aside' } : undefined);
      }
    };

    // 1) The device's own screen.
    await pass(`${meta.dev}`);
    // 2) The narrowest phone the plan names: 360 px wide.
    await page.setViewportSize({ width: 360, height: 740 });
    await pass('360 px');
    expect.soft(problems, 'every label fits its box on a small screen').toEqual([]);
  },
);

// ---------------------------------------------------------------- I18-09

/** Bare (second person singular) imperatives: a word of the app's own that must be said in 'siz' form. */
const SINGULAR = [
  'aç',
  'at',
  'bağla',
  'bax',
  'çıxar',
  'dayandır',
  'dincəl',
  'et',
  'get',
  'gəl',
  'gizlət',
  'gözlə',
  'götür',
  'göndər',
  'göstər',
  'keç',
  'kopyala',
  'köçür',
  'oxu',
  'paylaş',
  'saxla',
  'seç',
  'sil',
  'sına',
  'tap',
  'təkrarla',
  'təmizlə',
  'yarat',
  'yaz',
  'yenilə',
  'yoxla',
  'yüklə',
];

uat(
  'I18-09',
  'Consistent Azerbaijani terms and register',
  { on: ['D'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    ux.allow(/404|Failed to load resource/);
    const az = meta.lang === 'az';
    const t = T(meta.lang);
    const problems: string[] = [];
    const OPEN_STATE = az ? 'Açıq' : 'Open';
    const OPEN_VERB = az ? 'Açın' : 'Open';

    // 1) The vacancy list: 'Open' as a state (filter chip, badge) and as a command (row menu).
    let dup: { title?: string } | undefined;
    const V1 = ulidOf('V09', 1);
    await vacApi(page, {
      list: [
        vrow({ id: V1, title: 'Backend Engineer', status: 'open' }),
        vrow({ id: ulidOf('V09', 2), title: 'Radio Planner', status: 'draft' }),
      ],
      views: [vview({ id: V1, title: 'Backend Engineer' })],
      extra: async (route, url, method, body) => {
        if (method === 'POST' && /\/vacancies\/\w+\/duplicate$/.test(url.pathname)) {
          dup = body;
          return route.fulfill({ json: { id: ulidOf('V09', 3) } }).then(() => true);
        }
        return false;
      },
    });
    await page.goto('/#/vacancies');
    const chips = page.getByRole('group', { name: t('Status') }).getByRole('button');
    await expect(chips.first()).toBeVisible();
    expect
      .soft(await chips.allInnerTexts(), 'the status chips read as states')
      .toEqual(
        ['All', 'Draft', 'Open', 'On hold', 'Closed', 'Archived'].map((s) =>
          s === 'Open' ? OPEN_STATE : t(s),
        ),
      );
    const li = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'Backend Engineer', exact: true }) });
    const rowText = (await li.innerText()).replace(/\s+/g, ' ');
    expect.soft(rowText, `the row's status badge says '${OPEN_STATE}'`).toContain(OPEN_STATE);
    if (az) expect.soft(rowText, "the badge is not the command 'Açın'").not.toContain('Açın');
    await li.getByRole('group').or(li.locator('summary')).first().click();
    const menu = li.locator('details[open] > div');
    await expect(menu).toBeVisible();
    expect
      .soft(
        (await menu.getByRole('link').first().innerText()).trim(),
        'the menu item is the command',
      )
      .toBe(OPEN_VERB);
    await ux.check('vacancy list', [...STD, 'AZ']);
    await menu.getByRole('button', { name: t('Duplicate') }).click();
    await expect.poll(() => dup?.title).toBeTruthy();
    expect
      .soft(dup?.title, "the copy's title is in the screen's language")
      .toBe(az ? 'Backend Engineer (surət)' : 'Copy of Backend Engineer');

    // 2) Shortlist, on the screens that name it.
    const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const screens: [string, string][] = [];
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await poolApi(page, { assistant: CFG });
    await page.goto('/?c=1#/candidates');
    await expect(page.getByText('Aysel Məmmədova').first()).toBeVisible();
    screens.push(['Candidates', await bodyText()]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { assistant: CFG, answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/?r=1#/vacancies/${DVID}/results`);
    await page.waitForTimeout(900);
    screens.push(['Results', await bodyText()]);
    for (const [where, text] of screens) {
      if (az)
        expect
          .soft(text, `${where}: no English 'Shortlist' on an Azerbaijani screen`)
          .not.toMatch(/shortlist/i);
      else expect.soft(text, `${where}: the term is 'Shortlist'`).toMatch(/shortlist/i);
    }
    await ux.check('results', [...STD, 'AZ']);

    // 3) The wording itself: one term for Shortlist, one register ('siz') everywhere. The brand's
    //    approved slogan ('Sən istə, Senai tapsın') is the one line that speaks in 'sən'.
    const shortlist = Object.entries(AZ).filter(([k]) => /shortlist/i.test(k));
    expect(shortlist.length, 'the dictionary names Shortlist').toBeGreaterThan(5);
    for (const [k, v] of shortlist)
      if (!/qısa siyahı/i.test(v))
        problems.push(`Shortlist is not 'qısa siyahı' in "${k}": "${v}"`);
    const bare = new RegExp(`(^|[^\\p{L}])(${SINGULAR.join('|')})(?=[.!?…:,)]*$)`, 'iu');
    for (const [k, v] of Object.entries(AZ)) {
      if (/Sən istə/.test(v)) continue;
      if (/(^|[^\p{L}])(sən|səni|sənin|sənə|səndə|səndən|özünə|özünü)(?![\p{L}])/iu.test(v))
        problems.push(`"${k}" speaks in 'sən': "${v}"`);
      // A sentence that ends in a bare verb ('Göstər', 'Əlavə et') is a command to one person.
      for (const s of v.split(/(?<=[.!?])\s+/)) {
        const stripped = s
          .replace(/\{\w+\}/g, '')
          .replace(/[()…]/g, '')
          .trim();
        if (bare.test(stripped.replace(/\s*[:·].*$/, '')))
          problems.push(`"${k}" ends in a 'sən' command: "${v}"`);
      }
    }

    // 4) The waiting screen speaks in 'siz' too.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await batchApi(page, {
      files: 12,
      holdUploads: true,
      script: [{ received: 4, by: { analyzing: 4, not_sent: 8 } }],
    });
    await page.goto(`/#/vacancies/${BVID}`);
    await startBatch(page, meta.lang, 12);
    const cb = coffeebay(page);
    await expect(cb).toBeVisible();
    const cbText = (await cb.innerText()).replace(/\s+/g, ' ');
    if (az) {
      expect
        .soft(cbText, "the waiting screen has no 'sən' form")
        .not.toMatch(/(?<![\p{L}])(sən\p{L}*|özünə|çıxar|götür|dincəl|saxla)(?![\p{L}])/iu);
      expect.soft(cbText, "it greets in 'siz' form").toMatch(/götürün və dincəlin/);
    }
    await ux.check('waiting screen', [...STD, 'AZ']);
    expect.soft(problems, 'one term and one register').toEqual([]);
  },
);

// ---------------------------------------------------------------- I18-10

uat(
  'I18-10',
  'One name per place across the app',
  { on: ['D'], timeout: 150_000 },
  async ({ page, ux, meta }) => {
    ux.allow(/404|Failed to load resource/);
    const t = T(meta.lang);
    const problems: string[] = [];
    const ME2 = { roles: ['ADMIN', 'TA_PARTNER'] };
    let n = 0;
    const open = (hash: string, assistant: Record<string, unknown> = CFG) =>
      openWith(page, `${hash}`, { me: ME2, assistant, table: ADMIN_TABLE, extra: undefined });

    // 1) Each account-menu label is the heading of the page it leads to.
    await open('#/vacancies');
    await page.getByLabel(t('Account menu'), { exact: true }).click();
    const links = await page
      .locator('header details[open] > div')
      .getByRole('link')
      .evaluateAll((as) =>
        as.map((a) => ({
          text: (a as HTMLElement).innerText.trim(),
          href: a.getAttribute('href'),
        })),
      );
    expect(
      links.map((l) => l.text),
      'the account menu',
    ).toEqual(
      [
        'Shared with me',
        'Fairness monitoring',
        'Administration',
        'Change password',
        'Security',
      ].map((x) => t(x)),
    );
    await ux.check('account menu', [...STD, 'AZ'], { overlay: 'details[open] > div' });
    for (const l of links) {
      await open(l.href!);
      const h1 = page.getByRole('heading', { level: 1 }).first();
      await expect(h1).toBeVisible();
      const heading = (await h1.innerText()).trim();
      if (heading !== l.text)
        problems.push(`menu '${l.text}' leads to a page headed '${heading}' (${l.href})`);
      n++;
    }

    // 2) The Admin tabs: one per page, the assistant's tab carries its name (also when renamed).
    for (const name of ['SenAI', 'Elon']) {
      await open('#/admin', { ...CFG, name });
      const tabs = page.getByRole('navigation', { name: t('Administration') }).getByRole('link');
      await expect(tabs.first()).toBeVisible();
      const got = (await tabs.allInnerTexts()).map((x) => x.trim());
      const want = ['Users', 'AI models', name, 'Fairness monitoring', 'Data retention'].map((x) =>
        t(x),
      );
      if (JSON.stringify(got) !== JSON.stringify(want))
        problems.push(
          `Admin tabs for '${name}': ${JSON.stringify(got)}, not ${JSON.stringify(want)}`,
        );
    }
    await open('#/admin/monitoring');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('Fairness monitoring'));
    const monitoringBand = (
      await page
        .locator('th', { hasText: t('Strong or Good') })
        .first()
        .innerText()
    ).trim();

    // 3) Both SenAI panels: the same landmark name and heading, each with its own compliance line.
    await open('#/vacancies');
    const bar = page.getByRole('search').getByRole('textbox');
    await bar.click();
    await bar.press('Enter');
    const pool = page.getByRole('complementary', { name: 'SenAI' });
    await expect(pool).toBeVisible();
    const poolHead = (await pool.getByRole('heading', { level: 2 }).first().innerText()).trim();
    const poolLine = t('Chats are private to you and may be reviewed for compliance.');
    await expect(pool.getByText(poolLine)).toBeVisible();
    await expect(
      pool.getByText(t('Chats are saved to this run and may be reviewed for compliance.')),
    ).toHaveCount(0);
    await ux.check('pool panel', [...STD, 'AZ'], { overlay: 'aside' });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockApi(page, {
      me: ME2,
      assistant: CFG,
      extra: senaiRoutes({ asks: [], cand: [] }, { thread: { [MID]: threadPair(1) } }),
    });
    await openReview(page, DID);
    await page.evaluate((k) => localStorage.setItem(k, '1'), `cv-assistant-open:${ME.userId}`);
    await page.reload();
    await showAnalysis(page);
    const cand = page.getByRole('complementary', { name: 'SenAI' });
    await expect(cand).toBeVisible();
    const candHead = (await cand.getByRole('heading', { level: 2 }).first().innerText()).trim();
    await expect(
      cand.getByText(t('Chats are saved to this run and may be reviewed for compliance.')),
    ).toBeVisible();
    await expect(cand.getByText(poolLine)).toHaveCount(0);
    if (poolHead !== candHead || poolHead !== 'SenAI')
      problems.push(`panel headings differ: pool '${poolHead}', candidate '${candHead}'`);
    await ux.check('candidate panel', [...STD, 'AZ'], { overlay: 'aside' });

    // 4) Band names: Monitoring's column and Results' chips use the same four words.
    const sw = [t('Strong'), t('Good')];
    for (const w of sw)
      if (!monitoringBand.includes(w))
        problems.push(`Monitoring's band column '${monitoringBand}' does not use '${w}'`);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { assistant: CFG, answers: { 'GET /assistant/conversations': [] } });
    await page.goto(`/?r=${++n}#/vacancies/${DVID}/results`);
    await page.waitForTimeout(900);
    const results = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    for (const w of [...sw, t('Partial')])
      if (!results.includes(w)) problems.push(`Results does not show the band name '${w}'`);
    await ux.check('results', [...STD, 'AZ']);
    expect.soft(problems, 'one name per place').toEqual([]);
  },
);
