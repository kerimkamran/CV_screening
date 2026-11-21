import type { Page } from '@playwright/test';
import {
  apiAt,
  esc,
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
import { accounts, api, BASE, db, drain, login, openAs, setAi, uniq } from './stack';

// 7.6 Vacancy list (VL) and 7.8 Vacancy page (VP), full-stack journeys (L2). UAT plan v1.1.

const rowOf = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) });
const dots = (page: Page, lang: 'en' | 'az', title: string) =>
  page.getByLabel(T(lang)('Actions for {title}', { title }), { exact: true });
/**
 * Press a row-menu item. SD-36: the open menu can be painted under the next rows, so a mouse click
 * at the item lands on the next row. That is checked (soft) first; the item is then pressed with
 * the keyboard, so the rest of the journey can still be tested.
 */
async function pressItem(page: Page, title: string, name: string) {
  const item = rowOf(page, title)
    .locator('details[open] > div')
    .getByRole(name === 'Open' ? 'link' : 'button', { name, exact: true });
  await expect(item).toBeVisible();
  const onTop = await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  expect
    .soft(onTop, `the menu item '${name}' can be clicked (not covered by the next row, SD-36)`)
    .toBe(true);
  await item.focus();
  await page.keyboard.press('Enter');
}
/** Wait until no CV of the vacancy is queued or being read. */
async function settled(vid: string) {
  await expect
    .poll(
      async () =>
        (
          await db<{ n: number }>(
            `SELECT count(*)::int AS n FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1 AND s.state IN ('queued','processing') AND s.cancelled_at IS NULL`,
            [vid],
          )
        )[0]!.n,
      { timeout: 60_000 },
    )
    .toBe(0);
}
const menuItems = async (page: Page, lang: 'en' | 'az', title: string) => {
  await dots(page, lang, title).click();
  const items = (
    await rowOf(page, title).locator('details[open] > div').locator('a, button').allInnerTexts()
  ).map((s) => s.trim());
  await rowOf(page, title)
    .locator('details[open]')
    .evaluate((d) => d.removeAttribute('open'));
  return items;
};

