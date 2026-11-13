import type { Page } from '@playwright/test';
import { esc, inFlight, jd, makeVacancy, T, textCvs } from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';
import { accounts, api, BASE, db, drain, login, openAs, uniq } from './stack';

// 7.9 CVs card (upload) (UP), full-stack journeys (L2). UAT plan v1.1.

const cvsCard = (page: Page, lang: 'en' | 'az') =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: T(lang)('CVs'), exact: true }) });
const asFiles = (fs: { name: string; type: string; data: Buffer | string }[]) =>
  fs.map((f) => ({ name: f.name, mimeType: f.type, buffer: Buffer.from(f.data) }));
async function choose(
  page: Page,
  lang: 'en' | 'az',
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    cvsCard(page, lang)
      .getByRole('button', { name: T(lang)('Choose files'), exact: true })
      .click(),
  ]);
  await fc.setFiles(files);
}
/** The live CVs of a vacancy, as the intake counts them. */
const used = async (token: string, vid: string) =>
  (await api(token).get(`/vacancies/${vid}/intake`)).body.used as number;

uat(
  'UP-07',
  "500-CV limit: 'Only n more fit', 'Vacancy full' rows, server marks the rest",
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    // A vacancy already holding 480 live CVs (sent through the API in parts of 50, read by the fake AI).
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Nearly full'),
      jd: jd(['BGP routing']),
      files: textCvs(uniq('Full'), 480),
      drain,
    });
    expect(await used(token, v.id)).toBe(480);
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    // 1) The usage line.
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    const c = cvsCard(page, meta.lang);
    await expect(c.locator('p[role=status]').first()).toContainText(
      t('{used} of {limit} CVs used in this vacancy', { used: 480, limit: 500 }),
    );
    // 2) 30 more.
    const prefix = uniq('Extra');
    await choose(page, meta.lang, asFiles(textCvs(prefix, 30)));
    await expect
      .soft(
        c.getByText(
          t('Only {room} more CVs fit in this vacancy. The last {n} will not be sent.', {
            room: 20,
            n: 10,
          }),
        ),
      )
      .toBeVisible();
    // 3) Show all 30: the last 10 rows end with '· Vacancy full' in the error colour.
    await c.getByRole('button', { name: t('Show all {n} files', { n: 30 }) }).click();
    const rows = c.locator('ul.divide-y > li');
    await expect(rows).toHaveCount(30);
    const full = await rows.evaluateAll(
      (lis, vf) =>
        lis.map((li) => {
          const s = li.querySelector('span > span:last-child') as HTMLElement;
          return {
            full: s.textContent!.endsWith(`· ${vf}`),
            err: s.className.includes('text-err-ink'),
          };
        }),
      t('Vacancy full'),
    );
    expect
      .soft(
        full.slice(0, 20).every((r) => !r.full),
        'the first 20 fit',
      )
      .toBe(true);
    expect
      .soft(
        full.slice(20).every((r) => r.full && r.err),
        "the last 10: '· Vacancy full' in the error colour",
      )
      .toBe(true);
    await ux.check('nearly full', [...STD, 'AZ']);
    // 4) Start; 5) the finish.
    const box = c.getByRole('checkbox');
    if (await box.count()) await box.check();
    await c.getByRole('button', { name: t('Re-analyze') }).click();
    await expect(page).toHaveURL(/\/candidates$/);
    await expect(
      page
        .getByText(t('Analyzed {done} of {total}', { done: 30, total: 30 }))
        .or(
          page.getByText(
            new RegExp(esc(t('{ready} of {total} CVs are ready', { ready: 20, total: 30 }))),
          ),
        )
        .first(),
    )
      .toBeVisible({ timeout: 60_000 })
      .catch(() => undefined);
    await drain();
    const items = await db<{ code: string | null; n: number }>(
      `SELECT i.code, count(*)::int AS n FROM upload_item i JOIN upload_batch b ON b.id = i.batch_id WHERE b.vacancy_id = $1 AND i.filename LIKE $2 GROUP BY i.code`,
      [v.id, `${prefix.toLowerCase().replace(/\W+/g, '-')}%`],
    );
    expect
      .soft(items.find((i) => i.code === 'vacancy_full')?.n, "10 items 'Vacancy full'")
      .toBe(10);
    expect.soft(await used(token, v.id), 'usage now 500').toBe(500);
    const analyzed = await db<{ n: number }>(
      `SELECT count(*)::int AS n FROM cv_document d JOIN screening s ON s.document_id = d.id WHERE d.vacancy_id = $1 AND d.filename LIKE $2 AND s.state = 'completed'`,
      [v.id, `${prefix.toLowerCase().replace(/\W+/g, '-')}%`],
    );
    expect.soft(analyzed[0]!.n, '20 analyzed').toBe(20);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: v.title })).toBeVisible();
    await expect
      .soft(
        page.getByText(new RegExp(esc(t('{n} files were not sent', { n: 10 })))).first(),
        "the finished line says '10 files were not sent'",
      )
      .toBeVisible();
    await page
      .getByRole('button', { name: t('Details') })
      .first()
      .click()
      .catch(() => undefined);
    await expect
      .soft(
        page.getByText(
          t('{n} files are not sent yet. Choose them again and only those are sent.', { n: 10 }),
        ),
        'no offer to resend while the vacancy is full (SD-57)',
      )
      .toHaveCount(0);
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    await expect
      .soft(cvsCard(page, meta.lang).locator('p[role=status]').first())
      .toContainText(t('{used} of {limit} CVs used in this vacancy', { used: 500, limit: 500 }));
    await ux.check('full', [...STD, 'AZ']);
  },
);

