import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import JSZip from 'jszip';
import { DOCX_MIME, FILES } from '../fixtures/files';
import { esc, inFlight, jd, makeVacancy, T, textCvs } from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';
import { accounts, api, BASE, db, drain, holdAi, login, openAs, uniq } from './stack';
import { sleep } from '../fixtures/pkg-i';

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
    // Since S3-UP-01 the tab announces only what fits (the room, 20): the 10 beyond it are marked
    // "Vacancy full" in the list before the click and never reach the server.
    const items = await db<{ code: string | null; n: number }>(
      `SELECT i.code, count(*)::int AS n FROM upload_item i JOIN upload_batch b ON b.id = i.batch_id WHERE b.vacancy_id = $1 AND i.filename LIKE $2 GROUP BY i.code`,
      [v.id, `${prefix.toLowerCase().replace(/\W+/g, '-')}%`],
    );
    expect
      .soft(
        items.reduce((n, i) => n + i.n, 0),
        '20 announced',
      )
      .toBe(20);
    expect
      .soft(
        items.find((i) => i.code === 'vacancy_full'),
        "no 'Vacancy full' item on the server",
      )
      .toBeUndefined();
    expect.soft(await used(token, v.id), 'usage now 500').toBe(500);
    const analyzed = await db<{ n: number }>(
      `SELECT count(*)::int AS n FROM cv_document d JOIN screening s ON s.document_id = d.id WHERE d.vacancy_id = $1 AND d.filename LIKE $2 AND s.state = 'completed'`,
      [v.id, `${prefix.toLowerCase().replace(/\W+/g, '-')}%`],
    );
    expect.soft(analyzed[0]!.n, '20 analyzed').toBe(20);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: v.title })).toBeVisible();
    // The batch holds the 20 that were sent: the reloaded page does not report 10 unsent files.
    await expect
      .soft(
        page.getByText(new RegExp(esc(t('{n} files were not sent', { n: 10 })))),
        'no "10 files were not sent" after the reload',
      )
      .toHaveCount(0);
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
    // 1) 12 files, the notice, start. The fake AI holds the reads, so the waiting screen is still
    // up when it is checked (12 short CVs can otherwise finish first on a fast runner).
    await choose(page, meta.lang, asFiles(textCvs(uniq('Lane'), 12)));
    await c.getByRole('checkbox').check();
    const btn = c.locator('button.h-11');
    await holdAi(true);
    try {
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
    } finally {
      await holdAi(false);
    }
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

