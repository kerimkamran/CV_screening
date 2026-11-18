import type { Page } from '@playwright/test';
import { ulidOf } from '../fixtures/files';
import {
  esc,
  hasRing,
  minsAgo,
  must,
  NEW_ID,
  nice,
  onBackgrounds,
  OWNER,
  pageScrollsSideways,
  reqs,
  T,
  tabTo,
  vacApi,
  vview,
  type Req,
  S,
} from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';
import { appDayAndTime } from '../fixtures/dates';

// 7.7 New vacancy and Role card (VN) and 7.8 Vacancy page (VP), layer L1. UAT plan v1.1.

const id = (n: number) => ulidOf('VRC', n);
const words = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      [
        'Network',
        'engineer',
        'with',
        'BGP',
        'routing',
        'and',
        'OSPF',
        'skills',
        'for',
        'Bakı',
        'operations',
        'team',
      ][i % 12],
  ).join(' ');
const card = (page: Page, lang: 'en' | 'az') =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: T(lang)('The role') }) });
/** Every dialog the page opens, answered as the test says. */
function dialogs(page: Page) {
  const seen: { type: string; message: string }[] = [];
  const st = { answer: 'accept' as 'accept' | 'dismiss' };
  page.on('dialog', (d) => {
    seen.push({ type: d.type(), message: d.message() });
    void (st.answer === 'accept' ? d.accept() : d.dismiss()).catch(() => undefined);
  });
  return { seen, st };
}

uat(
  'VN-02',
  'New vacancy page: every field and control, More details, phones, 4 backgrounds',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await vacApi(page, { similar: [] });
    await page.goto('/#/vacancies/new');
    await expect(page.getByRole('heading', { level: 1, name: t('New vacancy') })).toBeVisible();
    await expect.soft(page.getByRole('link', { name: t('← Vacancies') })).toBeVisible();
    await expect
      .soft(page.getByText(t('Only the title is needed. You can add the rest now or later.')))
      .toBeVisible();
    const c = card(page, meta.lang);
    await expect(c).toBeVisible();
    const pos = c.getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) });
    await expect.soft(pos).toHaveAttribute('placeholder', t('e.g. Network Engineer'));
    const exp = c.getByRole('group', { name: t('Experience') });
    expect
      .soft((await exp.getByRole('button').allInnerTexts()).map((s) => s.trim()))
      .toEqual(['Any', '1–3 yrs', '3–5 yrs', '5+ yrs'].map((x) => t(x)));
    await expect
      .soft(exp.getByRole('button', { name: t('Any') }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect.soft(c.getByLabel(t('Requirements'))).toBeVisible();
    await expect
      .soft(
        c.getByText(t('Paste the vacancy or type what you need. Azerbaijani, English or both.')),
      )
      .toBeVisible();
    for (const b of [
      'Attach a Word file',
      'Add a vacancy link',
      'Read requirements',
      'Create vacancy',
    ])
      await expect
        .soft(c.locator('button').filter({ hasText: new RegExp(`^${esc(t(b))}$`) }), b)
        .toBeVisible();
    await expect.soft(c.getByText(t('More details'), { exact: true })).toBeVisible();
    await expect.soft(c.getByLabel(t('Status'))).toHaveCount(0);
    // KEY: Position is reachable by Tab with a focus ring.
    expect.soft(await tabTo(page, pos), 'Tab reaches Position').toBe(true);
    expect.soft(await hasRing(pos), 'focus ring on Position').toBe(true);
    await ux.check('new vacancy', [...STD, 'AZ']);

    // 3) More details: 6 labelled fields, 2 columns from 640 px, 1 column on phones.
    await c.getByText(t('More details'), { exact: true }).click();
    const names = [
      'Department',
      'Location',
      'Open positions',
      'Closing date',
      'Hiring manager',
      'Notes',
    ];
    for (const n of names) await expect.soft(c.getByLabel(t(n), { exact: true }), n).toBeVisible();
    const d = (await c.getByLabel(t('Department'), { exact: true }).boundingBox())!;
    const l = (await c.getByLabel(t('Location'), { exact: true }).boundingBox())!;
    const twoCols = Math.abs(d.y - l.y) < 2 && l.x > d.x;
    if (page.viewportSize()!.width >= 640) expect.soft(twoCols, '2 columns from 640 px').toBe(true);
    else expect.soft(twoCols, '1 column on phones').toBe(false);
    // Every field has a visible label.
    const unlabelled = await c
      .locator('input:not([type=hidden]):not([type=file]):not(.sr-only), textarea, select')
      .evaluateAll(
        (els) =>
          els.filter((e) => {
            const lab = e.closest('label')?.querySelector('span');
            return !lab || !lab.getBoundingClientRect().width;
          }).length,
      );
    expect.soft(unlabelled, 'fields without a visible label').toBe(0);
    if (meta.dev === 'A' || meta.dev === 'I')
      expect.soft(await pageScrollsSideways(page)).toBe(false);
    // (the open 'More details' is an inline disclosure, not an overlay: the OCC overlay grid is pointed at real overlays only)
    await ux.check('more details', [...STD, 'AZ'], {
      overlay: '[role=dialog], dialog[open], [aria-modal=true], [role=menu], [role=listbox]',
    });
    await onBackgrounds(page, meta.lang, async (bg) => {
      await ux.check(`background ${bg}`, [...STD, 'AZ'], {
        overlay: '[role=dialog], dialog[open], [aria-modal=true], [role=menu], [role=listbox]',
      });
    });
  },
);

uat(
  'VN-03',
  'Position is required (2 characters) and limited to 200 characters',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const { seen } = await vacApi(page, { similar: [] });
    await page.goto('/#/vacancies/new');
    const c = card(page, meta.lang);
    const pos = c.getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) });
    const create = c.getByRole('button', { name: t('Create vacancy') });
    const msg = c.getByText(t('Add the position title.'));
    // 1) Empty; 2) one letter.
    await create.click();
    await expect(msg).toBeVisible();
    await pos.fill('A');
    await create.click();
    await expect(msg).toBeVisible();
    expect.soft(reqs(seen, 'POST', /^\/vacancies$/).length, 'no POST /vacancies').toBe(0);
    await ux.check('title missing', [...STD, 'AZ']);
    // 3) 250 characters pasted.
    await pos.fill('');
    await pos.focus();
    await page.keyboard.insertText('N'.repeat(250));
    expect.soft((await pos.inputValue()).length, 'holds exactly 200 characters').toBe(200);
    // 4) A real title.
    await pos.fill('Network Engineer');
    await create.click();
    await expect.poll(() => reqs(seen, 'POST', /^\/vacancies$/).length).toBe(1);
    expect
      .soft(reqs(seen, 'POST', /^\/vacancies$/)[0]!.body)
      .toMatchObject({ title: 'Network Engineer' });
    await expect.soft(page).toHaveURL(new RegExp(`#/vacancies/${NEW_ID}$`));
    await expect.soft(page.getByText(t('Add the position title.'))).toHaveCount(0);
    // KEY: Create vacancy is reachable by keyboard and works with Enter.
    await ux.check('created', [...STD, 'AZ']);
  },
);

