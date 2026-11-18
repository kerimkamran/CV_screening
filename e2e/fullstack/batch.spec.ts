import type { Locator, Page } from '@playwright/test';
import { esc, jd, makeVacancy, T, textCvs } from '../fixtures/pkg-c';
import { sleep } from '../fixtures/pkg-i';
import { expect, STD, uat } from '../ux/test';
import {
  accounts,
  api,
  BASE,
  db,
  drain,
  freshAccount,
  holdAi,
  login,
  modelCalls,
  openAs,
  setFailMarkers,
  uniq,
} from './stack';

// 7.8 Batch processing (BP), full-stack journeys (L2): the upload queue and the waiting screen
// against the real API, with the browser's own sending (3 lanes, one resend, 401 pause).

type F = { name: string; type: string; data: Buffer | string };
const asFiles = (fs: F[]) =>
  fs.map((f) => ({ name: f.name, mimeType: f.type, buffer: Buffer.from(f.data) }));

const cvsCard = (page: Page, lang: 'en' | 'az') =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: T(lang)('CVs'), exact: true }) });

/** Choose files in the CVs card's own picker. */
async function choose(page: Page, lang: 'en' | 'az', files: ReturnType<typeof asFiles>) {
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    cvsCard(page, lang)
      .getByRole('button', { name: T(lang)('Choose files'), exact: true })
      .click(),
  ]);
  await fc.setFiles(files);
}

/** Files that reached the server for this vacancy (the upload item has an outcome). */
const received = async (vid: string) =>
  (
    await db<{ n: number }>(
      `SELECT count(*)::int AS n FROM upload_item i JOIN upload_batch b ON b.id = i.batch_id WHERE b.vacancy_id = $1 AND i.outcome IS NOT NULL`,
      [vid],
    )
  )[0]!.n;
const documents = async (vid: string) =>
  db<{ filename: string }>(
    `SELECT filename FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL ORDER BY filename`,
    [vid],
  );

/** Start the first batch of a vacancy from the page: notice, then the start button. */
async function startFromPage(page: Page, lang: 'en' | 'az') {
  const c = cvsCard(page, lang);
  const box = c.getByRole('checkbox');
  if (await box.count()) await box.check();
  await c.locator('button.h-11').click();
}

/** The sign-in form in the same tab (a new page load would lose the files this tab holds). */
async function signInHere(page: Page, a: { email: string; password: string }) {
  await page.getByLabel(/^(Email|E-poçt)$/).fill(a.email);
  await page
    .getByLabel(/^(Password|Parol)$/)
    .first()
    .fill(a.password);
  await page.getByRole('button', { name: /^(Sign in|Daxil olun)$/ }).click();
}

const progress = (page: Page | Locator, lang: 'en' | 'az', sent: number, total: number) =>
  page.getByText(T(lang)('Sent {sent} of {total}', { sent, total }), { exact: false }).first();

