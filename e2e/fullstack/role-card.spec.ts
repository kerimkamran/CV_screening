import type { Page } from '@playwright/test';
import {
  apiAt,
  blankPdf,
  docx,
  esc,
  inFlight,
  jd,
  makeVacancy,
  openAt,
  OWNER_BASE,
  ownerServer,
  T,
  textCvs,
  upload,
} from '../fixtures/pkg-c';
import { expect, STD, test, uat } from '../ux/test';
import { FILES } from '../fixtures/files';
import {
  accounts,
  api,
  BASE,
  db,
  drain,
  JD_AZ,
  JD_EN,
  login,
  modelCalls,
  openAs,
  signInUi,
  uniq,
} from './stack';

// 7.7 New vacancy and Role card (VN) and 7.8 Vacancy page (VP), full-stack journeys (L2). UAT plan v1.1.

const roleCard = (page: Page, lang: 'en' | 'az') =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: T(lang)('The role') }) });
const cvsCard = (page: Page, lang: 'en' | 'az') =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: T(lang)('CVs'), exact: true }) });
const position = (page: Page, lang: 'en' | 'az') =>
  roleCard(page, lang).getByRole('textbox', { name: new RegExp(`^${esc(T(lang)('Position'))}`) });
const chips = (page: Page, lang: 'en' | 'az') =>
  roleCard(page, lang)
    .getByRole('group', { name: T(lang)('Skills') })
    .locator('li > button:first-child');
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
/** After typing a title on New vacancy: if the similar-vacancy block shows, choose to create a new one. */
async function pastSimilar(page: Page, lang: 'en' | 'az') {
  const t = T(lang);
  const anyway = roleCard(page, lang).getByRole('button', { name: t('Create a new one anyway') });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
}
async function pressCreate(page: Page, lang: 'en' | 'az', name: string) {
  const t = T(lang);
  const btn = roleCard(page, lang).getByRole('button', { name: t(name), exact: true });
  await btn.click();
  const anyway = roleCard(page, lang).getByRole('button', { name: t('Create a new one anyway') });
  // The similar check runs on save too: a title like an existing one asks first.
  if (
    await anyway.waitFor({ timeout: 1500 }).then(
      () => true,
      () => false,
    )
  ) {
    await anyway.click();
    await btn.click();
  }
}