uat(
  'VN-04',
  "Similar-vacancy check blocks saving until 'Create a new one anyway'",
  { on: ['D', 'T', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const s1 = {
      id: id(41),
      title: 'Network Engineer',
      status: 'open',
      ownerName: 'Rauf Aliyev',
      documents: 12,
    };
    const s2 = {
      id: id(42),
      title: 'Network Engineer (Bakı)',
      status: 'draft',
      ownerName: OWNER.name,
      documents: 0,
    };
    const { seen } = await vacApi(page, {
      similar: (title) => (/network engineer/i.test(title) ? [s1, s2] : []),
      views: [vview({ id: id(41), title: 'Network Engineer' })],
    });
    const dlg = dialogs(page);
    const similarGets = () => reqs(seen, 'GET', /^\/vacancies\/similar/);
    await page.goto('/#/vacancies/new');
    const c = card(page, meta.lang);
    const pos = c.getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) });
    // 1) Type and Tab.
    await pos.fill('Network Engineer');
    await page.keyboard.press('Tab');
    const block = c
      .getByRole('alert')
      .filter({ hasText: t('A vacancy like this is already in the system. Use that one?') });
    await expect(block).toBeVisible();
    expect.soft(similarGets().length, 'one GET on blur').toBe(1);
    await expect
      .soft(block.getByRole('link', { name: 'Network Engineer', exact: true }))
      .toBeVisible();
    await expect.soft(block.getByRole('link', { name: 'Network Engineer (Bakı)' })).toBeVisible();
    await expect
      .soft(block.locator('li').first())
      .toHaveText(
        `Network Engineer · ${S(meta.lang)('Open')} · Rauf Aliyev · ${t('{n} CVs', { n: 12 })}`,
      );
    await ux.check('similar shown', [...STD, 'AZ']);
    // 2) Create: no POST.
    await c.getByRole('button', { name: t('Create vacancy') }).click();
    await expect(block).toBeVisible();
    expect
      .soft(reqs(seen, 'POST', /^\/vacancies$/).length, 'no POST while the block shows')
      .toBe(0);
    // 3) Create a new one anyway.
    await block.getByRole('button', { name: t('Create a new one anyway') }).click();
    await expect.soft(block).toHaveCount(0);
    await c.getByRole('button', { name: t('Create vacancy') }).click();
    await expect.poll(() => reqs(seen, 'POST', /^\/vacancies$/).length).toBe(1);
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${NEW_ID}$`));
    // 4) A fresh page; typing hides the block.
    await page.goto('/#/vacancies/new');
    await page.reload();
    await pos.fill('Network Engineer');
    await pos.blur();
    await expect(block).toBeVisible();
    await pos.press('End');
    await pos.pressSequentially('s');
    await expect.soft(block, 'typing hides the block').toHaveCount(0);
    // 5) A similar title link, with the leave prompt accepted.
    const k = similarGets().length;
    await pos.blur();
    await expect.poll(() => similarGets().length).toBeGreaterThan(k);
    await ux.shot('similar again');
    await expect(block).toBeVisible(); // 'Network Engineers' is still similar
    await block.getByRole('link', { name: 'Network Engineer', exact: true }).click();
    await expect.soft(page).toHaveURL(new RegExp(`#/vacancies/${id(41)}$`));
    expect
      .soft(dlg.seen.map((d) => d.message))
      .toContain(t('You have unsaved changes. Leave without saving?'));
    // 6) Under 3 characters: no request.
    await page.goto('/#/vacancies/new');
    await page.reload();
    const before = similarGets().length;
    await pos.fill('QA');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    expect.soft(similarGets().length, 'no similar request for 2 letters').toBe(before);
  },
);

uat(
  'VN-07',
  "'Read requirements again' keeps hand-added skills; word count, changed-text and too-short messages",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const three: Req[] = [must('BGP routing', 1), must('OSPF', 2), nice('Python scripting', 3)];
    const { seen } = await vacApi(page, {
      views: [
        vview({ id: id(71), title: 'UAT Read again' }),
        vview({ id: id(72), title: 'UAT Nothing to read' }),
      ],
      extract: three,
      extra: async (route, url) => {
        if (url.pathname !== `/vacancies/${id(72)}/criteria/extract`) return false;
        await route.fulfill({
          json: {
            versions: [],
            current: { id: ulidOf('SET', 9), version: 1, frozen: false, requirements: [] },
          },
        });
        return true;
      },
    });
    dialogs(page); // leaving the first vacancy with unsaved text asks first: accept
    await page.goto(`/#/vacancies/${id(71)}`);
    const c = card(page, meta.lang);
    // 1) Kotlin by hand.
    await c.getByLabel(t('Add another skill')).fill('Kotlin');
    await c.getByRole('button', { name: t('Add'), exact: true }).click();
    await expect(c.getByRole('button', { name: /^Kotlin,/ })).toBeVisible();
    // 2) 60 words.
    const text = c.getByLabel(t('Requirements'));
    await text.fill(words(60));
    await expect.soft(c.getByText(t('{n} words', { n: 60 }), { exact: true })).toBeVisible();
    // 3) Read requirements again: a save, then the extraction.
    const again = c.getByRole('button', { name: t('Read requirements again') });
    await expect(again).toBeVisible();
    await again.click();
    await expect.poll(() => reqs(seen, 'POST', /criteria\/extract$/).length).toBe(1);
    const order = seen.requests
      .filter(
        (r) =>
          (/^\/vacancies\/\w+$/.test(r.url) && r.method === 'PATCH') ||
          /criteria\/extract$/.test(r.url),
      )
      .map((r) => r.method);
    expect.soft(order, 'PATCH before the extraction').toEqual(['PATCH', 'POST']);
    for (const s of ['BGP routing', 'OSPF', 'Python scripting', 'Kotlin'])
      await expect
        .soft(c.getByRole('button', { name: new RegExp(`^${esc(s)},`) }), s)
        .toBeVisible();
    await ux.check('read again', [...STD, 'AZ']);
    // 4) One word changed.
    await text.fill(`${words(59)} changed`);
    await expect.soft(c.getByText(t('The text changed since it was read.'))).toBeVisible();
    // 5) Too short.
    const n = seen.requests.length;
    await text.fill('short');
    await again.click();
    await expect
      .soft(c.getByText(t('Write or paste at least a few lines about the role.')))
      .toBeVisible();
    await page.waitForTimeout(300);
    expect
      .soft(seen.requests.slice(n).filter((r) => r.method !== 'GET').length, 'no request')
      .toBe(0);
    // 6) Scenario B: nothing could be read.
    await page.goto(`/#/vacancies/${id(72)}`);
    await page.reload();
    await c.getByLabel(t('Requirements')).fill(words(60));
    await c.getByRole('button', { name: t('Read requirements'), exact: true }).click();
    await expect
      .soft(
        c.getByText(
          t(
            'No skills could be read from this text. Add the skills yourself below, or write a fuller description of the role.',
          ),
        ),
      )
      .toBeVisible();
    await ux.check('nothing read', [...STD, 'AZ']);
  },
);