uat(
  'BP-12',
  'Session expiry (401) in the middle of sending: sending resumes after signing in again',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    ux.allow(/401|Failed to load resource/);
    const me = await freshAccount('TA_PARTNER', { name: 'Aysel Karimova' });
    const token = await login(me);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Session expiry'),
      jd: jd(['BGP routing'], ['Python scripting']),
    });
    const cvs = textCvs(uniq('Exp'), 15);
    await openAs(page, me, `#/vacancies/${v.id}`);
    // The proxy slows every upload a little, so the 5th file is received while others are in flight.
    await page.route('**/documents?item=*', async (route) => {
      await sleep(900);
      await route.continue().catch(() => undefined);
    });
    await choose(page, meta.lang, asFiles(cvs));
    await startFromPage(page, meta.lang);
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${v.id}/candidates$`));
    // 1) After 5 files are received, the server ends the recruiter's session.
    await expect.poll(() => received(v.id), { timeout: 60_000 }).toBeGreaterThanOrEqual(5);
    await db(
      `UPDATE local_credential SET session_version = session_version + 1 WHERE user_id = $1`,
      [me.userId],
    );
    const at = await received(v.id);
    // 2) The next upload answers 401: the sign-in card with the plain sentence.
    await expect(page.getByText(t('Your session ended. Please sign in again.'))).toBeVisible({
      timeout: 60_000,
    });
    await ux.check('session ended', STD);
    expect(await received(v.id), 'nothing more was accepted without a session').toBeLessThan(15);
    // Sign in again in the same tab.
    const polled: string[] = [];
    page.on('request', (r) => {
      if (/\/upload-batches\/\w+/.test(r.url())) polled.push(r.url());
    });
    await signInHere(page, me);
    // 3) The vacancy is shown again; the files the tab held go on without being chosen again.
    await expect(page.getByRole('heading', { level: 1, name: v.title })).toBeVisible();
    await expect.poll(() => received(v.id), { timeout: 90_000 }).toBe(15);
    await drain();
    // 4) Sent 15 of 15, and the screen reaches a finished headline (no 'Sending files: …').
    await expect(progress(page, meta.lang, 15, 15)).toBeVisible({ timeout: 90_000 });
    await expect(
      page.getByRole('heading', {
        name: new RegExp(
          esc(t('All {n} CVs are ready, {name}. Enjoy your coffee.', { n: 15, name: 'Aysel' })),
        ),
      }),
    ).toBeVisible({ timeout: 90_000 });
    await expect(
      page.getByText(
        new RegExp(
          esc(t('Sending files: {sent} of {total}.', { sent: 0, total: 0 }).split(':')[0]!),
        ),
      ),
    ).toHaveCount(0);
    expect(polled.length, 'batch polling restarted after signing in').toBeGreaterThan(0);
    // Each file arrived once, none was chosen again.
    const docs = await documents(v.id);
    expect(docs).toHaveLength(15);
    expect(new Set(docs.map((d) => d.filename)).size).toBe(15);
    expect(at, 'the session ended while the batch was still sending').toBeLessThan(15);
    await ux.check('finished', STD);
  },
);

uat(
  'BP-10',
  'Reload or another device during a batch: same picture, choose the missing files again',
  { on: ['D', 'A'] },
  async ({ page, ux, meta, browser }) => {
    const t = T(meta.lang);
    ux.allow(/Failed to load resource|net::ERR/);
    const me = await freshAccount('TA_PARTNER', { name: 'Aysel Karimova' });
    const token = await login(me);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Reload batch'),
      jd: jd(['BGP routing'], ['Python scripting']),
    });
    const cvs = textCvs(uniq('Rel'), 20);
    await openAs(page, me, `#/vacancies/${v.id}`);
    page.on('dialog', (d) => void d.accept());
    // The proxy lets 12 uploads through and holds the rest until the page is gone.
    let started = 0;
    let holding = true;
    await page.route('**/documents?item=*', async (route) => {
      if (!holding || started++ < 12) {
        await sleep(250);
        return route.continue().catch(() => undefined);
      }
      await new Promise(() => undefined);
    });
    await choose(page, meta.lang, asFiles(cvs));
    await startFromPage(page, meta.lang);
    await expect.poll(() => received(v.id), { timeout: 60_000 }).toBe(12);
    // 1) Reload.
    holding = false;
    await page.reload();
    // 2) The waiting screen is back with what the server knows.
    await expect(progress(page, meta.lang, 12, 20)).toBeVisible({ timeout: 30_000 });
    const notice = page.getByText(
      t('{n} files are not sent yet. Choose them again and only those are sent.', { n: 8 }),
    );
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await ux.check('after reload', [...STD, 'AZ']);
    // 3) Choose 3 of the 8 missing files and one that was never in the batch.
    const have = new Set((await documents(v.id)).map((d) => d.filename));
    const missing = cvs.filter((c) => !have.has(c.name));
    expect(missing).toHaveLength(8);
    const stranger = textCvs(uniq('Never'), 1)[0]!;
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/documents\?item=/.test(r.url())) posts.push(r.url());
    });
    const pick = async (p: Page, files: F[]) => {
      const [fc] = await Promise.all([
        p.waitForEvent('filechooser'),
        p.getByRole('button', { name: t('Choose files'), exact: true }).click(),
      ]);
      await fc.setFiles(asFiles(files));
    };
    await pick(page, [...missing.slice(0, 3), stranger]);
    await expect(
      page.getByText(
        t('{n} of the chosen files did not match a file that is waiting, so they were not sent.', {
          n: 1,
        }),
      ),
    ).toBeVisible();
    await expect.poll(() => received(v.id), { timeout: 60_000 }).toBe(15);
    expect(posts, 'exactly the 3 matching files were sent').toHaveLength(3);
    await ux.check('3 chosen', [...STD, 'AZ']);
    // 4) A second browser context as the same recruiter shows the same numbers.
    const ctx = await browser.newContext({ baseURL: BASE, viewport: page.viewportSize()! });
    const p2 = await ctx.newPage();
    await p2.addInitScript((lang) => localStorage.setItem('cv-lang', lang), meta.lang);
    await openAs(p2, me, `#/vacancies/${v.id}/candidates`);
    await expect(progress(p2, meta.lang, 15, 20)).toBeVisible({ timeout: 30_000 });
    await expect(
      p2.getByText(
        t('{n} files are not sent yet. Choose them again and only those are sent.', { n: 5 }),
      ),
    ).toBeVisible();
    // 5) The other 5 missing files there; both contexts reach 20 of 20.
    const posts2: string[] = [];
    p2.on('request', (r) => {
      if (r.method() === 'POST' && /\/documents\?item=/.test(r.url())) posts2.push(r.url());
    });
    await pick(p2, missing.slice(3));
    await expect.poll(() => received(v.id), { timeout: 60_000 }).toBe(20);
    await drain();
    expect(posts2).toHaveLength(5);
    const done = (p: Page) =>
      p
        .getByText(t('Analyzed {done} of {total}', { done: 20, total: 20 }), { exact: false })
        .first();
    await expect(done(p2)).toBeVisible({ timeout: 60_000 });
    await ux.check('second context done', STD);
    await ctx.close();
    // The first tab was left alone: it follows the batch by itself and reaches 20 of 20 too.
    await expect(done(page)).toBeVisible({ timeout: 60_000 });
    const docs = await documents(v.id);
    expect(docs).toHaveLength(20);
    expect(new Set(docs.map((d) => d.filename)).size, 'no file was uploaded twice').toBe(20);
  },
);