uat(
  'VL-07',
  'Archive with 10 s Undo, Archived chip and Restore',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const title = uniq('UAT Archive me');
    const v = await makeVacancy(BASE, token, {
      title,
      jd: jd(['BGP routing']),
      files: textCvs(uniq('Arch'), 3),
      drain,
    });
    const status0 = (await api(token).get(`/vacancies/${v.id}`)).body.status as string; // 'open' once started
    await openAs(page, acc.recruiter, '#/vacancies');
    const row = rowOf(page, title);
    await expect(row).toBeVisible();
    const posts: string[] = [];
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().includes(v.id))
        posts.push(`${r.url().replace(/^.*\/vacancies\/\w+\//, '')} ${r.status()}`);
    });
    const toast = page.getByRole('status').filter({ hasText: t('Archived “{title}”.', { title }) });
    // The layout checks of the first toast take longer than 10 s on this page, so for steps 1 and 2
    // only the 10 s timer is stretched; step 3 below runs on the real timer and times it.
    await page.evaluate(() => {
      const w = window as unknown as { __slowToast?: boolean };
      const real = window.setTimeout.bind(window);
      w.__slowToast = true;
      window.setTimeout = ((f: TimerHandler, ms?: number, ...a: unknown[]) =>
        real(f, ms === 10_000 && w.__slowToast ? 120_000 : ms, ...a)) as typeof window.setTimeout;
    });
    // 1) Archive.
    await dots(page, meta.lang, title).click();
    await pressItem(page, title, t('Archive'));
    await expect(toast).toBeVisible();
    await expect.poll(() => posts).toContain('archive 200');
    await expect.soft(row, 'the row leaves the All list').toHaveCount(0);
    await expect.soft(toast.getByRole('button', { name: t('Undo') })).toBeVisible();
    // The toast does not cover the last row.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const last = page
      .getByRole('list', { name: t('Vacancies') })
      .getByRole('listitem')
      .last();
    const [lb, tb] = [(await last.boundingBox())!, (await toast.boundingBox())!];
    const overlap = !(
      lb.y + lb.height <= tb.y ||
      tb.y + tb.height <= lb.y ||
      lb.x + lb.width <= tb.x ||
      tb.x + tb.width <= lb.x
    );
    expect.soft(overlap, 'the toast covers the last row').toBe(false);
    await ux.check('archived toast', [...STD, 'AZ'], { overlay: '[role=status].fixed' });
    // 2) Undo.
    await toast.getByRole('button', { name: t('Undo') }).click();
    await expect.poll(() => posts).toContain('restore 200');
    await expect(row).toBeVisible();
    await expect.soft(row).toContainText(t(status0 === 'open' ? 'Open' : 'Draft'));
    // 3) Archive again and wait 11 s (the real timer).
    await page.evaluate(() => {
      (window as unknown as { __slowToast?: boolean }).__slowToast = false;
    });
    await dots(page, meta.lang, title).click();
    await pressItem(page, title, t('Archive'));
    await expect(toast).toBeVisible();
    await page.waitForTimeout(11_000);
    await expect.soft(toast, 'the toast is gone after 10 s').toHaveCount(0);
    expect
      .soft((await api(token).get(`/vacancies/${v.id}`)).body.archived, 'stays archived')
      .toBe(true);
    // 4) The Archived chip.
    await page
      .getByRole('group', { name: t('Status') })
      .getByRole('button', { name: t('Archived'), exact: true })
      .click();
    await expect(row).toBeVisible();
    await expect.soft(row.getByText(t('Archived'), { exact: true })).toHaveClass(/bg-neutral/);
    expect.soft(await menuItems(page, meta.lang, title)).toEqual([t('Open'), t('Restore')]);
    await ux.check('archived list', [...STD, 'AZ']);
    // 5) Restore: the row leaves the list, no toast.
    const n = posts.length;
    await dots(page, meta.lang, title).click();
    await pressItem(page, title, t('Restore'));
    await expect.poll(() => posts.slice(n)).toContain('restore 200');
    await expect.soft(row).toHaveCount(0);
    await expect.soft(page.getByRole('button', { name: t('Undo') })).toHaveCount(0);
    // 6) All: the old status.
    await page
      .getByRole('group', { name: t('Status') })
      .getByRole('button', { name: t('All'), exact: true })
      .click();
    await expect(row).toBeVisible();
    await expect.soft(row).toContainText(t('Open'));
    // The audit trail, under the recruiter's name.
    const audit = await db<{ action: string; n: number }>(
      `SELECT action, count(*)::int AS n FROM audit_event WHERE entity_id = $1 AND actor_id = $2 AND action IN ('vacancy.archive','vacancy.restore') GROUP BY action ORDER BY action`,
      [v.id, acc.recruiter.userId],
    );
    expect.soft(audit).toEqual([
      { action: 'vacancy.archive', n: 2 },
      { action: 'vacancy.restore', n: 2 },
    ]);
  },
);