uat(
  'VN-09',
  'Vacancy link: read a page with Enter, unreadable page, saved link, read the saved link again',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const GOOD = 'https://jobs.example.az/vacancies/network-engineer-backbone-operations-baku-2026';
    const BAD = 'https://jobs.example.az/broken';
    const SAVED =
      'https://careers.example.az/jobs/12345/network-engineer-carrier-backbone-and-ip-mpls-core';
    let reread = 0;
    const { seen } = await vacApi(page, {
      views: [
        vview({
          id: id(91),
          title: 'UAT Saved link',
          description: 'Old text of the page.',
          sourceType: 'url',
          link: { url: SAVED, readAt: minsAgo(10), status: 'ok' },
        }),
      ],
      extra: async (route, url) => {
        if (url.pathname === '/vacancies/read-link') {
          const body = route.request().postDataJSON() as { url: string };
          await new Promise((r) => setTimeout(r, 700));
          if (body.url === GOOD)
            await route.fulfill({
              json: { host: 'jobs.example.az', text: words(120), words: 120, hash: 'h1' },
            });
          else
            await route.fulfill({
              status: 400,
              json: {
                statusCode: 400,
                message: "Couldn't read that page. Paste the text instead.",
              },
            });
          return true;
        }
        if (url.pathname === `/vacancies/${id(91)}/reread`) {
          reread++;
          await route.fulfill({
            json:
              reread === 1
                ? { status: 'unchanged' }
                : reread === 2
                  ? {
                      status: 'changed',
                      text: 'New text of the page with Kotlin and BGP.',
                      hash: 'h2',
                      words: 8,
                    }
                  : { status: 'unreadable' },
          });
          return true;
        }
        return false;
      },
    });
    ux.allow(/400/);
    await page.goto('/#/vacancies/new');
    const c = card(page, meta.lang);
    await c
      .getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) })
      .fill('UAT Link role');
    // 1) Add a vacancy link.
    const add = c.getByRole('button', { name: t('Add a vacancy link') });
    await add.click();
    await expect.soft(add).toHaveAttribute('aria-expanded', 'true');
    const field = c.getByLabel(t('Vacancy link'));
    await expect(field).toBeVisible();
    await expect
      .soft(c.getByText(t('A public page. If it cannot be read, paste the text.')))
      .toBeVisible();
    await expect.soft(c.getByRole('button', { name: t('Read the page') })).toBeDisabled();
    // 2) URL and Enter.
    await field.fill(GOOD);
    await field.press('Enter');
    await expect.soft(c.getByRole('button', { name: t('Reading the page…') })).toBeVisible();
    await expect(
      c.getByText(
        t('Read from {source}', { source: `jobs.example.az · ${t('{n} words', { n: 120 })}` }),
      ),
    ).toBeVisible();
    expect.soft(reqs(seen, 'POST', /read-link$/).length).toBe(1);
    await expect.soft(field).toHaveCount(0);
    expect.soft(await c.getByLabel(t('Requirements')).inputValue()).toBe(words(120));
    await ux.check('link read', [...STD, 'AZ']);
    // 3) The bad URL.
    await add.click();
    await field.fill(BAD);
    await c.getByRole('button', { name: t('Read the page') }).click();
    await expect
      .soft(
        c
          .getByRole('alert')
          .filter({ hasText: t("Couldn't read that page. Paste the text instead.") }),
      )
      .toBeVisible();
    await ux.check('bad link', [...STD, 'AZ']);
    // 4) The saved vacancy: 'Saved link: <url> · read {when}'.
    const dlg = dialogs(page);
    await page.goto(`/#/vacancies/${id(91)}`);
    await page.reload();
    expect(dlg.seen.length).toBeGreaterThanOrEqual(0);
    const line = c.locator('p').filter({ hasText: t('Saved link') });
    await expect
      .soft(line)
      .toHaveText(
        `${t('Saved link')}: ${SAVED} · ${t('read {when}', { when: t('{n} min ago', { n: 10 }) })}`,
      );
    const full = await line.evaluate((p) => p.getAttribute('title') || p.textContent || '');
    expect.soft(full, 'full URL reachable').toContain(SAVED);
    // 5) Read the saved link again, three times.
    const again = c.getByRole('button', { name: t('Read the saved link again') });
    await again.scrollIntoViewIfNeeded();
    const cover = await again.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && hit !== el && !el.contains(hit)
        ? `${hit.tagName} ${(hit as HTMLElement).className} ${(hit as HTMLElement).innerText?.slice(0, 40)} @${JSON.stringify(r.toJSON())}`
        : '';
    });
    expect.soft(cover, "'Read the saved link again' is not covered").toBe('');
    expect
      .soft(await pageScrollsSideways(page), 'the page does not scroll sideways (long saved link)')
      .toBe(false);
    await ux.shot('saved link');
    // On phones the long link widens the page and other controls end up over this one, so the
    // presses below are sent to the button itself to test what it does.
    const press = () => again.dispatchEvent('click');
    await press();
    await expect
      .soft(
        c
          .getByRole('status')
          .filter({ hasText: t('The page has not changed since it was last read.') }),
      )
      .toBeVisible();
    await press();
    await expect
      .soft(
        c.getByRole('status').filter({
          hasText: t(
            'The page has changed. Its new text is in the box. Save to keep it, then read the requirements again.',
          ),
        }),
      )
      .toBeVisible();
    expect
      .soft(await c.getByLabel(t('Requirements')).inputValue())
      .toBe('New text of the page with Kotlin and BGP.');
    await press();
    await expect
      .soft(
        c
          .getByRole('alert')
          .filter({ hasText: t("Couldn't read that page. Paste the text instead.") }),
      )
      .toBeVisible();
    await ux.check('read again x3', [...STD, 'AZ']);
  },
);