uat(
  'VN-01',
  'End-to-end journey: sign in, new vacancy, upload 120 CVs, coffeebay, Results, Report and share',
  { on: ['D', 'E', 'T', 'A', 'I'] },
  async ({ page, ux, meta, browser, context }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const prefix = uniq('Journey');
    const title = uniq('UAT Network Engineer');
    const files = [
      // Every third CV meets the role in both languages (the fake AI matches a requirement's longest word).
      ...textCvs(prefix, 117, (i) =>
        i % 3 === 0
          ? [
              'BGP routing experience on the carrier core.',
              'Kubernetes production work.',
              'Python scripting for automation.',
              'Operator şəbəkəsində BGP marşrutlaşdırma təcrübəsi.',
              'İstehsalda Kubernetes təcrübəsi.',
              'Şəbəkə avtomatlaşdırması.',
            ]
          : i % 3 === 1
            ? ['Kubernetes production work.']
            : ['Cooking and hospitality.'],
      ).map((f) => ({ name: f.name, mimeType: 'text/plain', buffer: Buffer.from(f.data) })),
      { name: 'scan-only-1.pdf', mimeType: 'application/pdf', buffer: blankPdf(`${prefix} 1`) },
      { name: 'scan-only-2.pdf', mimeType: 'application/pdf', buffer: blankPdf(`${prefix} 2`) },
      {
        name: 'word-cv.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: FILES.docx(),
      },
    ];
    const since = new Date().toISOString();
    // 1) Sign in.
    await signInUi(page, acc.recruiter);
    await expect(page.getByRole('heading', { level: 1, name: t('Home') })).toBeVisible();
    await ux.check('signed in', [...STD, 'AZ']);
    // 2) New vacancy, from the Vacancies page (a recruiter lands on Home now).
    await page
      .getByRole('navigation', { name: t('Main') })
      .getByRole('link', { name: t('Vacancies') })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: t('Vacancies') })).toBeVisible();
    await page
      .getByRole('link', { name: t('New vacancy'), exact: true })
      .first()
      .click();
    await position(page, meta.lang).fill(title);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await pastSimilar(page, meta.lang);
    // 3) The role text and Read requirements.
    await roleCard(page, meta.lang)
      .getByLabel(new RegExp(`^${esc(t('Requirements'))}`))
      .fill(meta.lang === 'az' ? JD_AZ() : JD_EN());
    await roleCard(page, meta.lang)
      .getByRole('button', { name: t('Read requirements'), exact: true })
      .click();
    const anyway = roleCard(page, meta.lang).getByRole('button', {
      name: t('Create a new one anyway'),
    });
    if (
      await anyway.waitFor({ timeout: 1500 }).then(
        () => true,
        () => false,
      )
    ) {
      await anyway.click();
      await roleCard(page, meta.lang)
        .getByRole('button', { name: t('Read requirements'), exact: true })
        .click();
    }
    // 4) The new page with its skills, without a reload (SD-28).
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${ULID}$`));
    const vid = /#\/vacancies\/(\w{26})/.exec(page.url())![1]!;
    await expect
      .soft(chips(page, meta.lang).first(), 'skill chips without a reload (SD-28)')
      .toBeVisible({ timeout: 15_000 });
    await ux.check('vacancy with skills', [...STD, 'AZ']);
    if (!(await chips(page, meta.lang).first().isVisible())) {
      // SD-28 happened: reload (the workaround a recruiter would find) so the journey can go on.
      await page.reload();
      await expect(chips(page, meta.lang).first()).toBeVisible();
    }
    // 5) 120 files, the notice, start.
    const net = inFlight(page, /\/documents\?item=/);
    const cv = cvsCard(page, meta.lang);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      cv.getByRole('button', { name: t('Choose files'), exact: true }).click(),
    ]);
    await fc.setFiles(files);
    await expect
      .soft(page.getByTestId('check-summary'))
      .toHaveText(
        new RegExp(
          `^${esc(t('{n} files', { n: 120 }))} · .+ · ${esc(t('{n} ready', { n: 120 }))}$`,
        ),
      );
    await expect
      .soft(
        cv.getByText(
          t(
            'You chose {n} CVs. Up to {rec} per upload is recommended so results arrive sooner. You can still send all of them.',
            { n: 120, rec: 100 },
          ),
        ),
      )
      .toBeVisible();
    await cv.getByRole('checkbox').check();
    await ux.check('120 chosen', [...STD, 'AZ']);
    await cv.getByRole('button', { name: t('Find the best fit →') }).click();
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${vid}/candidates$`));
    const hello = page.getByRole('heading', {
      name: t('Hey {name}, go grab a coffee and relax.', { name: 'Aysel' }),
    });
    await expect.soft(hello).toBeVisible();
    await expect.soft(hello).toBeFocused();
    const startAt = net.order.findIndex((u) => u.endsWith(`/vacancies/${vid}/start`));
    const batchAt = net.order.findIndex((u) => u.endsWith(`/vacancies/${vid}/upload-batches`));
    expect
      .soft(startAt >= 0 && batchAt > startAt, 'POST /start before POST /upload-batches')
      .toBe(true);
    await ux.check('waiting screen', [...STD, 'AZ']);
    // 6) Wait for the finish.
    await drain(); // the server has read every CV
    await expect
      .soft(
        page.getByText(t('Analyzed {done} of {total}', { done: 120, total: 120 })).first(),
        'the waiting screen reaches 120 of 120',
      )
      .toBeVisible({ timeout: 20_000 });
    await expect
      .soft(
        page
          .getByRole('heading', {
            level: 2,
            name: new RegExp(
              esc(
                t('{ready} of {total} CVs are ready, {name}.', {
                  ready: 120,
                  total: 120,
                  name: 'Aysel',
                }),
              ),
            ),
          })
          .or(
            page.getByRole('heading', {
              level: 2,
              name: t('All {n} CVs are ready, {name}. Enjoy your coffee.', {
                n: 120,
                name: 'Aysel',
              }),
            }),
          ),
      )
      .toBeVisible();
    expect.soft(net.max, 'never more than 3 files sending at once').toBeLessThanOrEqual(3);
    const calls = (await modelCalls()).filter(
      (c) => c.user.includes('<<<CV_START>>>') && c.user.includes(prefix) && c.at >= since,
    );
    const names = calls.map(
      (c) => /Name: ([^\n]+)/.exec(c.user.slice(c.user.indexOf('<<<CV_START>>>')))?.[1],
    );
    expect.soft(calls.length, 'one scoring call per text CV').toBe(117);
    expect.soft(new Set(names).size).toBe(117);
    const states = await db<{ filename: string; state: string | null }>(
      `SELECT d.filename, s.state FROM cv_document d LEFT JOIN screening s ON s.document_id = d.id WHERE d.vacancy_id = $1 AND d.filename IN ('scan-only-1.pdf','scan-only-2.pdf','word-cv.docx') ORDER BY d.filename`,
      [vid],
    );
    expect
      .soft(states.find((x) => x.filename === 'word-cv.docx')?.state, 'the Word CV was scored')
      .toBe('completed');
    expect
      .soft(
        states.filter((x) => x.filename.startsWith('scan')).map((x) => x.state),
        'no model call for the scan-only files',
      )
      .toEqual(['manual', 'manual']);
    await ux.check('finished', [...STD, 'AZ']);
    // 7) Results: the legend adds up; the first star; its proof; a mark.
    await page
      .getByRole('tablist', { name: t('Vacancy views') })
      .getByRole('tab', { name: t('Results') })
      .click();
    const legend = page.getByRole('list', { name: t('Candidates by match') });
    await expect(legend).toBeVisible();
    const sum = (await legend.locator('strong').allInnerTexts()).reduce((a, b) => a + Number(b), 0);
    expect.soft(sum, 'band counts plus Needs a human look').toBe(120);
    await page.locator('button[data-star]').first().click();
    const reqList = page.getByRole('list', { name: t('Requirements') }).first();
    await expect.soft(reqList, 'the score comes with its proof chips').toBeVisible();
    if (await reqList.isVisible()) {
      await reqList.getByRole('button').first().click();
      await expect
        .soft(
          page
            .getByRole('region', {
              name: new RegExp(`^${esc(t('Proof for {text}', { text: '' }).trim())}`),
            })
            .first(),
        )
        .toBeVisible();
      const mark = page.getByRole('group', { name: t('Choose a mark') }).first();
      await mark.getByRole('button', { name: new RegExp(esc(t('Shortlist'))) }).click();
      await page
        .getByPlaceholder(t('Why? At least 10 characters'))
        .first()
        .fill('Strong BGP design work');
      await page
        .getByRole('button', { name: t('Save my mark') })
        .first()
        .click();
      // PLAN: the plan says the card shows 'My mark: Shortlist'. The card's mark box is titled 'My mark
      // (separate from the AI match)' and reads 'Now: Shortlisted.' (the done form of the button's word), which says the same.
      await expect
        .soft(page.getByText(new RegExp(`${esc(t('Now:'))}\\s*${esc(t('Shortlisted'))}`)).first())
        .toBeVisible();
    }
    await ux.check('marked', [...STD, 'AZ']);
    // 8) Report: share as a link with the viewer.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await page
      .getByRole('tablist', { name: t('Vacancy views') })
      .getByRole('tab', { name: t('Report') })
      .click();
    await page.getByRole('button', { name: t('Share as a link') }).click();
    await page.getByPlaceholder(t('Search by name or e-mail')).fill('Leyla');
    await page
      .getByRole('list', { name: t('People found') })
      .getByRole('checkbox', { name: new RegExp(acc.viewer.displayName) })
      .check();
    await page.getByRole('button', { name: t('Create link') }).click();
    await page
      .getByRole('button', { name: t('Copy link') })
      .first()
      .click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect.soft(link).toMatch(new RegExp(`^${esc(BASE)}/#/reports/${ULID}$`));
    await ux.check('shared', [...STD, 'AZ']);
    // 9) The viewer, in a second browser context.
    const other = await browser.newContext({
      locale: meta.lang === 'az' ? 'az-AZ' : 'en-GB',
      timezoneId: 'Asia/Baku',
    });
    const vp = await other.newPage();
    const flush = ux.watch(vp);
    await vp.addInitScript((l) => localStorage.setItem('cv-lang', l), meta.lang);
    await openAs(vp, acc.viewer, link.replace(/^.*\/(#\/reports\/)/, '$1'));
    await expect.soft(vp.getByText(title).first()).toBeVisible();
    await expect
      .soft(
        vp
          .getByText(
            new RegExp(
              esc(
                t('Shared by {by} · this link works until {date}', {
                  by: 'Aysel Mammadova',
                  date: 'X',
                }).split('X')[0]!,
              ),
            ),
          )
          .first(),
      )
      .toBeVisible();
    flush();
    await other.close();
  },
);

uat(
  'VN-05',
  'Create a vacancy with a title, experience and all More details fields',
  { on: ['D', 'I'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const title = uniq('UAT QA Engineer');
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.accept();
    });
    const sent: { method: string; url: string; body: unknown }[] = [];
    page.on('request', (r) => {
      if (['POST', 'PATCH'].includes(r.method()) && /\/vacancies/.test(r.url()))
        sent.push({ method: r.method(), url: new URL(r.url()).pathname, body: r.postDataJSON() });
    });
    await openAs(page, acc.recruiter, '#/vacancies/new');
    const c = roleCard(page, meta.lang);
    // 1) The fields.
    await position(page, meta.lang).fill(title);
    await c
      .getByRole('group', { name: t('Experience') })
      .getByRole('button', { name: t('3–5 yrs') })
      .click();
    await c.getByText(t('More details'), { exact: true }).click();
    await c.getByLabel(t('Department'), { exact: true }).fill('IT');
    await c.getByLabel(t('Location'), { exact: true }).fill('Bakı');
    await c.getByLabel(t('Open positions'), { exact: true }).fill('2');
    await c.getByLabel(t('Closing date'), { exact: true }).fill('2026-12-31');
    await c.getByLabel(t('Hiring manager'), { exact: true }).fill('Leyla Hasanova');
    await c.getByLabel(new RegExp(`^${esc(t('Notes'))}`)).fill('Night shifts');
    await page.waitForTimeout(600); // the browser draft is written
    await ux.check('filled', [...STD, 'AZ']);
    // 2) Create.
    await pressCreate(page, meta.lang, 'Create vacancy');
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${ULID}$`));
    const vid = /#\/vacancies\/(\w{26})/.exec(page.url())![1]!;
    expect.soft(dialogs, 'no leave prompt').toEqual([]);
    const writes = sent.filter((s) => s.url === '/vacancies' || s.url === `/vacancies/${vid}`);
    expect
      .soft(
        writes.map((s) => `${s.method} ${s.url.replace(vid, '<id>')}`),
        'POST then one PATCH',
      )
      .toEqual(['POST /vacancies', 'PATCH /vacancies/<id>']);
    expect.soft(writes[1]?.body).toEqual({
      expectedVersion: expect.any(Number),
      experienceRange: '3-5',
      department: 'IT',
      location: 'Bakı',
      openings: 2,
      closingDate: '2026-12-31',
      hiringManager: 'Leyla Hasanova',
      notes: 'Night shifts',
    });
    expect
      .soft(
        await page.evaluate(() => localStorage.getItem('cv-vacancy-draft:new')),
        'browser draft removed',
      )
      .toBeNull();
    // 3) Reload.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect
      .soft(
        page.getByText(`IT · Bakı · ${t('Owner: {name}', { name: 'Aysel Mammadova' })}`, {
          exact: true,
        }),
      )
      .toBeVisible();
    await expect
      .soft(page.getByTestId('last-run'))
      .toContainText(`${t('Last run')}: ${t('none yet')}`);
    await expect.soft(page.locator('h1 + span')).toHaveText(t('Draft'));
    await c.getByText(t('More details'), { exact: true }).click();
    await expect
      .soft(
        c.getByRole('group', { name: t('Experience') }).getByRole('button', { name: t('3–5 yrs') }),
      )
      .toHaveAttribute('aria-pressed', 'true');
    for (const [l, v] of [
      ['Department', 'IT'],
      ['Location', 'Bakı'],
      ['Open positions', '2'],
      ['Closing date', '2026-12-31'],
      ['Hiring manager', 'Leyla Hasanova'],
    ])
      await expect.soft(c.getByLabel(t(l!), { exact: true }), l).toHaveValue(v!);
    await expect.soft(c.getByLabel(new RegExp(`^${esc(t('Notes'))}`))).toHaveValue('Night shifts');
    await ux.check('reloaded', [...STD, 'AZ']);
    // 4) The list.
    await page.getByRole('link', { name: t('← Vacancies') }).click();
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: title, exact: true }) });
    await expect(row).toBeVisible();
    const analyzed = await row.evaluate((li) =>
      (li.children[2] as HTMLElement).innerText.replace(/^.*:\s*/, '').trim(),
    );
    expect.soft(analyzed).toBe('—');
  },
);

uat(
  'VN-06',
  "'Read requirements' on a new vacancy: lands on the new page and shows the skills without a reload",
  { on: ['D', 'E', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const extracts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/criteria/extract')) extracts.push(r.url());
    });
    await openAs(page, acc.recruiter, '#/vacancies/new');
    const c = roleCard(page, meta.lang);
    // 1) Title and the role text (English, or Azerbaijani in the Azerbaijani UI).
    await position(page, meta.lang).fill(uniq('UAT SD-28'));
    await c
      .getByLabel(new RegExp(`^${esc(t('Requirements'))}`))
      .fill(meta.lang === 'az' ? JD_AZ() : JD_EN());
    // 2) Read requirements (the extraction answer is held a moment so 'Reading…' can be seen).
    await page.route('**/criteria/extract', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const read = c.getByRole('button', { name: t('Read requirements'), exact: true });
    await read.click();
    const anyway = c.getByRole('button', { name: t('Create a new one anyway') });
    if (
      await anyway.waitFor({ timeout: 1500 }).then(
        () => true,
        () => false,
      )
    ) {
      await anyway.click();
      await read.click();
    }
    await expect.soft(c.getByRole('button', { name: t('Reading…') })).toBeVisible();
    // 3) 5 s, no reload.
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${ULID}$`));
    await page.waitForTimeout(5000);
    await ux.shot('after 5 s');
    // PLAN: the plan expects 6 skills (4 must-have, 2 nice-to-have) from its scripted extraction. The
    // fake AI here reads the "Required:" and "Nice to have:" lines of vacancy-en.txt / vacancy-az.txt,
    // which give 3 skills: 2 must-have and 1 nice-to-have.
    // The fake AI splits the Azerbaijani "Tələb olunur" line on " və " too, so it finds one more
    // must-have there ("operator" and the BGP skill apart): 4 skills, 3 must-have and 1 nice-to-have.
    const [all, must, nice] = meta.lang === 'az' ? [4, 3, 1] : [3, 2, 1];
    await expect
      .soft(chips(page, meta.lang), 'skills shown without a reload (SD-28)')
      .toHaveCount(all);
    const marks = (await chips(page, meta.lang).allInnerTexts()).map((s) => s.trim()[0]);
    expect.soft(marks.filter((m) => m === '●').length, 'must-have').toBe(must);
    expect.soft(marks.filter((m) => m === '○').length, 'nice-to-have').toBe(nice);
    await expect.soft(c.getByRole('button', { name: t('Read requirements again') })).toBeVisible();
    await expect
      .soft(c.getByText(t('No skills yet. Read the requirements or add your own.')))
      .toHaveCount(0);
    await expect.soft(c.getByText(t('Unsaved changes'))).toHaveCount(0);
    expect.soft(extracts.length, 'exactly one POST criteria/extract').toBe(1);
    await ux.check('skills', [...STD, 'AZ']);
    // 4) Reload: the same chips.
    const before = await chips(page, meta.lang).allInnerTexts();
    await page.reload();
    await expect(chips(page, meta.lang).first()).toBeVisible();
    expect.soft(await chips(page, meta.lang).allInnerTexts()).toEqual(before);
  },
);