/** Let a CV that the fake AI refuses use up its 3 attempts now instead of after 30 s and 60 s. */
async function failFast(vid: string, filename: string) {
  for (let i = 0; i < 80; i++) {
    const st = await db<{ state: string }>(
      `SELECT s.state::text AS state FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1 AND d.filename = $2 ORDER BY s.id DESC LIMIT 1`,
      [vid, filename],
    );
    if (st[0]?.state === 'failed') return;
    await db(
      `UPDATE screening SET run_after = now() WHERE state = 'queued' AND document_id IN (SELECT id FROM cv_document WHERE vacancy_id = $1 AND filename = $2)`,
      [vid, filename],
    );
    await drain();
    await sleep(400);
  }
  throw new Error(`${filename} did not reach 'failed'`);
}

/** How many times the fake AI was asked about each person ("Name: <prefix> Person n"). */
async function callsByName(prefix: string) {
  const out = new Map<string, number>();
  for (const c of await modelCalls()) {
    const m = new RegExp(`Name: (${esc(prefix)} Person \\d+)`).exec(c.user);
    if (m) out.set(m[1]!, (out.get(m[1]!) ?? 0) + 1);
  }
  return out;
}

/** Ten CVs: 8 plain, one the fake AI refuses, one whose upload the proxy cuts. */
function faultyBatch(prefix: string) {
  const plain = textCvs(prefix, 8);
  const slug = prefix.toLowerCase().replace(/\W+/g, '-');
  const model: F = {
    name: `${slug}-model.txt`,
    type: 'text/plain',
    data: `Name: ${prefix} Person 9\nUATFAIL-${slug}\nBGP routing on the core.\n${'Worked on network operations. '.repeat(6)}`,
  };
  const net: F = {
    name: `${slug}-net.txt`,
    type: 'text/plain',
    data: `Name: ${prefix} Person 10\nBGP routing on the core.\n${'Worked on network operations. '.repeat(7)}`,
  };
  return { files: [...plain, model, net], model, net, marker: `UATFAIL-${slug}` };
}