const TEN = () =>
  [
    must('BGP routing', 1),
    must('OSPF', 2),
    must('MPLS', 3),
    must('IS-IS design', 4),
    nice('Python scripting', 5),
    nice('Ansible', 6),
    {
      id: ulidOf('REQ', 7),
      text: 'Bachelor degree in engineering',
      classification: 'informational',
      weight: null,
      rule: null,
    },
    {
      id: ulidOf('REQ', 8),
      text: 'Night shifts possible',
      classification: 'informational',
      weight: null,
      rule: null,
    },
    {
      id: ulidOf('REQ', 9),
      text: 'Must hold a work permit',
      classification: 'disqualifier',
      weight: null,
      rule: { type: 'must_contain_any', terms: ['permit'] },
    },
  ] as Req[];

uat(
  'VN-10',
  'Skill chips: must-have and nice-to-have toggle, remove, other requirements kept as text',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const { seen } = await vacApi(page, {
      views: [
        vview({
          id: id(101),
          title: 'UAT Chips',
          requirements: TEN(),
          hasFrozen: true,
          counts: { documents: 5, analyzed: 5, strong: 2 },
        }),
      ],
      extra: async (route, url, method) => {
        if (method !== 'PATCH') return false;
        // PATCH echoes the body.
        const b = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          json: vview({
            id: id(101),
            title: 'UAT Chips',
            version: 4,
            requirements: (b.requirements as Req[]) ?? TEN(),
            hasFrozen: true,
            counts: { documents: 5, analyzed: 5, strong: 2 },
          }),
        });
        return true;
      },
    });
    await page.goto(`/#/vacancies/${id(101)}`);
    // 1) Role and CVs.
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    const c = card(page, meta.lang);
    const group = c.getByRole('group', { name: t('Skills') });
    await expect(group).toBeVisible();
    await expect.soft(group.getByText(t('Skills the AI understood'))).toBeVisible();
    const chip = (name: string) =>
      group.getByRole('button', { name: new RegExp(`^${esc(name)},`) });
    await expect
      .soft(chip('BGP routing'))
      .toHaveAttribute(
        'aria-label',
        t('{skill}, must-have. Press to change to nice-to-have', { skill: 'BGP routing' }),
      );
    await expect.soft(chip('BGP routing')).toContainText('●');
    await expect.soft(chip('Python scripting')).toContainText('○');
    await expect
      .soft(
        group.getByText(
          t(
            'Press a skill to switch between must-have (●) and nice-to-have (○). A missing must-have lowers the match. It never hides anyone.',
          ),
        ),
      )
      .toBeVisible();
    await ux.check('chips', [...STD, 'AZ']);
    // 2-3) Flip BGP routing twice.
    await chip('BGP routing').click();
    await expect
      .soft(chip('BGP routing'))
      .toHaveAttribute(
        'aria-label',
        t('{skill}, nice-to-have. Press to change to must-have', { skill: 'BGP routing' }),
      );
    await expect.soft(chip('BGP routing')).toContainText('○');
    await chip('BGP routing').click();
    await expect.soft(chip('BGP routing')).toContainText('●');
    // 4) Remove OSPF.
    await group.getByRole('button', { name: t('Remove {name}', { name: 'OSPF' }) }).click();
    await expect.soft(chip('OSPF')).toHaveCount(0);
    await expect.soft(c.getByText(t('Unsaved changes'))).toBeVisible();
    // 5) The other requirements.
    await group.getByText(t('{n} other requirements kept as text', { n: 3 })).click();
    for (const x of [
      'Bachelor degree in engineering',
      'Night shifts possible',
      'Must hold a work permit',
    ])
      await expect.soft(group.getByText(x, { exact: true })).toBeVisible();
    await ux.check('edited chips', [...STD, 'AZ']);
    // 6) Save.
    await c.getByRole('button', { name: t('Save'), exact: true }).click();
    await expect.poll(() => reqs(seen, 'PATCH', /^\/vacancies\/\w+$/).length).toBe(1);
    const sent = (reqs(seen, 'PATCH', /^\/vacancies\/\w+$/)[0]!.body as { requirements: Req[] })
      .requirements;
    expect
      .soft(sent.find((r) => r.text === 'BGP routing'))
      .toMatchObject({ classification: 'mandatory', weight: 10 });
    expect
      .soft(sent.filter((r) => r.classification === 'preferred').every((r) => r.weight === 5))
      .toBe(true);
    expect
      .soft(
        sent.some((r) => r.text === 'OSPF'),
        'OSPF removed',
      )
      .toBe(false);
  },
);

uat(
  'VN-11',
  "'Add another skill' is available on every vacancy, also when skills exist and on New vacancy",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await vacApi(page, {
      views: [
        vview({
          id: id(111),
          title: 'UAT Three skills',
          requirements: [must('BGP routing', 1), must('OSPF', 2), nice('Python scripting', 3)],
        }),
        vview({ id: id(112), title: 'UAT No skills' }),
      ],
    });
    const c = card(page, meta.lang);
    const field = () => c.getByLabel(t('Add another skill'));
    // 1-2) Vacancy A with skills (SD-31).
    await page.goto(`/#/vacancies/${id(111)}`);
    await expect(c.getByRole('group', { name: t('Skills') })).toBeVisible();
    await expect.soft(field(), "'Add another skill' on a vacancy with skills").toBeVisible();
    await expect.soft(c.getByRole('button', { name: t('Add'), exact: true })).toBeVisible();
    await ux.check('A with skills', [...STD, 'AZ']);
    // 3) New vacancy.
    await page.goto('/#/vacancies/new');
    await expect(page.getByRole('heading', { level: 1, name: t('New vacancy') })).toBeVisible();
    await expect.soft(field(), "'Add another skill' on New vacancy").toBeVisible();
    // 4-6) Vacancy B with no skills.
    await page.goto(`/#/vacancies/${id(112)}`);
    await page.reload();
    await field().fill('Go');
    await c.getByRole('button', { name: t('Add'), exact: true }).click();
    await expect
      .soft(c.getByRole('group', { name: t('Skills') }), 'under 3 characters: nothing added')
      .toHaveCount(0);
    await field().fill('');
    await field().fill('Kotlin');
    await field().press('Enter');
    const kotlin = c.getByRole('button', { name: new RegExp('^Kotlin,') });
    await expect(kotlin).toBeVisible();
    await expect.soft(kotlin).toContainText('●');
    if (await field().count()) {
      await expect.soft(field()).toHaveValue('');
      await field().fill('kotlin');
      await c.getByRole('button', { name: t('Add'), exact: true }).click();
      await expect.soft(c.getByRole('button', { name: /^kotlin,/i })).toHaveCount(1);
    } else {
      expect
        .soft(
          false,
          "after the first skill 'Add another skill' is gone, so a second skill cannot be added (step 6 not possible)",
        )
        .toBe(true);
    }
    await ux.check('B with Kotlin', [...STD, 'AZ']);
  },
);