uat(
  'VN-08',
  'Attach a Word file: reading state, appended text, word count and a damaged file',
  { on: ['D', 'E'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await makeVacancy(BASE, token, { title: uniq('UAT Word file') });
    const para = [
      'Şəbəkə mühəndisi vəzifəsi üçün tələblər: BGP marşrutlaşdırma, OSPF və MPLS üzrə dərin bilik, Kubernetes mühitində təcrübə.',
      'Namizəd Bakı və Gəncə ofislərində növbəli iş qrafikinə hazır olmalıdır; gecə növbələri ayda iki dəfədən çox olmur.',
      'The engineer designs and runs the carrier backbone, plans capacity, and automates routine changes with Python and Ansible.',
      'You will work with the operations centre, write clear runbooks, and review changes made by colleagues before they go live.',
    ];
    const paragraphs = Array.from({ length: 4 }, () => para).flat();
    const roleDocx = await docx(paragraphs);
    const words = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    const c = roleCard(page, meta.lang);
    // 1) One typed line.
    const text = c.getByLabel(new RegExp(`^${esc(t('Requirements'))}`));
    await text.fill('Typed line about the role.');
    // 2) Attach role.docx.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/vacancies/read-document', async (route) => {
      await gate; // hold the answer so the busy state can be seen
      await route.continue();
    });
    const attach = c.locator('button').filter({
      hasText: new RegExp(`^(${esc(t('Attach a Word file'))}|${esc(t('Reading the file…'))})$`),
    });
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), attach.click()]);
    await fc.setFiles({
      name: 'role.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: roleDocx,
    });
    await expect.soft(attach).toHaveText(t('Reading the file…'));
    await expect.soft(c.getByRole('button', { name: t('Add a vacancy link') })).toBeDisabled();
    await expect
      .soft(c.getByRole('button', { name: new RegExp(`^${esc(t('Read requirements'))}`) }))
      .toBeDisabled();
    const res = page.waitForResponse((r) => r.url().endsWith('/vacancies/read-document'));
    release();
    expect((await res).status()).toBeLessThan(300);
    // English "Read role.docx · 160 words"; Azerbaijani "role.docx · 160 söz oxundu" (the count is
    // inside the file part in both).
    const readLine = c.getByText(/^(?:Read )?role\.docx · \d+/);
    await expect(readLine).toBeVisible();
    const shownWords = Number(/· (\d+)/.exec((await readLine.innerText()) ?? '')?.[1]);
    expect.soft(Math.abs(shownWords - words), `word count near ${words}`).toBeLessThanOrEqual(15);
    const value = await text.inputValue();
    expect
      .soft(value.startsWith('Typed line about the role.\n\n'), 'appended after a blank line')
      .toBe(true);
    expect.soft(value, 'Azerbaijani letters kept').toContain('Şəbəkə mühəndisi');
    await ux.check('word read', [...STD, 'AZ']);
    // 3) Save.
    await c.getByRole('button', { name: t('Save'), exact: true }).click();
    await expect(c.getByRole('status').filter({ hasText: t('Saved.') })).toBeVisible();
    const view = (await api(token).get(`/vacancies/${v.id}`)).body;
    expect.soft(view.sourceType).toBe('file');
    expect.soft(view.sourceFileName).toBe('role.docx');
    // 4) A damaged file, then a PDF renamed to .docx.
    for (const [name, buffer] of [
      ['damaged.docx', Buffer.from('PK\u0003\u0004 this is not really a Word file at all')],
      ['renamed.docx', blankPdf('renamed')],
    ] as const) {
      const before = await text.inputValue();
      const [fc2] = await Promise.all([page.waitForEvent('filechooser'), attach.click()]);
      await fc2.setFiles({
        name,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer,
      });
      await expect.soft(c.getByRole('alert'), `${name}: the server reason`).toBeVisible();
      expect
        .soft((await c.getByRole('alert').innerText()).trim().length, `${name}: a reason is given`)
        .toBeGreaterThan(5);
      expect.soft(await text.inputValue(), `${name}: text unchanged`).toBe(before);
      await ux.check(`bad file ${name}`, [...STD, 'AZ']);
    }
    ux.allow(/read-document|400|415|422/);
  },
);