// UP-15: bulk upload of loose PDF, Word and Markdown CVs plus a ZIP holding the same three formats.
uat(
  'UP-15',
  'Bulk upload: PDF, Word and Markdown files together with a ZIP of the same formats',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Bulk formats'),
      jd: jd(['BGP routing']),
      start: true,
    });
    const tag = uniq('Bulk').toLowerCase().replace(/\W+/g, '-');
    const md = (who: string) =>
      Buffer.from(
        `# ${who}\n\n## Skills\n\n- **BGP routing**, OSPF, Kubernetes\n- Python scripting\n\n## Experience\n\n` +
          `Network engineer. ${'Designed and operated carrier-grade backbones. '.repeat(8)}\n`,
      );
    const pdfBytes = readFileSync(new URL('../fixtures/cv.pdf', import.meta.url));
    // The ZIP holds its own PDF and Word files: an identical file is the same CV and would be left out.
    const zipPdf = readFileSync(new URL('../fixtures/cv-10p.pdf', import.meta.url));
    const word = await JSZip.loadAsync(FILES.docx());
    const body = await word.file('word/document.xml')!.async('string');
    const cut = body.lastIndexOf('<w:sectPr');
    word.file(
      'word/document.xml',
      `${body.slice(0, cut)}<w:p><w:r><w:t>Second copy of this CV, ${tag}.</w:t></w:r></w:p>${body.slice(cut)}`,
    );
    const zipDocx = await word.generateAsync({ type: 'nodebuffer' });
    const zip = new JSZip();
    zip.file(`${tag}-z.pdf`, zipPdf);
    zip.file(`${tag}-z.docx`, zipDocx);
    zip.file(`${tag}-z.md`, md('Zip Markdown Person'));
    zip.file(`team/${tag}-nested.md`, md('Zip Nested Person'));
    zip.file(`${tag}-photo.jpg`, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]));
    zip.file('__MACOSX/._junk', Buffer.from('x'));
    const zipBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}`);
    await expect(page.getByRole('heading', { level: 1, name: v.title })).toBeVisible();
    const roleBtn = page.getByRole('button', { name: t('Role and CVs') });
    const c = cvsCard(page, meta.lang);
    await expect(roleBtn.or(c).first()).toBeVisible();
    if (!(await c.isVisible())) await roleBtn.click();
    await expect(c).toBeVisible();
    // 1) Three loose files in one choice, then the ZIP in a second choice.
    await choose(page, meta.lang, [
      { name: `${tag}-a.md`, mimeType: 'text/markdown', buffer: md('Loose Markdown Person') },
      { name: `${tag}-b.docx`, mimeType: DOCX_MIME, buffer: FILES.docx() },
      { name: `${tag}-c.pdf`, mimeType: 'application/pdf', buffer: pdfBytes },
    ]);
    await choose(page, meta.lang, [
      { name: `${tag}.zip`, mimeType: 'application/zip', buffer: zipBytes },
    ]);
    await expect(c.getByTestId('check-summary')).toContainText(t('{n} files', { n: 4 }));
    await expect(c.getByTestId('check-summary')).toContainText(t('{n} ready', { n: 4 }));
    await ux.check('three formats and a zip chosen', [...STD, 'AZ']);
    // 2) Start.
    const box = c.getByRole('checkbox');
    if (await box.count()) await box.first().check();
    await c
      .locator('button')
      .filter({
        hasText: new RegExp(`^(${esc(t('Find the best fit →'))}|${esc(t('Re-analyze'))})$`),
      })
      .click();
    await expect(page).toHaveURL(/\/candidates$/);
    await expect
      .poll(async () => (await drain(), await used(token, v.id)), { timeout: 90_000 })
      .toBe(7);
    // 3) Seven CVs were read (three loose, three in the ZIP, one in a ZIP folder); the photo was reported.
    const docs = await db<{ filename: string; state: string | null }>(
      `SELECT d.filename, s.state FROM cv_document d LEFT JOIN screening s ON s.document_id = d.id WHERE d.vacancy_id = $1 ORDER BY d.filename`,
      [v.id],
    );
    const names = docs.map((d) => d.filename);
    for (const ext of ['md', 'docx', 'pdf'])
      expect
        .soft(names.filter((n) => n.endsWith(`.${ext}`)).length, `.${ext} files`)
        .toBeGreaterThan(0);
    expect.soft(names.filter((n) => n.endsWith('.md')).length, 'three Markdown CVs').toBe(3);
    expect.soft(names.filter((n) => n.endsWith('.docx')).length, 'two Word CVs').toBe(2);
    expect.soft(names.filter((n) => n.endsWith('.pdf')).length, 'two PDF CVs').toBe(2);
    expect
      .soft(
        docs.every((d) => d.state === 'completed'),
        'all seven analyzed',
      )
      .toBe(true);
    const skips = await db<{ filename: string; reason: string }>(
      `SELECT filename, reason FROM intake_skip WHERE vacancy_id = $1`,
      [v.id],
    );
    expect.soft(skips.map((s) => s.filename).join('|')).toContain('photo.jpg');
    expect.soft(skips[0]?.reason).toBe('Only PDF, DOCX, TXT and MD files');
    // 4) The recruiter sees the skipped photo with its reason (Results tab: 'N skipped, see which').
    await page.goto(`/#/vacancies/${v.id}/results`);
    await expect(page.getByRole('heading', { level: 1, name: v.title })).toBeVisible();
    await page
      .getByRole('button', { name: t('see which'), exact: true })
      .click({ timeout: 20_000 });
    const line = page.getByText(new RegExp(`${esc(`${tag}.zip › ${tag}-photo.jpg`)}: `)).first();
    await expect.soft(line, 'the photo is listed with its ZIP').toBeVisible({ timeout: 15_000 });
    await expect
      .soft(line, 'with its reason, in the screen language')
      .toContainText(t('Only PDF, DOCX, TXT and MD files'));
    await ux.check('after the upload', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------ Stage 3 (S3-UP-06, S3-UP-10)

const zipCard = (page: import('@playwright/test').Page, lang: 'en' | 'az') =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: T(lang)('CVs'), exact: true }) });
async function chooseHere(
  page: import('@playwright/test').Page,
  lang: 'en' | 'az',
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    zipCard(page, lang)
      .getByRole('button', { name: T(lang)('Choose files'), exact: true })
      .click(),
  ]);
  await fc.setFiles(files);
}
async function startHere(page: import('@playwright/test').Page, lang: 'en' | 'az') {
  const c = zipCard(page, lang);
  const box = c.getByRole('checkbox');
  if (await box.count()) await box.check();
  await c.locator('button.h-11').click();
}
const zipOfCvs = async (prefix: string, n: number) => {
  const JSZip = (await import('jszip')).default;
  const z = new JSZip();
  for (let i = 0; i < n; i++)
    z.file(
      `${prefix}-${i}.txt`,
      `Name: ${prefix} Person ${i}\nBGP routing.\n${'Network operations. '.repeat(8)}`,
    );
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

uat(
  'UP-19',
  'Three ZIPs go one at a time while loose files keep going (S3-UP-06)',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const a = accounts().recruiter;
    const token = await login(a);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Three ZIPs'),
      jd: jd(['BGP routing'], ['Python scripting']),
    });
    await openAs(page, a, `#/vacancies/${v.id}`);
    let zipsNow = 0;
    let zipPeak = 0;
    let all = 0;
    let allPeak = 0;
    const zipItems = new Set<string>();
    await page.route('**/documents?item=*', async (route) => {
      const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
      const zip = body.includes(Buffer.from('.zip"'));
      all++;
      allPeak = Math.max(allPeak, all);
      if (zip) {
        zipsNow++;
        zipPeak = Math.max(zipPeak, zipsNow);
        zipItems.add(route.request().url());
        await sleep(800);
      }
      await route.continue().catch(() => undefined);
      all--;
      if (zip) zipsNow--;
    });
    const files = [
      { name: 'one.zip', mimeType: 'application/zip', buffer: await zipOfCvs('Zone', 3) },
      { name: 'two.zip', mimeType: 'application/zip', buffer: await zipOfCvs('Ztwo', 3) },
      { name: 'three.zip', mimeType: 'application/zip', buffer: await zipOfCvs('Zthree', 3) },
      ...textCvs(uniq('Loose'), 4).map((f) => ({
        name: f.name,
        mimeType: f.type,
        buffer: Buffer.from(f.data),
      })),
    ];
    await chooseHere(page, meta.lang, files);
    await startHere(page, meta.lang);
    await expect
      .poll(
        async () =>
          (
            await db<{ n: number }>(
              `SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL`,
              [v.id],
            )
          )[0]!.n,
        { timeout: 90_000 },
      )
      .toBe(13);
    expect(zipItems.size).toBe(3);
    expect(zipPeak, 'never more than one ZIP request in flight').toBe(1);
    expect(allPeak, 'never more than three requests in all').toBeLessThanOrEqual(3);
    await ux.check('all sent', STD);
  },
);