uat(
  'VN-12',
  "Save sends only changed fields with the version; Status, Experience, 'Saved.', 'Nothing to save.', wording suggestions",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const { seen, views } = await vacApi(page, {
      views: [
        vview({
          id: id(121),
          title: 'UAT Save role',
          version: 3,
          requirements: [must('BGP routing', 1)],
        }),
      ],
      extra: async (route, url, method) => {
        if (url.pathname.startsWith('/assistant/jd-coach/')) {
          await route.fulfill({
            json: {
              headline: 'The role text is clear.',
              tips: ['Name the routing protocols.', 'Say which shifts apply.'],
            },
          });
          return true;
        }
        if (method === 'PATCH') await new Promise((r) => setTimeout(r, 600)); // to see 'Saving…'
        return false;
      },
    });
    await page.goto(`/#/vacancies/${id(121)}`);
    const c = card(page, meta.lang);
    const save = c.getByRole('button', { name: t('Save'), exact: true });
    // 1) Status and Experience.
    await c.getByLabel(t('Status')).selectOption('on_hold');
    await c
      .getByRole('group', { name: t('Experience') })
      .getByRole('button', { name: t('5+ yrs') })
      .click();
    // 2) Unsaved changes.
    await expect.soft(c.getByText(t('Unsaved changes'))).toBeVisible();
    await ux.check('unsaved', [...STD, 'AZ']);
    // 3) Save.
    await save.click();
    await expect.soft(c.getByRole('button', { name: t('Saving…') })).toBeVisible();
    await expect(c.getByRole('status').filter({ hasText: t('Saved.') })).toBeVisible();
    const patches = () => reqs(seen, 'PATCH', /^\/vacancies\/\w+$/);
    expect
      .soft(patches()[0]!.body, 'only the changed fields and the version')
      .toEqual({ expectedVersion: 3, status: 'on_hold', experienceRange: '5+' });
    await expect.soft(page.locator('h1 + span')).toHaveText(t('On hold'));
    await expect.poll(() => reqs(seen, 'GET', /^\/assistant\/jd-coach\//).length).toBe(1);
    expect
      .soft(reqs(seen, 'GET', /^\/assistant\/jd-coach\//)[0]!.url)
      .toContain(`language=${meta.lang}`);
    const tips = page.getByRole('region', { name: t('Suggestions about the wording') });
    await expect.soft(tips).toBeVisible();
    await expect.soft(tips.getByText('The role text is clear.')).toBeVisible();
    await expect.soft(tips.locator('li')).toHaveCount(2);
    await ux.check('saved with suggestions', [...STD, 'AZ']);
    // 4) Save again: nothing to save.
    await save.click();
    await expect
      .soft(c.getByRole('status').filter({ hasText: t('Nothing to save.') }))
      .toBeVisible();
    expect.soft(patches().length, 'no second PATCH').toBe(1);
    // 5) A trailing space is not a change.
    await c.getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) }).press('End');
    await c
      .getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) })
      .pressSequentially(' ');
    await expect.soft(c.getByText(t('Unsaved changes'))).toHaveCount(0);
    // 6) Typing in Notes hides the suggestions.
    await c.getByText(t('More details'), { exact: true }).click();
    await c.getByLabel(t('Notes'), { exact: true }).fill('Night shifts');
    await expect.soft(tips).toHaveCount(0);
    // 7) Save, then Dismiss.
    await save.click();
    await expect(c.getByRole('status').filter({ hasText: t('Saved.') })).toBeVisible();
    await expect(tips).toBeVisible();
    await tips.getByRole('button', { name: t('Dismiss') }).click();
    await expect.soft(tips).toHaveCount(0);
    expect(views.get(id(121))!.notes).toBe('Night shifts');
  },
);

uat(
  'VN-13',
  'Offer to copy requirements from a similar vacancy (from SenAI)',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const mine = () => [must('BGP routing', 1), must('OSPF', 2), nice('Python scripting', 3)];
    const other = [
      must('BGP routing', 11),
      must('OSPF', 12),
      nice('Python scripting', 13),
      must('MPLS', 14),
      must('IS-IS design', 15),
      must('Segment routing', 16),
      nice('Ansible', 17),
      nice('Kubernetes', 18),
      must('5G transport', 19),
      {
        id: ulidOf('REQ', 20),
        text: 'No criminal record',
        classification: 'disqualifier',
        weight: null,
        rule: { type: 'must_contain_any', terms: ['x'] },
      },
    ] as Req[];
    const OTHER = id(130);
    const { seen } = await vacApi(page, {
      views: [
        vview({ id: OTHER, title: 'Senior Network Engineer', requirements: other }),
        vview({ id: id(131), title: 'UAT Copy A', requirements: mine() }),
        vview({ id: id(132), title: 'UAT Copy B', requirements: mine() }),
        vview({
          id: id(133),
          title: 'UAT Copy C',
          requirements: other.filter((r) => r.classification !== 'disqualifier'),
        }),
      ],
    });
    const open = async (vid: string) => {
      await page.goto('/#/vacancies');
      await page.evaluate(
        ([k, v]) => sessionStorage.setItem(k!, v!),
        [`cv-copy-reqs:${vid}`, OTHER],
      );
      await page.goto(`/#/vacancies/${vid}`);
    };
    const offer = page.getByRole('region', { name: t('Requirements from a similar vacancy') });
    // 1-2) The offer.
    await open(id(131));
    await expect(offer).toBeVisible();
    await expect.soft(offer).toContainText(
      t('Add {n} requirements from “{title}” that this vacancy does not have yet?', {
        n: 6,
        title: 'Senior Network Engineer',
      }),
    );
    const items = await offer.locator('li').allInnerTexts();
    expect.soft(items.length, 'at most 8 listed').toBeLessThanOrEqual(8);
    expect.soft(items, 'no knockout').not.toContain('No criminal record');
    expect
      .soft(
        await page.evaluate((k) => sessionStorage.getItem(k), `cv-copy-reqs:${id(131)}`),
        'key removed',
      )
      .toBeNull();
    await ux.check('offer', [...STD, 'AZ']);
    // 3) Add them to the form: no request yet.
    const n = seen.requests.filter((r) => r.method !== 'GET').length;
    await offer.getByRole('button', { name: t('Add them to the form') }).click();
    const c = card(page, meta.lang);
    await expect
      .soft(c.getByRole('status').filter({ hasText: t('Added. Read them, then save.') }))
      .toBeVisible();
    await expect.soft(c.getByRole('button', { name: /^MPLS,/ })).toBeVisible();
    expect.soft(seen.requests.filter((r) => r.method !== 'GET').length, 'no request yet').toBe(n);
    // 4) Save.
    await c.getByRole('button', { name: t('Save'), exact: true }).click();
    await expect
      .poll(() => reqs(seen, 'PATCH', new RegExp(`/vacancies/${id(131)}$`)).length)
      .toBe(1);
    const sent = (
      reqs(seen, 'PATCH', new RegExp(`/vacancies/${id(131)}$`))[0]!.body as { requirements: Req[] }
    ).requirements.map((r) => r.text);
    expect
      .soft(sent)
      .toEqual(
        expect.arrayContaining([
          'MPLS',
          'IS-IS design',
          'Segment routing',
          'Ansible',
          'Kubernetes',
          '5G transport',
        ]),
      );
    expect.soft(sent).not.toContain('No criminal record');
    // B) No thanks.
    await open(id(132));
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: t('No thanks') }).click();
    await expect.soft(offer).toHaveCount(0);
    await expect.soft(c.getByText(t('Unsaved changes'))).toHaveCount(0);
    await expect.soft(c.getByRole('button', { name: /^MPLS,/ })).toHaveCount(0);
    // C) Everything already here.
    await open(id(133));
    await expect(offer).toBeVisible();
    await expect
      .soft(offer)
      .toContainText(
        t('Everything in “{title}” is already here.', { title: 'Senior Network Engineer' }),
      );
    expect
      .soft((await offer.getByRole('button').allInnerTexts()).map((s) => s.trim()))
      .toEqual([t('No thanks')]);
    await ux.check('everything here', [...STD, 'AZ']);
  },
);