uat(
  'VL-08',
  "Duplicate creates a 'Copy of …' draft with the requirements and no CVs",
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const acc = accounts();
    const token = await login(acc.recruiter);
    const ne = await makeVacancy(BASE, token, {
      title: uniq('UAT Network Engineer'),
      jd: jd(['BGP routing', 'OSPF', 'MPLS'], ['Python scripting', 'Ansible']),
      details: {
        department: 'Network',
        location: 'Bakı',
        openings: 2,
        hiringManager: 'Leyla Hasanova',
        notes: 'Night shifts',
        experienceRange: '3-5',
      },
      files: textCvs(uniq('Dup'), 3),
      drain,
    });
    const qa = await makeVacancy(BASE, token, {
      title: uniq('Copy of UAT QA'),
      jd: jd(['Selenium']),
    });
    const arch = await makeVacancy(BASE, token, { title: uniq('UAT Archived dup') });
    expect((await api(token).post(`/vacancies/${arch.id}/archive`)).status).toBe(200);
    await openAs(page, acc.recruiter, '#/vacancies');
    // 1) Duplicate.
    const dup = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/vacancies/${ne.id}/duplicate`),
    );
    await dots(page, 'en', ne.title).click();
    await pressItem(page, ne.title, 'Duplicate');
    const res = await dup;
    expect(res.status()).toBe(201);
    const copyId = ((await res.json()) as { id: string }).id;
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${copyId}$`));
    // 2) The new page.
    await expect(
      page.getByRole('heading', { level: 1, name: `Copy of ${ne.title}` }),
    ).toBeVisible();
    await expect.soft(page.locator('h1 + span')).toHaveText('Draft');
    await expect
      .soft(page.getByText('Network · Bakı · Owner: Aysel Mammadova', { exact: true }))
      .toBeVisible();
    const role = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'The role' }) });
    const chips = role
      .getByRole('group', { name: 'Skills' })
      .getByRole('button', { name: /, (must-have|nice-to-have)\./ });
    await expect.soft(chips).toHaveCount(5);
    await role.getByText('More details', { exact: true }).click();
    await expect.soft(role.getByLabel('Department', { exact: true })).toHaveValue('Network');
    await expect
      .soft(role.getByLabel('Hiring manager', { exact: true }))
      .toHaveValue('Leyla Hasanova');
    await expect.soft(role.getByLabel(/^Notes/)).toHaveValue('Night shifts');
    await expect
      .soft(
        role.getByRole('group', { name: 'Experience' }).getByRole('button', { name: '3–5 yrs' }),
      )
      .toHaveAttribute('aria-pressed', 'true');
    await expect
      .soft(page.getByText('0 of 500 CVs used in this vacancy', { exact: true }))
      .toBeVisible();
    await expect.soft(page.getByRole('region', { name: 'Summary' })).toHaveCount(0);
    await ux.check('copy', STD);
    // 3) Duplicate 'Copy of UAT QA …'.
    await page.goto(`${BASE}/#/vacancies`);
    const dup2 = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/vacancies/${qa.id}/duplicate`),
    );
    await dots(page, 'en', qa.title).click();
    await pressItem(page, qa.title, 'Duplicate');
    await dup2;
    await expect.soft(page.getByRole('heading', { level: 1 })).toHaveText(qa.title);
    // 4) The archived row has no Duplicate.
    await page.goto(`${BASE}/#/vacancies`);
    await page
      .getByRole('group', { name: 'Status' })
      .getByRole('button', { name: 'Archived', exact: true })
      .click();
    await expect(rowOf(page, arch.title)).toBeVisible();
    expect.soft(await menuItems(page, 'en', arch.title)).not.toContain('Duplicate');
  },
);

uat(
  'VL-09',
  'Archive while CVs are being read is refused with a clear message',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const title = uniq('UAT Busy archive');
    // The fake AI has no "hold" marker: it is slowed down (5 s a CV) for the few seconds this needs.
    const v = await makeVacancy(BASE, token, { title, jd: jd(['BGP routing']), start: true });
    try {
      await setAi('scripted', 5000);
      const up = await upload(
        BASE,
        token,
        `/vacancies/${v.id}/documents`,
        textCvs(uniq('Busy'), 5),
      );
      expect(up.status).toBeLessThan(300);
      await openAs(page, acc.recruiter, '#/vacancies');
      const row = rowOf(page, title);
      await expect(row).toBeVisible();
      const runningText = new RegExp(
        esc(t('{n} analyzed, {m} running')).replace(/\\\{\w+\\\}/g, '\\d+'),
      );
      await expect(row).toContainText(runningText);
      const res = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith(`/vacancies/${v.id}/archive`),
      );
      await dots(page, meta.lang, title).click();
      await pressItem(page, title, t('Archive'));
      expect.soft((await res).status(), 'the server answers 409').toBe(409);
      ux.allow(/409/);
      const notice = page
        .getByRole('alert')
        .filter({ hasText: t('Stop the running screening first') });
      await expect.soft(notice).toBeVisible();
      // Under the toolbar: below the search box, above the list.
      const nb = await notice.boundingBox();
      const sb = await page.getByRole('searchbox', { name: t('Search vacancies') }).boundingBox();
      expect.soft(!!nb && !!sb && nb.y > sb.y, 'the notice is under the toolbar').toBe(true);
      await expect.soft(page.getByRole('button', { name: t('Undo') })).toHaveCount(0);
      await expect.soft(row).toBeVisible();
      await expect.soft(row).toContainText(t('Open'));
      await expect.soft(row).toContainText(runningText);
      await ux.check('refused', [...STD, 'AZ']);
    } finally {
      await setAi('scripted', 0);
    }
    await drain();
  },
);