uat(
  'UP-21',
  'ZIP problems reported file by file: cannot be opened, one unreadable file, a file over 10 MB, more than 1,000 files (S3-UP-06)',
  { on: ['D'], timeout: 240_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const a = accounts().recruiter;
    const token = await login(a);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT ZIP problems'),
      jd: jd(['BGP routing'], ['Python scripting']),
    });
    await openAs(page, a, `#/vacancies/${v.id}`);
    // 1) A ".zip" that is not one; 2) a ZIP whose second file cannot be read.
    const notZip = Buffer.concat([
      Buffer.from('PK\x03\x04'),
      Buffer.from('not a zip at all, '.repeat(20)),
    ]);
    const spoilt = await zipOfCvs('Spoil', 3);
    const at = spoilt.indexOf(Buffer.from('Spoil-1.txt')) + 'Spoil-1.txt'.length;
    for (let k = 0; k < 12; k++) spoilt[at + k] = 0xff;
    const files = [
      { name: 'broken.zip', mimeType: 'application/zip', buffer: notZip },
      { name: 'spoilt.zip', mimeType: 'application/zip', buffer: spoilt },
      { name: 'oversize.zip', mimeType: 'application/zip', buffer: FILES.oversizeZip() },
      { name: 'too-many.zip', mimeType: 'application/zip', buffer: FILES.tooManyZip() },
    ];
    await chooseHere(page, meta.lang, files);
    await startHere(page, meta.lang);
    const items = async () =>
      db<{ filename: string; outcome: string | null; code: string | null }>(
        `SELECT i.filename, i.outcome, i.code FROM upload_item i JOIN upload_batch b ON b.id = i.batch_id
          WHERE b.vacancy_id = $1 ORDER BY i.parent_item_id NULLS FIRST, i.position`,
        [v.id],
      );
    await expect
      .poll(
        async () => {
          const all = await items();
          return all.length >= 4 && all.every((i) => i.outcome) ? 'settled' : 'open';
        },
        { timeout: 200_000, intervals: [1000] },
      )
      .toBe('settled');
    const got = await items();
    const by = (name: string) => got.find((i) => i.filename === name);
    expect(by('broken.zip')).toMatchObject({ outcome: 'rejected', code: 'bad_zip' });
    expect(got.find((i) => i.filename.endsWith('Spoil-1.txt'))).toMatchObject({
      outcome: 'skipped',
      code: 'bad_zip_entry',
    });
    expect(got.find((i) => i.filename.endsWith('big.txt'))).toMatchObject({ code: 'too_large' });
    expect(got.filter((i) => i.code === 'too_many_entries')).toHaveLength(1);
    // The panel lists them file by file, in plain words.
    await page
      .getByRole('button', { name: t('Details') })
      .first()
      .click();
    await expect(page.getByText(t('The ZIP could not be opened')).first()).toBeVisible();
    await expect(
      page.getByText(t('A file inside the ZIP could not be read')).first(),
    ).toBeVisible();
    await ux.check('problems listed', STD);
  },
);