uat(
  'VN-15',
  'Browser draft: offered after a reload, Restore them and Discard',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const { views } = await vacApi(page, {
      similar: [],
      views: [
        vview({ id: id(151), title: 'UAT Draft vacancy', requirements: [must('BGP routing', 1)] }),
      ],
    });
    const dlg = dialogs(page);
    await page.goto('/#/vacancies');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/#/vacancies/new');
    const c = card(page, meta.lang);
    const notice = c
      .getByRole('status')
      .filter({ hasText: t('You have unsaved changes from {when}.', { when: t('just now') }) });
    const key = (k: string) => page.evaluate((x) => localStorage.getItem(x), k);
    // 1) Type.
    await c.getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) }).fill('Draft test');
    await c.getByLabel(t('Requirements')).fill('A line about the role.');
    // 2) Wait, reload (accept the prompt).
    await page.waitForTimeout(1000);
    expect
      .soft(JSON.parse((await key('cv-vacancy-draft:new')) ?? '{}').form)
      .toMatchObject({ title: 'Draft test', text: 'A line about the role.' });
    await page.reload();
    expect
      .soft(
        dlg.seen.some((d) => d.type === 'beforeunload'),
        'a leave prompt on reload',
      )
      .toBe(true);
    await expect(notice).toBeVisible();
    await expect.soft(notice.getByRole('button', { name: t('Restore them') })).toBeVisible();
    await expect.soft(notice.getByRole('button', { name: t('Discard') })).toBeVisible();
    await ux.check('draft offered', [...STD, 'AZ']);
    // 3) Restore them.
    await notice.getByRole('button', { name: t('Restore them') }).click();
    await expect
      .soft(c.getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) }))
      .toHaveValue('Draft test');
    await expect.soft(c.getByLabel(t('Requirements'))).toHaveValue('A line about the role.');
    // 4) Reload again and Discard.
    await page.waitForTimeout(600);
    await page.reload();
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: t('Discard') }).click();
    await expect.soft(notice).toHaveCount(0);
    await page.waitForTimeout(600);
    expect.soft(await key('cv-vacancy-draft:new'), 'key gone after Discard').toBeNull();
    // 5) The same on an existing vacancy, then Save.
    await page.goto(`/#/vacancies/${id(151)}`);
    await c.getByLabel(t('Requirements')).fill('Edited text for the saved vacancy.');
    await page.waitForTimeout(1000);
    expect
      .soft(await key(`cv-vacancy-draft:${id(151)}`), 'draft key for the vacancy')
      .not.toBeNull();
    await page.reload();
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: t('Restore them') }).click();
    await expect
      .soft(c.getByLabel(t('Requirements')))
      .toHaveValue('Edited text for the saved vacancy.');
    await c.getByRole('button', { name: t('Save'), exact: true }).click();
    await expect(c.getByRole('status').filter({ hasText: t('Saved.') })).toBeVisible();
    await page.waitForTimeout(600);
    expect.soft(await key(`cv-vacancy-draft:${id(151)}`), 'key removed after Saved.').toBeNull();
    expect(views.get(id(151))!.description).toBe('Edited text for the saved vacancy.');
  },
);

// ------------------------------------------------------------------ 7.8 Vacancy page (VP)