uat(
  'BP-09',
  'Retry failed (n) and row Retry: server retry and resend from this tab, no new AI calls for finished CVs',
  { on: ['D'], timeout: 360_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    ux.allow(/Failed to load resource|net::ERR|40\d/);
    const me = await freshAccount('TA_PARTNER', { name: 'Aysel Karimova' });
    const token = await login(me);
    const v = await makeVacancy(BASE, token, {
      title: uniq('UAT Retry failed'),
      jd: jd(['BGP routing'], ['Python scripting']),
    });
    const prefix1 = uniq('Ret');
    const one = faultyBatch(prefix1);
    await openAs(page, me, `#/vacancies/${v.id}`);
    let cutNet = one.net.name;
    await page.route('**/documents?item=*', async (route) => {
      if ((route.request().postData() ?? '').includes(cutNet)) return route.abort('failed');
      await route.continue().catch(() => undefined);
    });
    const posts: { url: string; body: unknown }[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'POST') return;
      if (/\/documents\?item=/.test(r.url()) || /\/retry-failed$/.test(r.url()))
        posts.push({ url: r.url(), body: /retry-failed/.test(r.url()) ? r.postDataJSON() : null });
    });
    try {
      await setFailMarkers([one.marker]);
      // 1) Start; wait until the rest are analyzed.
      await choose(page, meta.lang, asFiles(one.files));
      await startFromPage(page, meta.lang);
      await expect(page).toHaveURL(new RegExp(`#/vacancies/${v.id}/candidates$`));
      await failFast(v.id, one.model.name);
      await drain();
      await expect(
        page.getByRole('heading', {
          name: new RegExp(
            esc(
              t('{ready} of {total} CVs are ready, {name}.', {
                ready: 8,
                total: 10,
                name: 'Aysel',
              }),
            ),
          ),
        }),
      ).toBeVisible({ timeout: 90_000 });
      const retryAll = page.getByRole('button', { name: t('Retry failed ({n})', { n: 2 }) });
      await expect(retryAll).toBeVisible();
      // 2) Details, then 'Needs attention 2'.
      await page
        .getByRole('button', { name: t('Details'), exact: true })
        .first()
        .click();
      await page.getByRole('button', { name: t('Needs attention {n}', { n: 2 }) }).click();
      const list = page.locator(`section[aria-label="${t('Details')}"] li`);
      await expect(list).toHaveCount(2);
      const rowNet = list.filter({ hasText: t('Could not send') });
      const rowModel = list.filter({ hasText: t('Analysis failed') });
      await expect(rowNet).toHaveCount(1);
      await expect(rowModel).toHaveCount(1);
      await ux.check('needs attention', [...STD, 'AZ']);
      const before = await callsByName(prefix1);
      expect([...before.keys()].length, 'the 8 plain CVs were read').toBeGreaterThanOrEqual(8);
      // 3) Retry on the 'Could not send' row: the proxy lets it through now; one POST from this tab.
      cutNet = '\u0000never';
      posts.length = 0;
      await rowNet.getByRole('button', { name: t('Retry'), exact: true }).click();
      await expect
        .poll(() => posts.filter((p) => /\/documents\?item=/.test(p.url)).length, {
          timeout: 30_000,
        })
        .toBe(1);
      const item = await db<{ id: string }>(
        `SELECT i.id FROM upload_item i JOIN upload_batch b ON b.id = i.batch_id WHERE b.vacancy_id = $1 AND i.filename = $2`,
        [v.id, one.net.name],
      );
      expect(posts[0]!.url).toContain(`item=${item[0]!.id}`);
      expect(posts.filter((p) => /retry-failed/.test(p.url))).toHaveLength(0);
      await expect.poll(() => received(v.id), { timeout: 30_000 }).toBe(10);
      // 4) Retry on the 'Analysis failed' row: the fake AI reads it now; POST retry-failed with ids.
      await setFailMarkers([]);
      posts.length = 0;
      await page.getByRole('button', { name: t('Needs attention {n}', { n: 1 }) }).click();
      await list
        .filter({ hasText: t('Analysis failed') })
        .getByRole('button', { name: t('Retry'), exact: true })
        .click();
      await expect.poll(() => posts.filter((p) => /retry-failed/.test(p.url)).length).toBe(1);
      const doc = await db<{ id: string }>(
        `SELECT id FROM cv_document WHERE vacancy_id = $1 AND filename = $2`,
        [v.id, one.model.name],
      );
      const batchId = (
        await db<{ id: string }>(
          `SELECT id FROM upload_batch WHERE vacancy_id = $1 ORDER BY id LIMIT 1`,
          [v.id],
        )
      )[0]!.id;
      expect(posts.find((p) => /retry-failed/.test(p.url))!.body).toEqual({
        batchId,
        documentId: doc[0]!.id,
      });
      await drain();
      const doneCount = async () =>
        (
          await db<{ n: number }>(
            `SELECT count(*)::int AS n FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1 AND s.state = 'completed'`,
            [v.id],
          )
        )[0]!.n;
      await expect.poll(doneCount, { timeout: 60_000 }).toBe(10);
      // No new call for the 8 CVs that were already analyzed.
      const after = await callsByName(prefix1);
      for (const [name, n] of before) {
        if (/Person (9|10)$/.test(name)) continue;
        expect(after.get(name), `no new model call for ${name}`).toBe(n);
      }
      await expect(
        page.getByRole('heading', {
          name: new RegExp(
            esc(t('All {n} CVs are ready, {name}. Enjoy your coffee.', { n: 10, name: 'Aysel' })),
          ),
        }),
      ).toBeVisible({ timeout: 60_000 });
      await ux.check('all 10', [...STD, 'AZ']);
      // 5) A new batch with the same faults, then 'Retry failed (2)' on the waiting screen.
      const prefix2 = uniq('Ret');
      const two = faultyBatch(prefix2);
      cutNet = two.net.name;
      await setFailMarkers([two.marker]);
      await page.evaluate((id) => (window.location.hash = `#/vacancies/${id}`), v.id);
      const card = cvsCard(page, meta.lang);
      if (!(await card.getByRole('button', { name: t('Choose files'), exact: true }).isVisible()))
        await page.getByRole('button', { name: t('Role and CVs') }).click();
      await choose(page, meta.lang, asFiles(two.files));
      await startFromPage(page, meta.lang);
      await expect(page).toHaveURL(new RegExp(`#/vacancies/${v.id}/candidates$`));
      await failFast(v.id, two.model.name);
      await drain();
      const retry2 = page.getByRole('button', { name: t('Retry failed ({n})', { n: 2 }) });
      await expect(retry2).toBeVisible({ timeout: 90_000 });
      await setFailMarkers([]);
      cutNet = '\u0000never';
      posts.length = 0;
      await retry2.click();
      await expect.poll(() => posts.filter((p) => /retry-failed/.test(p.url)).length).toBe(1);
      const batch2 = (
        await db<{ id: string }>(
          `SELECT id FROM upload_batch WHERE vacancy_id = $1 ORDER BY id DESC LIMIT 1`,
          [v.id],
        )
      )[0]!.id;
      expect(posts.find((p) => /retry-failed/.test(p.url))!.body).toEqual({ batchId: batch2 });
      await expect
        .poll(() => posts.filter((p) => /\/documents\?item=/.test(p.url)).length, {
          timeout: 30_000,
        })
        .toBe(1);
      await drain();
      await expect.poll(doneCount, { timeout: 90_000 }).toBe(20);
      await expect(
        page.getByRole('heading', {
          name: new RegExp(
            esc(t('All {n} CVs are ready, {name}. Enjoy your coffee.', { n: 10, name: 'Aysel' })),
          ),
        }),
      ).toBeVisible({ timeout: 60_000 });
      await ux.check('second batch done', [...STD, 'AZ']);
    } finally {
      await setFailMarkers([]);
    }
  },
);