uat(
  'VN-14',
  "Version conflict in two tabs: stale notice, 'Reload their version', no lost update",
  { on: ['D'] },
  async ({ page, ux, meta, context }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Two tabs'),
      details: { notes: 'old', location: 'Bakı' },
    });
    // 1) Tab A and tab B.
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    const b = await context.newPage();
    const flush = ux.watch(b);
    await openAs(b, acc.recruiter, `#/vacancies/${v.id}`);
    for (const p of [page, b]) {
      await expect(roleCard(p, meta.lang)).toBeVisible();
      await roleCard(p, meta.lang).getByText(t('More details'), { exact: true }).click();
    }
    const notes = (p: Page) => roleCard(p, meta.lang).getByLabel(new RegExp(`^${esc(t('Notes'))}`));
    const loc = (p: Page) => roleCard(p, meta.lang).getByLabel(t('Location'), { exact: true });
    // 2) A saves Notes.
    await notes(page).fill('from A');
    await roleCard(page, meta.lang)
      .getByRole('button', { name: t('Save'), exact: true })
      .click();
    await expect(
      roleCard(page, meta.lang)
        .getByRole('status')
        .filter({ hasText: t('Saved.') }),
    ).toBeVisible();
    const savedAt = (await api(token).get(`/vacancies/${v.id}`)).body.updatedAt as string;
    const hhmm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Baku',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(savedAt));
    // 3) B saves Location: 409.
    const patches: { status: number; body: unknown }[] = [];
    b.on('response', async (r) => {
      if (r.request().method() === 'PATCH')
        patches.push({ status: r.status(), body: r.request().postDataJSON() });
    });
    await loc(b).fill('Gəncə');
    await roleCard(b, meta.lang)
      .getByRole('button', { name: t('Save'), exact: true })
      .click();
    await expect.poll(() => patches.length).toBe(1);
    expect.soft(patches[0]!.status).toBe(409);
    ux.allow(/409/);
    const warn = roleCard(b, meta.lang)
      .getByRole('status')
      .filter({ has: b.getByRole('button', { name: t('Reload their version') }) });
    await expect(warn).toBeVisible();
    const english = `Changed by Aysel Mammadova at ${hhmm}. Reload to see their version.`;
    const warnText = (await warn.locator('span').first().innerText()).trim();
    if (meta.lang === 'en') expect.soft(warnText, 'the time in Baku time (SD-78)').toBe(english);
    else {
      expect.soft(warnText, 'the warning in Azerbaijani (SD-43)').not.toMatch(/^Changed by/);
      expect.soft(warnText, 'the time in Baku time (SD-78)').toContain(hhmm);
    }
    await ux.shot('stale');
    // 4) Reload their version.
    await warn.getByRole('button', { name: t('Reload their version') }).click();
    await expect.soft(notes(b), "B shows A's Notes (SD-54)").toHaveValue('from A');
    const draft = roleCard(b, meta.lang)
      .getByRole('status')
      .filter({ hasText: t('You have unsaved changes from {when}.', { when: t('just now') }) });
    await expect.soft(draft, 'the typed Location is kept as a draft').toBeVisible();
    await ux.check('reloaded', [...STD, 'AZ']);
    // 5) Restore them (if offered), Save.
    if (await draft.isVisible())
      await draft.getByRole('button', { name: t('Restore them') }).click();
    await expect(loc(b)).toHaveValue('Gəncə');
    await roleCard(b, meta.lang)
      .getByRole('button', { name: t('Save'), exact: true })
      .click();
    await expect.poll(() => patches.length).toBe(2);
    const body = patches[1]!.body as Record<string, unknown>;
    expect.soft(body, 'the PATCH carries the location').toHaveProperty('location', 'Gəncə');
    expect.soft('notes' in body, 'the PATCH does not carry notes').toBe(false);
    // 6) Nothing is lost.
    const after = (await api(token).get(`/vacancies/${v.id}`)).body;
    expect.soft(after.notes, "A's Notes survive").toBe('from A');
    expect.soft(after.location, "B's Location is saved").toBe('Gəncə');
    flush();
    await b.close();
  },
);