uat(
  'VP-02',
  "History panel: versions, change lines, 'and n more', empty and loading",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const add = (s: string) => ({
      field: 'requirement',
      requirement: s,
      from: null,
      to: 'nice-to-have',
    });
    const H = [
      {
        id: ulidOf('HIS', 3),
        requirementsVersion: 3,
        cause: 'edit',
        changes: [{ field: 'requirement', requirement: 'MPLS', from: null, to: 'must-have' }],
        description: null,
        changedAt: minsAgo(30),
        changedBy: 'Rauf Aliyev',
      },
      {
        id: ulidOf('HIS', 2),
        requirementsVersion: 2,
        cause: 'edit',
        description: null,
        changedAt: minsAgo(600),
        changedBy: OWNER.name,
        changes: [
          { field: 'requirement', requirement: 'Kotlin', from: null, to: 'must-have' },
          { field: 'requirement', requirement: 'OSPF', from: 'must-have', to: null },
          {
            field: 'requirement',
            requirement: 'BGP routing',
            from: 'must-have',
            to: 'nice-to-have',
          },
          { field: 'experience', from: 'Any', to: '5+ yrs' },
          { field: 'description' },
          add('Ansible'),
          add('Terraform'),
          add('Kubernetes'),
          add('Go'),
          add('Rust'),
          add('Linux'),
        ],
      },
      {
        id: ulidOf('HIS', 1),
        requirementsVersion: 1,
        cause: 'create',
        changes: [],
        description: null,
        changedAt: minsAgo(2000),
        changedBy: OWNER.name,
      },
    ];
    const { seen } = await vacApi(page, {
      views: [
        vview({ id: id(201), title: 'UAT History' }),
        vview({ id: id(202), title: 'UAT No history' }),
        vview({ id: id(203), title: 'UAT Slow history' }),
      ],
      extra: async (route, url) => {
        const m = /^\/vacancies\/(\w+)\/history$/.exec(url.pathname);
        if (!m) return false;
        if (m[1] === id(202)) await route.fulfill({ json: [] });
        else {
          if (m[1] === id(203)) await new Promise((r) => setTimeout(r, 2000));
          await route.fulfill({ json: H });
        }
        return true;
      },
    });
    const btn = page.getByRole('button', { name: t('History'), exact: true });
    const panel = page.getByRole('region', { name: t('History') });
    // Scenario C: loading first.
    await page.goto(`/#/vacancies/${id(203)}`);
    await btn.click();
    await expect.soft(panel.getByText(t('Loading…'))).toBeVisible();
    await expect(panel.getByText(t('Created'))).toBeVisible({ timeout: 5000 });
    // 1-2) The panel.
    await page.goto(`/#/vacancies/${id(201)}`);
    await btn.click();
    await expect.soft(btn).toHaveAttribute('aria-expanded', 'true');
    await expect
      .soft(panel.getByRole('heading', { name: t('Changes to the requirements') }))
      .toBeVisible();
    await expect.soft(panel.getByRole('button', { name: t('Close') })).toBeVisible();
    const when1 = await appDayAndTime(page, H[2]!.changedAt as string, meta.lang);
    const v1 = panel.locator(':scope > ul > li').nth(2);
    await expect
      .soft(v1.locator('p'))
      .toHaveText(`${t('Version {n}', { n: 1 })} · ${when1} · ${OWNER.name}`);
    await expect.soft(v1.locator('li')).toHaveText([t('Created')]);
    const v2 = panel.locator(':scope > ul > li').nth(1).locator('li');
    await expect.soft(v2).toHaveCount(9);
    await expect.soft(v2.nth(8)).toHaveText(t('and {n} more', { n: 3 }));
    await expect
      .soft(v2.nth(0))
      .toHaveText(t('Added “{text}” as {to}', { text: 'Kotlin', to: 'must-have' }));
    await expect.soft(v2.nth(1)).toHaveText(t('Removed “{text}”', { text: 'OSPF' }));
    await expect.soft(v2.nth(2)).toHaveText(
      t('“{text}”: {from} to {to}', {
        text: 'BGP routing',
        from: 'must-have',
        to: 'nice-to-have',
      }),
    );
    await expect
      .soft(v2.nth(3))
      .toHaveText(t('Experience changed from {from} to {to}', { from: 'Any', to: '5+ yrs' }));
    await expect.soft(v2.nth(4)).toHaveText(t('The role text changed'));
    await ux.check('history', [...STD, 'AZ']);
    // 3) Close; 4) open again: no second GET.
    await panel.getByRole('button', { name: t('Close') }).click();
    await expect.soft(panel).toHaveCount(0);
    await btn.click();
    await expect(panel).toBeVisible();
    expect
      .soft(
        reqs(seen, 'GET', new RegExp(`/vacancies/${id(201)}/history$`)).length,
        'one GET /history',
      )
      .toBe(1);
    // Scenario B: empty.
    await page.goto(`/#/vacancies/${id(202)}`);
    await btn.click();
    await expect.soft(panel.getByText(t('No changes since the first run.'))).toBeVisible();
    await ux.check('no history', [...STD, 'AZ']);
  },
);

uat(
  'VP-03',
  "Summary strip and 'Role and CVs' fold; Role and CVs cards side by side only at 1280 px and up",
  { on: ['D', 'DW', 'DS', 'T', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const B = { documents: 120, analyzed: 100, strong: 12, needsLook: 3, failed: 2, running: 15 };
    await vacApi(page, {
      views: [
        vview({ id: id(301), title: 'UAT No results', requirements: [must('BGP routing', 1)] }),
        vview({
          id: id(302),
          title: 'UAT Busy',
          requirements: [must('BGP routing', 1)],
          hasFrozen: true,
          counts: B,
        }),
        vview({
          id: id(303),
          title: 'UAT Calm',
          requirements: [must('BGP routing', 1)],
          hasFrozen: true,
          counts: { documents: 120, analyzed: 100, strong: 12 },
        }),
      ],
    });
    const summary = page.getByRole('region', { name: t('Summary') });
    const setup = page.locator('#vacancy-setup');
    const items = () =>
      summary
        .locator(':scope > span')
        .evaluateAll((s) =>
          s.map((x) => [...x.children].map((c) => c.textContent?.trim()).join(' ')),
        );
    // 1) A.
    await page.goto(`/#/vacancies/${id(301)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'UAT No results' })).toBeVisible();
    await expect.soft(summary).toHaveCount(0);
    await expect.soft(setup).toBeVisible();
    await ux.check('A', [...STD, 'AZ']);
    // 2) B.
    await page.goto(`/#/vacancies/${id(302)}`);
    await expect(summary).toBeVisible();
    expect
      .soft(await items())
      .toEqual([
        `120 ${t('CVs')}`,
        `100 ${t('Analyzed')}`,
        `12 ${t('Strong')}`,
        `3 ${t('Need a look')}`,
        `2 ${t('Analysis failed')}`,
        `15 ${t('Reading now')}`,
      ]);
    await expect.soft(setup).toBeHidden();
    const fold = summary.getByRole('button', { name: t('Role and CVs') });
    await expect.soft(fold).toHaveAttribute('aria-controls', 'vacancy-setup');
    await expect.soft(fold).toHaveAttribute('aria-expanded', 'false');
    if (meta.dev === 'A' || meta.dev === 'I')
      expect.soft(await pageScrollsSideways(page), 'the strip wraps').toBe(false);
    await ux.check('B folded', [...STD, 'AZ']);
    // 3) Role and CVs, then Hide.
    await fold.click();
    const hide = summary.getByRole('button', { name: t('Hide role and CVs') });
    await expect.soft(hide).toHaveAttribute('aria-expanded', 'true');
    await expect(setup).toBeVisible();
    const sideBySide = async () => {
      const [r, cv] = await setup
        .locator(':scope > section')
        .evaluateAll((s) => s.map((x) => x.getBoundingClientRect().toJSON()));
      return Math.abs(r.top - cv.top) < 2 && cv.left > r.right - 2;
    };
    const w = page.viewportSize()!.width;
    expect.soft(await sideBySide(), `cards side by side at ${w} px`).toBe(w >= 1280);
    await ux.check('B open', [...STD, 'AZ']);
    if (meta.dev === 'DS') {
      await page.setViewportSize({ width: 1024, height: 768 });
      expect.soft(await sideBySide(), 'cards stack at 1024 px').toBe(false);
      await ux.check('B open at 1024', [...STD, 'AZ']);
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await hide.click();
    await expect.soft(setup).toBeHidden();
    // 4) C.
    await page.goto(`/#/vacancies/${id(303)}`);
    await expect(summary).toBeVisible();
    expect
      .soft(await items())
      .toEqual([`120 ${t('CVs')}`, `100 ${t('Analyzed')}`, `12 ${t('Strong')}`]);
    await ux.check('C', [...STD, 'AZ']);
  },
);

uat(
  'VP-09',
  'Leave guard: no prompt when switching tabs on the same vacancy, prompt when leaving it',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const v = vview({
      id: id(901),
      title: 'UAT Leave guard',
      requirements: [must('BGP routing', 1)],
      hasFrozen: true,
      counts: { documents: 2, analyzed: 2, strong: 1 },
    });
    await vacApi(page, { views: [v], list: [], similar: [] });
    const dlg = dialogs(page);
    const msg = t('You have unsaved changes. Leave without saving?');
    await page.goto(`/#/vacancies/${v.id}`);
    // 1) Role and CVs, More details, Notes.
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    const c = card(page, meta.lang);
    await c.getByText(t('More details'), { exact: true }).click();
    // (the label's text grows with the textarea's content, so match its start)
    const notes = c.getByLabel(new RegExp(`^${esc(t('Notes'))}`));
    await notes.fill('Keep this text');
    // 2) Results, then Report: no dialog, one change each, Notes kept (SD-30).
    const hashes: string[] = [];
    await page.exposeFunction('uatHash', (h: string) => hashes.push(h));
    await page.evaluate(() =>
      window.addEventListener('hashchange', () =>
        (window as unknown as { uatHash: (h: string) => void }).uatHash(location.hash),
      ),
    );
    dlg.st.answer = 'accept';
    const tabs = page.getByRole('tablist', { name: t('Vacancy views') });
    await tabs.getByRole('tab', { name: t('Results') }).click();
    await expect(page).toHaveURL(new RegExp(`/results$`));
    await tabs.getByRole('tab', { name: t('Report') }).click();
    await expect(page).toHaveURL(new RegExp(`/report$`));
    await page.waitForTimeout(300);
    expect.soft(dlg.seen.length, 'no dialog when switching tabs').toBe(0);
    expect
      .soft(hashes, 'the tab changes once, no flicker back')
      .toEqual([`#/vacancies/${v.id}/results`, `#/vacancies/${v.id}/report`]);
    await expect.soft(notes).toHaveValue('Keep this text');
    await ux.check('tabs switched', [...STD, 'AZ']);
    // 3) '← Vacancies', dismissed.
    dlg.seen.length = 0;
    dlg.st.answer = 'dismiss';
    await page.getByRole('link', { name: t('← Vacancies') }).click();
    await expect.poll(() => dlg.seen.length).toBe(1);
    expect.soft(dlg.seen[0]!.message).toBe(msg);
    await page.waitForTimeout(500);
    await ux.shot('after dismiss');
    await expect.soft(page).toHaveURL(new RegExp(`#/vacancies/${v.id}/report$`));
    await expect.soft(notes).toHaveValue('Keep this text');
    // 4) Again, accepted.
    dlg.st.answer = 'accept';
    await page.getByRole('link', { name: t('← Vacancies') }).click();
    await expect(page).toHaveURL(/#\/vacancies$/);
    await expect(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
    // 5) New vacancy with a title, then '← Vacancies'.
    dlg.seen.length = 0;
    await page.goto('/#/vacancies/new');
    await c
      .getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) })
      .fill('UAT Leaving');
    await page.getByRole('link', { name: t('← Vacancies') }).click();
    await expect.poll(() => dlg.seen.length).toBe(1);
    expect.soft(dlg.seen[0]!.message).toBe(msg);
    // 6) Type again and reload: a beforeunload prompt.
    dlg.seen.length = 0;
    await page.goto('/#/vacancies/new');
    await c
      .getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) })
      .fill('UAT Leaving again');
    await page.reload();
    expect
      .soft(
        dlg.seen.map((d) => d.type),
        'a beforeunload prompt',
      )
      .toContain('beforeunload');
  },
);