uat(
  'VL-11',
  'VACANCY_EDIT owner mode: Archive and Restore only for the owner or a team lead',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux, context }) => {
    test.skip(
      !(await ownerServer()),
      'Blocked: the owner-mode API (port 4330) could not be started',
    );
    const acc = accounts();
    const r1 = await login(acc.recruiter);
    const r2 = await login(acc.recruiter2);
    const a = await makeVacancy(BASE, r1, { title: uniq('UAT Owner A') });
    const b = await makeVacancy(BASE, r2, { title: uniq('UAT Owner B') });
    // 1) recruiter2, owner mode.
    await openAt(page, OWNER_BASE, r2, '#/vacancies');
    await expect(rowOf(page, a.title)).toBeVisible();
    expect
      .soft(await menuItems(page, 'en', a.title), 'recruiter2 on A')
      .toEqual(['Open', 'Duplicate']);
    expect
      .soft(await menuItems(page, 'en', b.title), 'recruiter2 on B (own)')
      .toEqual(['Open', 'Duplicate', 'Archive']);
    await ux.check('owner mode, recruiter2', STD);
    // 2) The direct call.
    const direct = await apiAt(OWNER_BASE, r2).post(`/vacancies/${a.id}/archive`);
    expect.soft(direct.status, 'direct archive by recruiter2').toBe(403);
    expect.soft((await api(r1).get(`/vacancies/${a.id}`)).body.archived).toBe(false);
    // 3) The lead.
    const lead = await context.newPage();
    const flush = ux.watch(lead);
    await openAt(lead, OWNER_BASE, await login(acc.lead), '#/vacancies');
    await expect(rowOf(lead, a.title)).toBeVisible();
    expect.soft(await menuItems(lead, 'en', a.title), 'lead on A').toContain('Archive');
    flush();
    await lead.close();
    // 4) Default mode (the shared server): recruiter2 may archive A.
    const p2 = await context.newPage();
    const flush2 = ux.watch(p2);
    await openAt(p2, BASE, r2, '#/vacancies');
    await expect(rowOf(p2, a.title)).toBeVisible();
    expect
      .soft(await menuItems(p2, 'en', a.title), 'default mode: recruiter2 on A')
      .toContain('Archive');
    flush2();
    await p2.close();
  },
);