uat(
  'UP-10',
  "'Find the best fit →' starts: freeze first, then the batch, 3 lanes, Candidates tab, waiting screen",
  { on: ['D', 'E', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Start flow'),
      jd: jd(['BGP routing', 'Kubernetes'], ['Python scripting']),
    });
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    const c = cvsCard(page, meta.lang);
    const net = inFlight(page, /\/documents\?item=/);
    const bodies: Record<string, unknown> = {};
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/(start|upload-batches)$/.test(r.url()))
        bodies[r.url().split('/').pop()!] = r.postDataJSON();
    });
    // Hold the start answer a moment so 'Starting…' can be seen.
    await page.route(`**/vacancies/${v.id}/start`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    // 1) 12 files, the notice, start.
    await choose(page, meta.lang, asFiles(textCvs(uniq('Lane'), 12)));
    await c.getByRole('checkbox').check();
    const btn = c.locator('button.h-11');
    await btn.click();
    await expect.soft(btn).toHaveText(t('Starting…'));
    await expect.soft(btn).toBeDisabled();
    // 2) The network.
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${v.id}/candidates$`));
    const s = net.order.findIndex((u) => u.endsWith('/start'));
    const b = net.order.findIndex((u) => u.endsWith('/upload-batches'));
    expect.soft(s >= 0 && b > s, 'POST /start answered before POST /upload-batches').toBe(true);
    expect.soft(bodies.start).toEqual({ confirmNotice: true });
    expect
      .soft(((bodies['upload-batches'] as { files: unknown[] }) ?? { files: [] }).files.length)
      .toBe(12);
    const hello = page.getByRole('heading', {
      name: new RegExp(
        esc(t('Hey {name}, go grab a coffee and relax.', { name: 'Aysel' }).split(',')[0]!),
      ),
    });
    await expect.soft(hello).toBeVisible();
    await expect.soft(hello).toBeFocused();
    await ux.check('waiting screen', [...STD, 'AZ']);
    // 3) The finish, then Role and CVs.
    await drain();
    await expect.poll(() => net.now, { timeout: 30_000 }).toBe(0);
    expect.soft(net.max, 'never more than 3 files in flight').toBeLessThanOrEqual(3);
    await page
      .getByRole('button', {
        name: new RegExp(`^(${esc(t('Role and CVs'))}|${esc(t('Hide role and CVs'))})$`),
      })
      .first()
      .click();
    await expect
      .soft(c.locator('p[role=status]').first())
      .toHaveText(
        new RegExp(
          `${esc(t('{used} of {limit} CVs used in this vacancy', { used: 12, limit: 500 }))} · ${esc(t('{n} analyzed', { n: 12 }))}`,
        ),
        { timeout: 30_000 },
      );
    // 4) Reload: no notice box.
    await page.reload();
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    await expect.soft(cvsCard(page, meta.lang).getByRole('checkbox')).toHaveCount(0);
    await ux.check('after reload', [...STD, 'AZ']);
  },
);

uat(
  'UP-11',
  "'Re-analyze' without new files: queued message, no waiting screen; nothing new",
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const ood = await makeVacancy(BASE, token, {
      title: uniq('UAT Re-analyze'),
      jd: jd(['BGP routing', 'Kubernetes']),
      files: textCvs(uniq('Re'), 10),
      drain,
    });
    const calm = await makeVacancy(BASE, token, {
      title: uniq('UAT Nothing new'),
      jd: jd(['BGP routing']),
      files: textCvs(uniq('Calm'), 3),
      drain,
    });
    // One requirement changed since: 10 out of date.
    const cur = (await api(token).get(`/vacancies/${ood.id}`)).body;
    const reqs = cur.requirements.map(
      (r: { text: string; classification: string; weight: number }) => ({
        text: r.text,
        classification:
          r.classification === 'mandatory' && /BGP/.test(r.text) ? 'preferred' : r.classification,
        weight: /BGP/.test(r.text) ? 5 : r.weight,
      }),
    );
    expect(
      (
        await api(token).patch(`/vacancies/${ood.id}`, {
          expectedVersion: cur.version,
          requirements: reqs,
        })
      ).status,
    ).toBe(200);
    await openAs(page, acc.recruiter, `#/vacancies/${ood.id}`);
    // 1) Role and CVs.
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    const c = cvsCard(page, meta.lang);
    const btn = c.locator('button.h-11');
    await expect.soft(btn).toHaveText(t('Re-analyze'));
    await ux.check('out of date', [...STD, 'AZ']);
    // 2) Re-analyze.
    await btn.click();
    await expect.soft(page.getByText(t('{n} CVs queued.', { n: 10 }))).toBeVisible();
    await expect.soft(page).toHaveURL(new RegExp(`#/vacancies/${ood.id}/candidates$`));
    await expect
      .soft(
        page.getByRole('heading', {
          name: new RegExp(
            esc(t('Hey {name}, go grab a coffee and relax.', { name: 'X' }).split('X')[0]!),
          ),
        }),
      )
      .toHaveCount(0);
    await ux.check('queued', [...STD, 'AZ']);
    await drain();
    // 3) Scenario B: nothing changed.
    await page.goto(`${BASE}/#/vacancies/${calm.id}`);
    await page.getByRole('button', { name: t('Role and CVs') }).click();
    const c2 = cvsCard(page, meta.lang);
    await expect
      .soft(c2.getByText(t('Everything is analyzed against the current requirements.')))
      .toBeVisible();
    await expect.soft(c2.locator('ul[role=status]')).toHaveCount(0);
    await ux.check('nothing new', [...STD, 'AZ']);
  },
);