uat(
  'VN-16',
  'VACANCY_EDIT owner mode: the Role card and CVs card are read-only for another recruiter',
  { on: ['D', 'A'] },
  async ({ page, ux, meta, context }) => {
    test.skip(
      !(await ownerServer()),
      'Blocked: the owner-mode API (port 4330) could not be started',
    );
    const t = T(meta.lang);
    const acc = accounts();
    const r1 = await login(acc.recruiter);
    const v = await makeVacancy(BASE, r1, {
      title: uniq('UAT Owner only'),
      jd: jd(['BGP routing', 'Kubernetes'], ['Python scripting']),
      files: textCvs(uniq('Own'), 5),
      drain,
    });
    const r2 = await login(acc.recruiter2);
    // 1) recruiter2 in owner mode.
    await openAt(page, OWNER_BASE, r2, `#/vacancies/${v.id}`);
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    const c = roleCard(page, meta.lang);
    // 2) Every control.
    await expect
      .soft(
        c.getByText(
          t('Only {name} or a team lead can change this role.', { name: 'Aysel Mammadova' }),
        ),
      )
      .toBeVisible();
    await c.getByText(t('More details'), { exact: true }).click();
    const live = await c
      .locator('input, textarea, select, button')
      .evaluateAll((els) =>
        els
          .filter((e) => !(e as HTMLInputElement).disabled && !e.classList.contains('sr-only'))
          .map((e) => (e as HTMLElement).innerText || e.getAttribute('aria-label') || e.tagName),
      );
    expect.soft(live, 'enabled controls on the Role card').toEqual([]);
    for (const b of [
      'Attach a Word file',
      'Add a vacancy link',
      'Read requirements',
      'Read requirements again',
      'Save',
    ])
      await expect
        .soft(c.locator('button').filter({ hasText: new RegExp(`^${esc(t(b))}$`) }), b)
        .toHaveCount(0);
    await expect
      .soft(
        c.getByRole('button', {
          name: new RegExp(`^${esc(t('Remove {name}', { name: '' }).trim())}`),
        }),
      )
      .toHaveCount(0);
    const cv = cvsCard(page, meta.lang);
    await expect.soft(cv.locator('button, input')).toHaveCount(0);
    await ux.check('read-only for recruiter2', [...STD, 'AZ']);
    // 3) The API.
    const a2 = apiAt(OWNER_BASE, r2);
    const cur = (await a2.get(`/vacancies/${v.id}`)).body;
    expect
      .soft(
        (
          await a2.patch(`/vacancies/${v.id}`, {
            expectedVersion: cur.version,
            notes: 'by recruiter2',
          })
        ).status,
        'PATCH',
      )
      .toBe(403);
    expect
      .soft(
        (
          await a2.post(`/vacancies/${v.id}/upload-batches`, {
            files: [{ name: 'x.txt', size: 10 }],
          })
        ).status,
        'POST upload-batches',
      )
      .toBe(403);
    // 4) The lead: everything enabled, Save works.
    const lp = await context.newPage();
    const flush = ux.watch(lp);
    await openAt(lp, OWNER_BASE, await login(acc.lead), `#/vacancies/${v.id}`);
    await lp.getByRole('button', { name: t('Role and CVs') }).click();
    const lc = roleCard(lp, meta.lang);
    await expect
      .soft(
        lc.getByText(
          t('Only {name} or a team lead can change this role.', { name: 'Aysel Mammadova' }),
        ),
      )
      .toHaveCount(0);
    await expect
      .soft(lc.getByRole('textbox', { name: new RegExp(`^${esc(t('Position'))}`) }))
      .toBeEnabled();
    await lc.getByText(t('More details'), { exact: true }).click();
    await lc.getByLabel(new RegExp(`^${esc(t('Notes'))}`)).fill('Checked by the lead');
    await lc.getByRole('button', { name: t('Save'), exact: true }).click();
    await expect.soft(lc.getByRole('status').filter({ hasText: t('Saved.') })).toBeVisible();
    await expect
      .soft(cvsCard(lp, meta.lang).getByText(t('Drop CVs here'), { exact: true }))
      .toBeVisible();
    flush();
    await lp.close();
  },
);