uat(
  'BP-11',
  "A colleague's batch: plain 'Latest upload' section, no scene, no signals for the viewer",
  { on: ['D'], langs: 'EN' },
  async ({ page, ux, meta, browser }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const rec = await login(acc.recruiter);
    const v = await makeVacancy(BASE, rec, {
      title: uniq('UAT Colleague batch'),
      jd: jd(['BGP routing'], ['Python scripting']),
      start: true,
    });
    const cvs = textCvs(uniq('Col'), 20);
    // The recruiter's 20 CVs are sent and then held mid-read by the fake AI.
    await holdAi(true);
    try {
      const a = api(rec);
      const made = await a.post(`/vacancies/${v.id}/upload-batches`, {
        files: cvs.map((f) => ({ name: f.name, size: Buffer.byteLength(f.data) })),
      });
      expect(made.status).toBe(201);
      for (const [i, f] of cvs.entries()) {
        const up = await a.upload(
          `/vacancies/${v.id}/documents?item=${made.body.items[i].itemId}`,
          [f],
        );
        expect(up.status).toBeLessThan(300);
      }
      const batchId = made.body.batchId as string;
      // The recruiter's own screen, in a second context.
      const rctx = await browser.newContext({ baseURL: BASE, viewport: page.viewportSize()! });
      const rp = await rctx.newPage();
      await openAs(rp, acc.recruiter, `#/vacancies/${v.id}/candidates`);
      const line = (p: Page) => p.getByText(/^Sent \d+ of \d+/).first();
      await expect(line(rp)).toContainText('Sent 20 of 20');
      const recruiterLine = (await line(rp).innerText()).replace(/\s+/g, ' ');
      // 1) The lead opens the vacancy.
      await openAs(page, acc.lead, `#/vacancies/${v.id}/candidates`);
      const section = page.getByRole('region', { name: t('Latest upload') });
      await expect(section).toBeVisible();
      await expect(section.getByRole('heading', { level: 2 })).toHaveText(
        new RegExp(`^${esc(t('Latest upload'))} · .+ · ${esc(acc.recruiter.displayName)}$`),
      );
      // 2) The same numbers, no scene, no waiting-screen button, no Close.
      expect((await section.getByText(/^Sent \d+ of \d+/).innerText()).replace(/\s+/g, ' ')).toBe(
        recruiterLine,
      );
      await expect(page.getByTestId('coffeebay')).toHaveCount(0);
      await expect(page.getByRole('button', { name: t('Show the waiting screen') })).toHaveCount(0);
      await expect(page.getByRole('button', { name: t('Close'), exact: true })).toHaveCount(0);
      await ux.check('colleague batch', STD);
      const title0 = await page.title();
      const icon0 = await page.locator('link[rel~="icon"]').first().getAttribute('href');
      // 3) 'See results so far' opens the Candidates tab limited to that upload.
      const asked: string[] = [];
      page.on('request', (r) => {
        if (/\/candidates\?/.test(r.url())) asked.push(r.url());
      });
      await section.getByRole('button', { name: t('See results so far') }).click();
      await expect(page).toHaveURL(new RegExp(`#/vacancies/${v.id}/candidates$`));
      await expect
        .poll(() => asked.some((u) => u.includes(`batch=${batchId}`)), { timeout: 15_000 })
        .toBe(true);
      // 4) The batch finishes: the lead's tab title and icon never change.
      await holdAi(false);
      await drain();
      await expect(section.getByText(/^Sent \d+ of \d+/)).toContainText('Analyzed 20 of 20', {
        timeout: 60_000,
      });
      await expect(
        section.getByRole('button', { name: t('See results'), exact: true }),
      ).toBeVisible();
      expect(await page.title(), 'the lead tab title does not change').toBe(title0);
      expect(await page.locator('link[rel~="icon"]').first().getAttribute('href')).toBe(icon0);
      await expect(page.getByRole('button', { name: t('Close'), exact: true })).toHaveCount(0);
      await rctx.close();
    } finally {
      await holdAi(false);
    }
  },
);