uat(
  'VP-06',
  'Archived vacancy is read-only on every tab and in the API',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const a = api(token);
    const prefix = uniq('Arch RO');
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Read only'),
      jd: jd(['BGP routing', 'Kubernetes'], ['Python scripting']),
      files: textCvs(prefix, 20),
      drain,
    });
    // 5 more CVs, stopped while waiting (the fake AI slowed down so they are still queued).
    try {
      await setAi('scripted', 4000);
      expect(
        (await upload(BASE, token, `/vacancies/${v.id}/documents`, textCvs(`${prefix} late`, 5)))
          .status,
      ).toBeLessThan(300);
      expect((await a.post(`/vacancies/${v.id}/stop`)).status).toBeLessThan(300);
    } finally {
      await setAi('scripted', 0);
    }
    await drain();
    await settled(v.id);
    const pool = await a.get(`/candidates?vacancy=${v.id}&limit=50`);
    const first = pool.body.rows.find((r: { matchId: string | null }) => r.matchId);
    expect(
      (
        await a.put(`/candidates/${first.matchId}/decision`, {
          mark: 'shortlist',
          note: 'Strong routing work',
          expectedVersion: first.decisionVersion ?? 0,
        })
      ).status,
    ).toBe(200);
    const stopped = await db<{ n: number }>(
      `SELECT count(*)::int AS n FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1 AND s.cancelled_at IS NOT NULL`,
      [v.id],
    );
    expect.soft(stopped[0]!.n, 'CVs stopped before archiving').toBeGreaterThan(0);
    expect((await a.post(`/vacancies/${v.id}/archive`)).status).toBe(200);

    // 1) The banner.
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    const banner = page
      .getByRole('status')
      .filter({ hasText: t('This vacancy is archived. Marks and edits are off.') });
    await expect(banner).toBeVisible();
    await expect.soft(banner.getByRole('button', { name: t('Restore') })).toBeVisible();
    await ux.check('archived page', [...STD, 'AZ']);
    // 2) Role and CVs.
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    const role = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: t('The role') }) });
    await expect
      .soft(role.getByText(t('This vacancy is archived. Restore it to change it.')))
      .toBeVisible();
    const enabled = await role
      .locator('input, textarea, select, button')
      .evaluateAll((els) =>
        els
          .filter(
            (e) =>
              !(e as HTMLInputElement).disabled &&
              !e.closest('details:not([open]) > :not(summary)') &&
              (e as HTMLElement).offsetParent !== null,
          )
          .map((e) => (e as HTMLElement).innerText || e.getAttribute('aria-label') || e.tagName),
      );
    expect.soft(enabled, 'no enabled field on the Role card').toEqual([]);
    const cvs = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: t('CVs'), exact: true }) });
    await expect.soft(cvs.locator('button, input')).toHaveCount(0);
    await ux.check('role and CVs', [...STD, 'AZ']);
    // 3) Criteria tab.
    const tabs = page.getByRole('tablist', { name: t('Vacancy views') });
    await tabs.getByRole('tab', { name: t('Criteria') }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.locator('input, textarea, select').first()).toBeVisible();
    const live = await panel
      .locator('input, textarea, select')
      .evaluateAll((els) => els.filter((e) => !(e as HTMLInputElement).disabled).length);
    expect.soft(live, 'Criteria fields enabled on an archived vacancy').toBe(0);
    for (const b of [
      'Extract with AI',
      'Add criterion',
      'Save draft',
      'Freeze criteria',
      'Create new version to edit',
    ])
      await expect.soft(panel.getByRole('button', { name: t(b) }), `no '${b}'`).toHaveCount(0);
    await ux.check('criteria', [...STD, 'AZ']);
    // 4) Results: the Requirements drawer and the mark.
    await tabs.getByRole('tab', { name: t('Results') }).click();
    await expect.soft(panel.getByRole('button', { name: t('Stop analysis') })).toHaveCount(0);
    await expect
      .soft(
        panel.getByRole('button', {
          name: new RegExp(esc(t('Continue reading the other {n}', { n: 9 })).replace('9', '\\d+')),
        }),
      )
      .toHaveCount(0);
    await panel.getByRole('button', { name: t('Requirements'), exact: true }).click();
    const drawer = page.getByRole('dialog', { name: t('Requirements') });
    await expect(drawer).toBeVisible();
    const radios = await drawer
      .getByRole('radio')
      .evaluateAll((rs) => rs.filter((r) => !r.matches(':disabled')).length);
    expect.soft(radios, 'drawer radios enabled').toBe(0);
    await expect
      .soft(drawer.getByRole('button', { name: t('Back to original') }).first())
      .toBeDisabled();
    await ux.check('drawer', [...STD, 'AZ'], { overlay: '[role=dialog]' });
    await page.keyboard.press('Escape');
    const star = panel.locator('button[data-star]').first();
    if (await star.count()) await star.click();
    const mark = panel.getByRole('group', { name: t('Choose a mark') }).first();
    if (await mark.count()) {
      await mark.getByRole('button').first().click();
      await expect
        .soft(panel.getByRole('button', { name: t('Save my mark') }), "no 'Save my mark'")
        .toHaveCount(0);
    }
    // 5) Candidates: rows cannot be marked.
    await tabs.getByRole('tab', { name: t('Candidates') }).click();
    const decisions = panel.getByRole('combobox', {
      name: new RegExp(`^${esc(t('Decision for {name}')).replace(/\\\{name\\\}/, '.+')}$`),
    });
    await expect.soft(decisions.first(), 'the analyzed CVs are listed (read-only)').toBeVisible();
    const marks = await decisions.evaluateAll(
      (s) => s.filter((x) => !(x as HTMLSelectElement).disabled).length,
    );
    expect.soft(marks, 'mark controls enabled in the Candidates rows').toBe(0);
    await ux.check('candidates', [...STD, 'AZ']);
    // 6) The API: every change answers 409 and writes nothing.
    const before = await db<{ n: number }>(
      `SELECT (SELECT count(*) FROM decision x JOIN screening s ON s.id = x.screening_id JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1)::int + (SELECT count(*) FROM requirement_set WHERE vacancy_id = $1)::int AS n`,
      [v.id],
    );
    const crit = (await a.get(`/vacancies/${v.id}/criteria`)).body;
    const sid = first.matchId as string;
    const calls: [string, Promise<{ status: number }>][] = [
      [
        'PUT criteria',
        a.put(`/vacancies/${v.id}/criteria`, { requirements: crit.current?.requirements ?? [] }),
      ],
      ['POST criteria/new-version', a.post(`/vacancies/${v.id}/criteria/new-version`)],
      ['POST criteria/extract', a.post(`/vacancies/${v.id}/criteria/extract`)],
      [
        'POST adjustments',
        a.post(`/vacancies/${v.id}/adjustments`, {
          requirementId: crit.current?.requirements?.[0]?.id,
          to: 'preferred',
        }),
      ],
      ['POST continue', a.post(`/vacancies/${v.id}/continue`)],
      ['POST stop', a.post(`/vacancies/${v.id}/stop`)],
      [
        'POST /screenings/<id>/decision',
        a.post(`/screenings/${sid}/decision`, {
          outcome: 'hold',
          reason: 'Archived vacancy check.',
        }),
      ],
    ];
    for (const [name, p] of calls) expect.soft((await p).status, name).toBe(409);
    const after = await db<{ n: number }>(
      `SELECT (SELECT count(*) FROM decision x JOIN screening s ON s.id = x.screening_id JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1)::int + (SELECT count(*) FROM requirement_set WHERE vacancy_id = $1)::int AS n`,
      [v.id],
    );
    expect.soft(after[0]!.n, 'no row written').toBe(before[0]!.n);
  },
);