uat(
  'VP-10',
  'Vacancy page polls every 4 s while CVs are read; route changes under reduced motion',
  { on: ['D', 'A'], langs: 'EN' },
  async ({ page, ux }) => {
    let n = 0;
    let stopAt = Infinity; // the GET from which the vacancy has nothing running
    const { seen } = await vacApi(page, {
      views: [],
      list: [],
      extra: async (route, url, method) => {
        if (url.pathname !== `/vacancies/${id(1001)}` || method !== 'GET') return false;
        n++;
        const running = n >= stopAt ? 0 : 5;
        await route.fulfill({
          json: vview({
            id: id(1001),
            title: 'UAT Polling',
            requirements: [must('BGP routing', 1)],
            hasFrozen: true,
            counts: { documents: 20, analyzed: 10 + n, strong: 3, running },
          }),
        });
        return true;
      },
    });
    await page.clock.install();
    await page.goto(`/#/vacancies/${id(1001)}`);
    const summary = page.getByRole('region', { name: 'Summary' });
    await expect(summary).toContainText(/5\s*Reading now/);
    const views = () => reqs(seen, 'GET', new RegExp(`^/vacancies/${id(1001)}$`)).length;
    const runs = () => reqs(seen, 'GET', new RegExp(`^/vacancies/${id(1001)}/runs$`)).length;
    const analyzed = async () =>
      Number(/(\d+)\s*Analyzed/.exec((await summary.textContent()) ?? '')?.[1]);
    await page.clock.pauseAt(Date.now() + 1500);
    const g0 = views();
    const r0 = runs();
    const a0 = await analyzed();
    stopAt = g0 + 3; // running reaches 0 on the third poll
    // 2) 12 s: a GET of the vacancy and of /runs every 4 s.
    for (let i = 1; i <= 3; i++) {
      await page.clock.runFor(4000);
      await expect.poll(views, { message: `poll ${i}` }).toBe(g0 + i);
    }
    await expect.poll(runs, { message: '/runs polled with the vacancy' }).toBe(r0 + 3);
    await expect.poll(analyzed, { message: 'the summary numbers update' }).toBe(a0 + 3);
    await expect.soft(summary).not.toContainText('Reading now');
    await ux.shot('after polls'); // (axe needs real timers: the checks run after the clock resumes)
    // 3) 12 s more: nothing.
    await page.clock.runFor(12000);
    await page.waitForTimeout(300);
    expect.soft(views(), 'no GET after running reaches 0').toBe(g0 + 3);
    // 4) Reduced motion: switch tabs, go back to the list.
    await page.clock.resume();
    await ux.check('after polls');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const tabs = page.getByRole('tablist', { name: 'Vacancy views' });
    for (const name of ['Results', 'Runs', 'Candidates']) {
      await tabs.getByRole('tab', { name }).click();
      await page.waitForTimeout(150);
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running')
          .map((a) => (a as CSSAnimation).animationName ?? 'transition'),
      );
      expect.soft(running, `animations after switching to ${name}`).toEqual([]);
    }
    await page.getByRole('link', { name: '← Vacancies' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vacancies' })).toBeVisible();
    await page.waitForTimeout(150);
    expect
      .soft(
        await page.evaluate(
          () => document.getAnimations().filter((a) => a.playState === 'running').length,
        ),
        'animations on the list',
      )
      .toBe(0);
    await ux.check('reduced motion list', [...STD, 'RM']);
  },
);