uat(
  'VN-17',
  'VACANCY_EDIT default (everyone): another recruiter edits, the owner stays the owner',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const acc = accounts();
    const r1 = await login(acc.recruiter);
    const v = await makeVacancy(BASE, r1, {
      title: uniq('UAT Everyone edits'),
      jd: jd(['BGP routing', 'Kubernetes']),
      files: textCvs(uniq('Ev'), 5),
      drain,
    });
    // 1) recruiter2 opens it.
    await openAs(page, acc.recruiter2, `#/vacancies/${v.id}`);
    await page.getByRole('button', { name: 'Role and CVs' }).click();
    const c = roleCard(page, 'en');
    await expect.soft(c.getByText(/or a team lead can change this role/)).toHaveCount(0);
    // 2) Flip BGP routing, Save.
    await c.getByRole('button', { name: /^BGP routing, must-have/ }).click();
    await c.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.soft(c.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect.soft(page.getByText(/Owner: Aysel Mammadova/).first()).toBeVisible();
    // 3) History.
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const hist = page.getByRole('region', { name: 'History' });
    await expect(hist.locator(':scope > ul > li').first()).toBeVisible();
    const top = hist.locator(':scope > ul > li').first();
    await expect
      .soft(top.locator('p'))
      .toHaveText(new RegExp(`^Version \\d+ · .+ · ${esc(acc.recruiter2.displayName)}$`));
    await expect
      .soft(top.getByText('“BGP routing”: must-have to nice-to-have', { exact: true }))
      .toBeVisible();
    await ux.check('history', STD);
    // 4) The list.
    await page.getByRole('link', { name: '← Vacancies' }).click();
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: v.title, exact: true }) });
    await expect(row).toBeVisible();
    await expect.soft(row).toContainText('Aysel Mammadova');
    await page.getByLabel(`Actions for ${v.title}`, { exact: true }).click();
    await expect
      .soft(row.locator('details[open] > div').getByRole('button', { name: 'Archive' }))
      .toBeVisible();
  },
);