uat(
  'VP-07',
  'Restore from the archived banner',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux, context }) => {
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Restore banner'),
      jd: jd(['BGP routing']),
    });
    await api(token).post(`/vacancies/${v.id}/archive`);
    // 1) The recruiter restores from the banner.
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    const banner = page
      .getByRole('status')
      .filter({ hasText: 'This vacancy is archived. Marks and edits are off.' });
    await expect(banner).toBeVisible();
    const res = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/vacancies/${v.id}/restore`),
    );
    await banner.getByRole('button', { name: 'Restore' }).click();
    expect((await res).status()).toBe(200);
    await expect.soft(banner).toHaveCount(0);
    await expect.soft(page.locator('h1 + span')).toHaveText('Draft');
    const role = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'The role' }) });
    await expect.soft(role.getByRole('textbox', { name: /^Position/ })).toBeEnabled();
    await expect.soft(role.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect.soft(page.getByText('Drop CVs here', { exact: true })).toBeVisible();
    await ux.check('restored', STD);
    // 2) Owner mode: recruiter2 sees the banner without Restore.
    test.skip(
      !(await ownerServer()),
      'Blocked: the owner-mode API (port 4330) could not be started',
    );
    const w = await makeVacancy(BASE, token, { title: uniq('UAT Restore owner') });
    await api(token).post(`/vacancies/${w.id}/archive`);
    const p2 = await context.newPage();
    const flush = ux.watch(p2);
    await openAt(p2, OWNER_BASE, await login(acc.recruiter2), `#/vacancies/${w.id}`);
    const b2 = p2
      .getByRole('status')
      .filter({ hasText: 'This vacancy is archived. Marks and edits are off.' });
    await expect(b2).toBeVisible();
    await expect.soft(b2.getByRole('button', { name: 'Restore' })).toHaveCount(0);
    flush();
    await p2.close();
  },
);