uat(
  'VP-08',
  'Out-of-date notice and re-analyze after a requirement change',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Out of date'),
      jd: jd(['BGP routing', 'Kubernetes'], ['Python scripting']),
      files: textCvs(uniq('Ood'), 10),
      drain,
    });
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    // 1) Flip BGP routing and save.
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    const c = roleCard(page, meta.lang);
    await c.getByRole('button', { name: new RegExp(`^${esc('BGP routing')},`) }).click();
    await c.getByRole('button', { name: t('Save'), exact: true }).click();
    await expect(c.getByRole('status').filter({ hasText: t('Saved.') })).toBeVisible();
    // 2) The header and notices.
    await expect
      .soft(page.getByTestId('last-run'))
      .toContainText(
        `${t('{a} of {b} read', { a: 10, b: 10 })} · ${t('{n} out of date', { n: 10 })} · ${t('History')}`,
      );
    const notice = page
      .getByRole('status')
      .filter({ hasText: t('{n} results were scored against earlier requirements.', { n: 10 }) });
    await expect.soft(notice).toBeVisible();
    const reBtn = cvsCard(page, meta.lang).getByRole('button', { name: t('Re-analyze') });
    await expect.soft(reBtn).toBeVisible();
    await ux.check('out of date', [...STD, 'AZ']);
    // 3) Hide, then Review and re-analyze: the setup opens and its top is in view.
    await page.getByRole('button', { name: t('Hide role and CVs') }).click();
    await expect(page.locator('#vacancy-setup')).toBeHidden();
    await notice.getByRole('button', { name: t('Review and re-analyze') }).click();
    await expect(page.locator('#vacancy-setup')).toBeVisible();
    await page.waitForTimeout(800);
    const top = await page.locator('#vacancy-setup').evaluate((e) => e.getBoundingClientRect().top);
    expect
      .soft(top >= -1 && top < page.viewportSize()!.height, `the setup's top is in view (${top})`)
      .toBe(true);
    // 4) Re-analyze.
    await reBtn.click();
    await expect.soft(page.getByText(t('{n} CVs queued.', { n: 10 }))).toBeVisible();
    await expect.soft(page).toHaveURL(new RegExp(`#/vacancies/${v.id}/candidates$`));
    await expect
      .soft(
        page.getByRole('heading', {
          name: new RegExp(
            esc(t('Hey {name}, go grab a coffee and relax.', { name: 'X' }).split('X')[0]!),
          ),
        }),
      )
      .toHaveCount(0);
    await drain();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: v.title })).toBeVisible();
    await expect
      .soft(page.getByText(t('{n} results were scored against earlier requirements.', { n: 10 })))
      .toHaveCount(0);
    // 5) Runs and History.
    await page
      .getByRole('tablist', { name: t('Vacancy views') })
      .getByRole('tab', { name: t('Runs') })
      .click();
    await expect
      .soft(
        page
          .getByRole('list', { name: t('Runs') })
          .locator('li')
          .first(),
      )
      .toContainText(t('Run {n}', { n: 2 }));
    await page.getByRole('button', { name: t('History'), exact: true }).click();
    await expect
      .soft(
        page
          .getByRole('region', { name: t('History') })
          .getByText(
            new RegExp(
              `^${esc(t('“{text}”: {from} to {to}', { text: 'BGP routing', from: 'X', to: 'Y' }))
                .replace('X', '.+')
                .replace('Y', '.+')}$`,
            ),
          )
          .first(),
      )
      .toBeVisible();
    await ux.check('runs and history', [...STD, 'AZ']);
    // 6) The list row has no out-of-date pill; 10 new analyses (one model call each).
    await page.getByRole('link', { name: t('← Vacancies') }).click();
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: v.title, exact: true }) });
    await expect(row).toBeVisible();
    await expect
      .soft(row.getByText(new RegExp(esc(t('{n} out of date', { n: 9 })).replace('9', '\\d+'))))
      .toHaveCount(0);
    const run2 = await db<{ n: number }>(
      `SELECT count(*)::int AS n FROM screening s JOIN requirement_set rs ON rs.id = s.requirement_set_id WHERE rs.vacancy_id = $1 AND rs.version = (SELECT max(version) FROM requirement_set WHERE vacancy_id = $1) AND s.state = 'completed'`,
      [v.id],
    );
    expect.soft(run2[0]!.n, 'the fake AI read the 10 CVs again').toBe(10);
  },
);

void upload;
