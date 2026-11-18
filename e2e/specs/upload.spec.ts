import { mkdirSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ulidOf } from '../fixtures/files';
import {
  esc,
  must,
  nice,
  onBackgrounds,
  pageScrollsSideways,
  pdf,
  reqs,
  smallTargets,
  T,
  vacApi,
  vview,
} from '../fixtures/pkg-c';
import { expect, STD, uat } from '../ux/test';

// 7.9 CVs card (upload) (UP), layer L1. UAT plan v1.1; each case is the row of the same ID.

const id = (n: number) => ulidOf('UPL', n);
/** The candidate notice (apps/web/src/pages/Vacancy.tsx NOTICE_TEXT). */
const NOTICE_TEXT = `Our recruitment team uses an AI-assisted tool to help read and compare applications against the requirements of the role. The tool produces a suggested ranking with the evidence behind it. It does not make decisions: every shortlisting or rejection decision is made by a member of our recruitment team, who reviews your application. You may ask us for a human review of your application, for access to your data, or for its deletion, by contacting HR.`;
const SKILLS = () => [must('BGP routing', 1), nice('Python scripting', 2)];
const cvs = (page: Page, lang: 'en' | 'az') =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: T(lang)('CVs'), exact: true }) });
const startBtn = (page: Page, lang: 'en' | 'az') =>
  cvs(page, lang)
    .locator('button')
    .filter({
      hasText: new RegExp(
        `^(${esc(T(lang)('Find the best fit →'))}|${esc(T(lang)('Re-analyze'))}|${esc(T(lang)('Starting…'))})$`,
      ),
    });
/** Choose files through the real 'Choose files' button and the browser's file chooser. */
async function choose(
  page: Page,
  lang: 'en' | 'az',
  button: string,
  files: Parameters<import('@playwright/test').FileChooser['setFiles']>[0],
) {
  const t = T(lang);
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    cvs(page, lang)
      .getByRole('button', { name: t(button), exact: true })
      .click(),
  ]);
  await fc.setFiles(files);
}
const summary = (page: Page) => page.getByTestId('check-summary');
/** The rows of the CVs card's file list(s): the file name of each row, in order. */
const rowNames = (page: Page, lang: 'en' | 'az') =>
  cvs(page, lang)
    .locator('ul.divide-y > li')
    .evaluateAll((lis) =>
      lis.map((li) => (li.querySelector('span > span') as HTMLElement | null)?.textContent ?? ''),
    );

uat(
  'UP-01',
  'CVs card before any file: usage line, drop zone, buttons, notice, start button, footers, 4 backgrounds',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await vacApi(page, {
      views: [vview({ id: id(1), title: 'UAT Upload card', requirements: SKILLS() })],
      extra: async (route, url) => {
        if (url.pathname !== `/vacancies/${id(1)}/intake`) return false;
        await new Promise((r) => setTimeout(r, 1000));
        await route.fulfill({
          json: {
            used: 0,
            limit: 500,
            maxFileMb: 10,
            maxZipMb: 100,
            accepts: ['.pdf', '.docx', '.txt', '.zip'],
            latestBatch: null,
          },
        });
        return true;
      },
    });
    await page.goto(`/#/vacancies/${id(1)}`);
    const c = cvs(page, meta.lang);
    await expect(c).toBeVisible();
    const usage = c.getByRole('status').first();
    await expect.soft(usage).toHaveText(t('No CVs in this vacancy yet.'));
    await expect(usage).toHaveText(
      t('{used} of {limit} CVs used in this vacancy', { used: 0, limit: 500 }),
      { timeout: 5000 },
    );
    await expect.soft(c.getByText(t('Drop CVs here'), { exact: true })).toBeVisible();
    const iphone = meta.dev === 'I';
    await expect
      .soft(
        c.getByText(
          t(
            iphone
              ? 'PDF, DOCX, TXT or MD files, or a ZIP of CVs'
              : 'PDF, DOCX, TXT or MD files, a whole folder, or a ZIP of CVs',
          ),
          { exact: true },
        ),
      )
      .toBeVisible();
    for (const b of ['Choose files', 'Add a ZIP'])
      await expect.soft(c.getByRole('button', { name: t(b), exact: true })).toBeVisible();
    await expect
      .soft(c.getByRole('button', { name: t('Choose a folder'), exact: true }))
      .toHaveCount(iphone ? 0 : 1);
    await expect.soft(c.getByText(t(NOTICE_TEXT))).toBeVisible();
    const tick = c.getByRole('checkbox', {
      name: new RegExp(
        `^${esc(t('I confirm that the candidates for this vacancy have been informed that AI is used to assist the screening of their applications, and how to request human review.').slice(0, 30))}`,
      ),
    });
    await expect.soft(tick).not.toBeChecked();
    const start = startBtn(page, meta.lang);
    await expect.soft(start).toHaveText(t('Find the best fit →'));
    expect
      .soft(Math.round((await start.boundingBox())!.height), 'start button 44 px tall')
      .toBe(44);
    for (const m of ['Add at least one CV.', 'Confirm the candidate notice.'])
      await expect.soft(c.getByText(t(m), { exact: true })).toBeVisible();
    for (const f of [
      'CVs are read by the AI provider your administrator has chosen.',
      'When you start, your browser may ask to show a notification when the CVs are ready.',
    ])
      await expect.soft(c.getByText(t(f), { exact: true })).toBeVisible();
    await ux.check('card', [...STD, 'AZ']);
    await onBackgrounds(page, meta.lang, async (bg) => {
      await ux.check(`background ${bg}`, [...STD, 'AZ']);
    });
  },
);

uat(
  'UP-02',
  'Choose files: check summary, rows, Remove, repeats and system files left out',
  { on: ['D', 'A'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    const { seen } = await vacApi(page, {
      views: [vview({ id: id(2), title: 'UAT Choose files', requirements: SKILLS() })],
    });
    // Files on disk, so a second choice of a.pdf is the same file (same time stamp), as in real life.
    const dir = info.outputPath('files');
    mkdirSync(dir, { recursive: true });
    const put = (name: string, bytes: number) => {
      const p = join(dir, name);
      writeFileSync(p, Buffer.alloc(bytes, 0x41));
      return p;
    };
    const files = [
      put('a.pdf', 120 * 1024),
      put('b.docx', 30 * 1024),
      put('c.txt', 2 * 1024),
      put('d.md', 1024),
      put('Thumbs.db', 512),
      put('.DS_Store', 256),
    ];
    await page.goto(`/#/vacancies/${id(2)}`);
    const c = cvs(page, meta.lang);
    await expect(c).toBeVisible();
    // 1) Six files.
    await choose(page, meta.lang, 'Choose files', files);
    await expect.soft(c.getByText(t('{n} system files left out.', { n: 2 }))).toBeVisible();
    await expect(summary(page)).toHaveText(
      `${t('{n} files', { n: 4 })} · 153 KB · ${t('{n} ready', { n: 4 })}`,
    );
    await expect.soft(summary(page)).toHaveAttribute('role', 'status');
    expect.soft(await rowNames(page, meta.lang)).toEqual(['a.pdf', 'b.docx', 'c.txt', 'd.md']);
    for (const n of ['a.pdf', 'b.docx', 'c.txt', 'd.md'])
      await expect
        .soft(c.getByRole('button', { name: t('Remove {name}', { name: n }) }))
        .toBeVisible();
    await expect.soft(c.locator('ul.divide-y > li').first()).toContainText('120 KB');
    await ux.check('4 files', [...STD, 'AZ']);
    // 2) a.pdf again.
    await choose(page, meta.lang, 'Choose files', [files[0]!]);
    await expect.soft(c.getByText(t('{n} repeat left out.', { n: 1 }))).toBeVisible();
    expect.soft((await rowNames(page, meta.lang)).length, 'still 4 rows').toBe(4);
    // 3) Remove c.txt.
    await c.getByRole('button', { name: t('Remove {name}', { name: 'c.txt' }) }).click();
    expect.soft(await rowNames(page, meta.lang)).toEqual(['a.pdf', 'b.docx', 'd.md']);
    await expect
      .soft(summary(page))
      .toHaveText(
        new RegExp(`^${esc(t('{n} files', { n: 3 }))} · .+ · ${esc(t('{n} ready', { n: 3 }))}$`),
      );
    expect
      .soft(
        seen.requests.filter((r) => r.method !== 'GET').map((r) => r.url),
        'nothing sent before the start button',
      )
      .toEqual([]);
    await ux.check('removed', [...STD, 'AZ']);
  },
);

uat(
  'UP-03',
  'Problem files flagged before sending: .doc, .exe, empty, over 10 MB, ZIP over 100 MB; Show all; Remove all',
  { on: ['D', 'A'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    const { seen } = await vacApi(page, {
      views: [vview({ id: id(3), title: 'UAT Problem files', requirements: SKILLS() })],
    });
    const dir = info.outputPath('files');
    mkdirSync(dir, { recursive: true });
    const put = (name: string, bytes: number) => {
      const p = join(dir, name);
      writeFileSync(p, bytes ? Buffer.from('%PDF-1.4\n') : Buffer.alloc(0));
      if (bytes) truncateSync(p, bytes); // sparse: big files cost nothing
      return p;
    };
    const good = [1, 2, 3, 4, 5].map((i) => put(`good-${i}.pdf`, 40 * 1024));
    const nine = [
      put('old.doc', 20 * 1024),
      put('virus.exe', 20 * 1024),
      put('empty.pdf', 0),
      put('big.pdf', 11 * 1024 * 1024),
      ...good,
    ];
    const huge = put('huge.zip', 101 * 1024 * 1024);
    await page.goto(`/#/vacancies/${id(3)}`);
    const c = cvs(page, meta.lang);
    await expect(c).toBeVisible();
    // 1) Nine files, then the ZIP.
    await choose(page, meta.lang, 'Choose files', nine);
    await choose(page, meta.lang, 'Add a ZIP', [huge]);
    // 2) The list.
    await expect(summary(page)).toHaveText(
      new RegExp(
        `^${esc(t('{n} files', { n: 10 }))} · .+ · ${esc(t('{n} ready', { n: 5 }))} · ${esc(t('{n} need attention', { n: 5 }))}$`,
      ),
    );
    expect
      .soft(await rowNames(page, meta.lang), 'only the problem rows by default')
      .toEqual(['old.doc', 'virus.exe', 'empty.pdf', 'big.pdf', 'huge.zip']);
    const msgs = [
      'Old Word format: save it as .docx or PDF',
      'Not a CV file type',
      'The file is empty',
      t('Over {n} MB', { n: 10 }),
      t('Over {n} MB', { n: 100 }),
    ];
    for (const [i, m] of msgs.entries())
      await expect.soft(c.locator('ul.divide-y > li').nth(i)).toContainText(i < 3 ? t(m) : m);
    await ux.check('problems', [...STD, 'AZ']);
    // 3) Show all, then only the problems.
    const showAll = c.getByRole('button', { name: t('Show all {n} files', { n: 10 }) });
    await expect.soft(showAll).toHaveAttribute('aria-expanded', 'false');
    await showAll.click();
    const onlyProblems = c.getByRole('button', {
      name: t('Show only the files that need attention'),
    });
    await expect.soft(onlyProblems).toHaveAttribute('aria-expanded', 'true');
    const all = await rowNames(page, meta.lang);
    expect.soft(all.length, 'all 10 rows, once').toBe(10);
    expect.soft(new Set(all).size).toBe(10);
    await onlyProblems.click();
    expect.soft((await rowNames(page, meta.lang)).length).toBe(5);
    // 4) Show all, then Remove all files that need attention (SD-75).
    await showAll.click();
    await c.getByRole('button', { name: t('Remove all files that need attention') }).click();
    const left = await rowNames(page, meta.lang);
    expect
      .soft(left.sort(), 'the 5 good rows, each listed exactly once')
      .toEqual(['good-1.pdf', 'good-2.pdf', 'good-3.pdf', 'good-4.pdf', 'good-5.pdf']);
    await ux.check('problems removed', [...STD, 'AZ']);
    // 5) Tick and start: only the 5 good files are announced.
    await c.getByRole('checkbox').check();
    await startBtn(page, meta.lang).click();
    await expect.poll(() => reqs(seen, 'POST', /upload-batches$/).length).toBe(1);
    const announced = (
      reqs(seen, 'POST', /upload-batches$/)[0]!.body as { files: { name: string }[] }
    ).files.map((f) => f.name);
    expect
      .soft(announced.sort())
      .toEqual(['good-1.pdf', 'good-2.pdf', 'good-3.pdf', 'good-4.pdf', 'good-5.pdf']);
  },
);

uat(
  'UP-04',
  'Drop files on the zone and choose a folder; drag-over highlight; reduced motion',
  { on: ['D', 'E'], langs: 'EN' },
  async ({ page, ux, info }) => {
    await vacApi(page, {
      views: [vview({ id: id(4), title: 'UAT Drop zone', requirements: SKILLS() })],
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`/#/vacancies/${id(4)}`);
    const c = cvs(page, 'en');
    const zone = c.locator('div.border-dashed').filter({ hasText: 'Drop CVs here' });
    await expect(zone).toBeVisible();
    const dt = () => page.evaluateHandle(() => new DataTransfer());
    // 1) dragover; 2) dragleave.
    await zone.dispatchEvent('dragover', { dataTransfer: await dt() });
    await expect.soft(zone).toHaveClass(/m-orbit/);
    await expect.soft(zone).toHaveClass(/border-accent/);
    await ux.shot('dragging');
    await zone.dispatchEvent('dragleave', { dataTransfer: await dt() });
    await expect.soft(zone).not.toHaveClass(/m-orbit/);
    // 3) Drop 3 PDFs.
    const three = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      for (const n of ['drop-1.pdf', 'drop-2.pdf', 'drop-3.pdf'])
        d.items.add(new File([`%PDF-1.4 ${n}`], n, { type: 'application/pdf' }));
      return d;
    });
    await zone.dispatchEvent('drop', { dataTransfer: three });
    await expect
      .poll(() => rowNames(page, 'en'))
      .toEqual(['drop-1.pdf', 'drop-2.pdf', 'drop-3.pdf']);
    await ux.check('dropped', STD);
    // 4) Choose a folder.
    const root = info.outputPath('cvs');
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(join(root, 'a.pdf'), '%PDF-1.4 a');
    writeFileSync(join(root, 'sub', 'b.docx'), 'PK docx b');
    writeFileSync(join(root, '.DS_Store'), 'x');
    await choose(page, 'en', 'Choose a folder', root);
    await expect
      .poll(() => rowNames(page, 'en'))
      .toEqual(expect.arrayContaining(['cvs/a.pdf', 'cvs/sub/b.docx']));
    await expect.soft(c.getByText('1 system file left out.')).toBeVisible();
    // 5) Reduced motion: nothing animates while dragging.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await zone.dispatchEvent('dragover', { dataTransfer: await dt() });
    await page.waitForTimeout(300);
    expect
      .soft(
        await page.evaluate(
          () => document.getAnimations().filter((a) => a.playState === 'running').length,
        ),
        'animations while dragging',
      )
      .toBe(0);
    await ux.check('dragging, reduced motion', [...STD, 'RM']);
    await zone.dispatchEvent('dragleave', { dataTransfer: await dt() });
    // 6) Forced colours: the zone border uses Highlight.
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await zone.dispatchEvent('dragover', { dataTransfer: await dt() });
    await expect(zone).toHaveClass(/m-orbit/);
    await page.waitForTimeout(600); // the zone's colour transition (transition-colors) runs even with reduced motion
    const [border, highlight] = await zone.evaluate((z) => {
      const probe = document.createElement('span');
      probe.style.color = 'Highlight';
      document.body.append(probe);
      const h = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(z).borderTopColor, h];
    });
    expect.soft(border, 'forced colours: Highlight border').toBe(highlight);
    await ux.shot('forced colours');
  },
);

uat(
  'UP-05',
  'A file dropped outside the CVs card does not leave the app; leaving while files send is warned',
  { on: ['D', 'E'], langs: 'EN' },
  async ({ page, ux }) => {
    const v = vview({
      id: id(5),
      title: 'UAT Drop outside',
      requirements: SKILLS(),
      candidateNoticeConfirmedAt: new Date().toISOString(),
    });
    await vacApi(page, {
      views: [v],
      extra: async (route, url, method) => {
        if (method !== 'POST' || !/\/documents$/.test(url.pathname)) return false;
        await new Promise((r) => setTimeout(r, 10_000)); // held open
        await route.fulfill({ status: 201, json: { ok: true } }).catch(() => undefined);
        return true;
      },
    });
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.type());
      void d.dismiss().catch(() => undefined);
    });
    await page.goto(`/#/vacancies/${v.id}`);
    const url0 = page.url();
    /**
     * A real file dropped on a page goes to the browser (which opens it, leaving the app) unless the
     * page cancels dragover and drop there. Playwright cannot drag a real file in, so the test sends
     * cancelable events and reads whether the app cancelled them (defaultPrevented).
     */
    const dropOn = async (target: import('@playwright/test').Locator) =>
      target.evaluate((el) => {
        const d = new DataTransfer();
        d.items.add(new File(['%PDF-1.4 outside'], 'outside.pdf', { type: 'application/pdf' }));
        const over = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: d,
        });
        el.dispatchEvent(over);
        const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: d });
        el.dispatchEvent(drop);
        return { over: over.defaultPrevented, drop: drop.defaultPrevented };
      });
    // 1) On the Role card heading.
    const r1 = await dropOn(page.getByRole('heading', { level: 2, name: 'The role' }));
    expect
      .soft(r1, 'a drop on the Role card is kept inside the app')
      .toEqual({ over: true, drop: true });
    expect.soft(page.url()).toBe(url0);
    // 2) Three files, start.
    await choose(page, 'en', 'Choose files', [pdf('s1.pdf'), pdf('s2.pdf'), pdf('s3.pdf')]);
    await startBtn(page, 'en').click();
    await expect(page).toHaveURL(/\/candidates$/);
    // 3) While sending: the page header and the tabs.
    const r2 = await dropOn(page.locator('header').first());
    const r3 = await dropOn(page.getByRole('tablist', { name: 'Vacancy views' }));
    expect
      .soft(r2, 'a drop on the header is kept inside the app')
      .toEqual({ over: true, drop: true });
    expect
      .soft(r3, 'a drop on the tabs is kept inside the app')
      .toEqual({ over: true, drop: true });
    await ux.check('sending', STD);
    // 4) Reload while sending: a beforeunload prompt.
    await page.reload({ timeout: 5000 }).catch(() => undefined);
    expect.soft(dialogs, 'a leave prompt while files are still sending').toContain('beforeunload');
    ux.allow(/documents/);
  },
);

uat(
  'UP-06',
  'More than 100 CVs: non-blocking recommendation, collapsed list',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await vacApi(page, {
      views: [
        vview({
          id: id(6),
          title: 'UAT Many CVs',
          requirements: SKILLS(),
          candidateNoticeConfirmedAt: new Date().toISOString(),
        }),
      ],
    });
    await page.goto(`/#/vacancies/${id(6)}`);
    const c = cvs(page, meta.lang);
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => pdf(`cv-${String(i + 1).padStart(3, '0')}.pdf`, 2));
    // 1) 120 files.
    await choose(page, meta.lang, 'Choose files', many(120));
    await expect(summary(page)).toHaveText(
      new RegExp(`^${esc(t('{n} files', { n: 120 }))} · .+ · ${esc(t('{n} ready', { n: 120 }))}$`),
    );
    const warn = c.getByText(
      t(
        'You chose {n} CVs. Up to {rec} per upload is recommended so results arrive sooner. You can still send all of them.',
        { n: 120, rec: 100 },
      ),
    );
    await expect.soft(warn).toBeVisible();
    await expect.soft(startBtn(page, meta.lang)).toHaveAttribute('aria-disabled', 'false');
    await expect.soft(startBtn(page, meta.lang)).toBeEnabled();
    expect.soft((await rowNames(page, meta.lang)).length, 'collapsed').toBe(0);
    await ux.check('120 files', [...STD, 'AZ']);
    // 2) Show all 120 files: the list scrolls in its own box.
    const h0 = await page.evaluate(() => document.documentElement.scrollHeight);
    await c.getByRole('button', { name: t('Show all {n} files', { n: 120 }) }).click();
    const box = c.locator('ul').first();
    await expect(box.locator('li')).toHaveCount(120);
    const b = await box.evaluate((u) => ({
      h: u.getBoundingClientRect().height,
      scroll: u.scrollHeight > u.clientHeight,
      oy: getComputedStyle(u).overflowY,
    }));
    expect.soft(b.h, 'box at most 256 px').toBeLessThanOrEqual(256.5);
    expect.soft(b.scroll && /auto|scroll/.test(b.oy), 'the box scrolls').toBe(true);
    const h1 = await page.evaluate(() => document.documentElement.scrollHeight);
    expect.soft(h1 - h0, 'the page grows by the box, not 120 rows').toBeLessThan(300);
    await box.evaluate((u) => u.scrollTo(0, u.scrollHeight));
    await ux.check('list open', [...STD, 'AZ']);
    // 3) 100 files: no warning.
    await page.reload();
    await choose(page, meta.lang, 'Choose files', many(100));
    await expect(summary(page)).toHaveText(new RegExp(`^${esc(t('{n} files', { n: 100 }))}`));
    await expect
      .soft(c.getByText(t('Up to {rec} per upload is recommended', { rec: 100 }).slice(0, 10)))
      .toHaveCount(0);
    await expect
      .soft(
        c
          .getByRole('status')
          .filter({ hasText: /100/ })
          .filter({
            hasText: new RegExp(
              esc(
                t(
                  'You chose {n} CVs. Up to {rec} per upload is recommended so results arrive sooner. You can still send all of them.',
                  { n: 100, rec: 100 },
                ).slice(0, 12),
              ),
            ),
          }),
      )
      .toHaveCount(0);
  },
);

uat(
  'UP-08',
  'A folder of more than 5,000 files is cut at 5,000 with a warning',
  { on: ['D'] },
  async ({ page, ux, meta, info }) => {
    const t = T(meta.lang);
    await vacApi(page, {
      views: [vview({ id: id(8), title: 'UAT Big folder', requirements: SKILLS() })],
    });
    await page.goto(`/#/vacancies/${id(8)}`);
    await expect(
      cvs(page, meta.lang).getByRole('button', { name: t('Choose a folder'), exact: true }),
    ).toBeVisible();
    // Handing 5,005 real files through Playwright's file chooser takes minutes here, so the folder is
    // built in the page: 5,005 File objects with their folder path, set on the folder input and sent
    // as the 'change' event the browser fires after a folder is picked.
    const t0 = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]')!;
      const dt = new DataTransfer();
      for (let i = 1; i <= 5005; i++) {
        const f = new File(
          [`Name: Person ${i}\nBGP routing.`],
          `cv-${String(i).padStart(4, '0')}.txt`,
          { type: 'text/plain' },
        );
        Object.defineProperty(f, 'webkitRelativePath', { value: `big/${f.name}` });
        dt.items.add(f);
      }
      input.files = dt.files;
      const start = performance.now();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return start;
    });
    await expect(summary(page)).toBeVisible({ timeout: 30_000 });
    const took = await page.evaluate((s0) => performance.now() - s0, t0);
    await expect
      .soft(
        page.getByText(
          t(
            'The folder is very large, so only the first {n} files were read. Choose a smaller folder for the rest.',
            { n: 5000 },
          ),
        ),
      )
      .toBeVisible();
    await expect
      .soft(summary(page))
      .toHaveText(new RegExp(`^${esc(t('{n} files', { n: 5000 }))} · `));
    expect.soft(took, 'summary within 5 s').toBeLessThan(5000);
    // Responsive: a click is answered at once.
    const r0 = Date.now();
    await cvs(page, meta.lang).getByRole('checkbox').click({ timeout: 5000 });
    await expect(cvs(page, meta.lang).getByRole('checkbox')).toBeChecked({ timeout: 3000 });
    expect.soft(Date.now() - r0, 'the page stays responsive').toBeLessThan(3000);
    await ux.check('cut at 5000', [...STD, 'AZ']);
    info.annotations.push({
      type: 'note',
      description: `summary after ${took} ms (includes Playwright handing over 5,005 files)`,
    });
  },
);

uat(
  'UP-09',
  'Start gating: missing-step list, aria-disabled button does nothing, notice confirmed earlier',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const now = new Date().toISOString();
    const { seen } = await vacApi(page, {
      views: [
        vview({ id: id(91), title: 'UAT Gate A', requirements: SKILLS() }),
        vview({ id: id(92), title: 'UAT Gate B', requirements: [] }),
        vview({ id: id(93), title: 'UAT Gate C', requirements: SKILLS() }),
        vview({ id: id(94), title: 'UAT Gate D', requirements: SKILLS() }),
        vview({ id: id(95), title: 'UAT Gate E', requirements: SKILLS() }),
        vview({
          id: id(96),
          title: 'UAT Gate F',
          requirements: SKILLS(),
          candidateNoticeConfirmedAt: now,
        }),
      ],
    });
    page.on('dialog', (d) => void d.accept().catch(() => undefined));
    const c = cvs(page, meta.lang);
    const list = c.locator('ul[role=status]');
    const look = () =>
      startBtn(page, meta.lang).evaluate((b) => {
        const s = getComputedStyle(b);
        return { bg: s.backgroundColor, opacity: s.opacity, cursor: s.cursor };
      });
    const open = async (n: number) => {
      await page.goto(`/#/vacancies/${id(n)}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/UAT Gate/);
      await page.reload();
      await expect(c).toBeVisible();
    };
    const tick = () => c.getByRole('checkbox').check();
    const add = () => choose(page, meta.lang, 'Choose files', [pdf(`gate-${Date.now()}.pdf`)]);
    // E first: the ready look, for comparison.
    await open(95);
    await add();
    await tick();
    await expect.soft(list).toHaveCount(0);
    const ready = await look();
    await ux.shot('E ready');
    const starts = () => reqs(seen, 'POST', /\/start$/).length;
    const gated: [number, string, () => Promise<void>][] = [
      [
        91,
        'Save the role first.',
        async () => {
          await add();
          await tick();
          await card(page)
            .getByLabel(new RegExp(`^${esc(t('Requirements'))}`))
            .fill('Unsaved words here.');
        },
      ],
      [
        92,
        'Add at least one skill on the role card.',
        async () => {
          await add();
          await tick();
        },
      ],
      [
        93,
        'Add at least one CV.',
        async () => {
          await tick();
        },
      ],
      [
        94,
        'Confirm the candidate notice.',
        async () => {
          await add();
        },
      ],
    ];
    for (const [n, msg, prep] of gated) {
      await open(n);
      await prep();
      await expect.soft(list.getByText(t(msg), { exact: true }), msg).toBeVisible();
      await expect.soft(startBtn(page, meta.lang)).toHaveAttribute('aria-disabled', 'true');
      const l = await look();
      expect
        .soft(
          l.opacity !== ready.opacity || l.bg !== ready.bg || l.cursor === 'not-allowed',
          `${msg}: the button looks disabled (${JSON.stringify(l)} vs ready ${JSON.stringify(ready)})`,
        )
        .toBe(true);
      await ux.check(`gated: ${msg}`, [...STD, 'AZ']);
      const s0 = starts();
      await startBtn(page, meta.lang).click({ force: true }); // aria-disabled: Playwright would wait for it to be enabled
      await page.waitForTimeout(300);
      expect.soft(starts(), `${msg}: a press sends nothing`).toBe(s0);
    }
    // E: a press sends POST /start.
    await open(95);
    await add();
    await tick();
    const s0 = starts();
    await startBtn(page, meta.lang).click();
    await expect.poll(starts).toBe(s0 + 1);
    // F: notice confirmed earlier: no notice box.
    await open(96);
    await expect.soft(c.getByRole('checkbox')).toHaveCount(0);
    await expect.soft(c.getByText(t(NOTICE_TEXT))).toHaveCount(0);
    await ux.check('F', [...STD, 'AZ']);
  },
);
const card = (page: Page) =>
  page
    .locator('section')
    .filter({ has: page.locator('h2') })
    .first();

uat(
  'UP-12',
  'Notification permission is asked once inside the start click on desktop, never on phones',
  { on: ['D', 'E', 'A', 'I'], langs: 'EN' },
  async ({ page, ux, meta, context }) => {
    const stub = (perm: string) => {
      const log: string[] = [];
      (window as unknown as { uatLog: string[] }).uatLog = log;
      const N = function () {} as unknown as {
        permission: string;
        requestPermission: () => Promise<string>;
      };
      N.permission = perm;
      N.requestPermission = () => {
        log.push('requestPermission');
        return Promise.resolve('granted');
      };
      Object.defineProperty(window, 'Notification', {
        value: N,
        configurable: true,
        writable: true,
      });
      const f = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (/\/start$/.test(u)) log.push('fetch /start');
        return f(input, init);
      };
    };
    const run = async (p: Page, perm: string) => {
      await p.addInitScript(stub, perm);
      await vacApi(p, {
        views: [vview({ id: id(120), title: 'UAT Notify', requirements: SKILLS() })],
      });
      await p.goto('/#/vacancies');
      await p.evaluate(() => localStorage.removeItem('cv-coffeebay-asked'));
      await p.goto(`/#/vacancies/${id(120)}`);
      const start = async () => {
        await choose(p, 'en', 'Choose files', [pdf(`n-${Date.now()}.pdf`)]);
        const box = cvs(p, 'en').getByRole('checkbox');
        if (await box.count()) await box.check();
        await startBtn(p, 'en').click();
        await expect(p).toHaveURL(/\/candidates$/);
      };
      await start();
      const first = await p.evaluate(() => [...(window as unknown as { uatLog: string[] }).uatLog]);
      // 2) A second batch.
      const fold = p.getByRole('button', { name: 'Role and CVs' });
      if (await fold.count()) await fold.click();
      await start();
      const second = await p.evaluate(() => [
        ...(window as unknown as { uatLog: string[] }).uatLog,
      ]);
      return {
        first,
        second,
        asked: await p.evaluate(() => localStorage.getItem('cv-coffeebay-asked')),
      };
    };
    const desktop = meta.dev === 'D' || meta.dev === 'E';
    const a = await run(page, 'default');
    const calls = (l: string[]) => l.filter((x) => x === 'requestPermission').length;
    if (desktop) {
      expect.soft(calls(a.first), 'asked once').toBe(1);
      expect
        .soft(
          a.first.indexOf('requestPermission') < a.first.indexOf('fetch /start'),
          `asked before POST /start (${a.first.join(', ')})`,
        )
        .toBe(true);
      expect.soft(a.asked).toBe('1');
      expect.soft(calls(a.second), 'not asked again for the second batch').toBe(1);
    } else {
      expect.soft(calls(a.second), 'never asked on a phone').toBe(0);
    }
    await ux.check('started', ['OCC']);
    // B: permission denied: never asked.
    const p2 = await context.newPage();
    const flush = ux.watch(p2);
    const b = await run(p2, 'denied');
    expect.soft(calls(b.second), 'never asked when denied').toBe(0);
    flush();
    await p2.close();
  },
);

uat(
  'UP-13',
  'Start errors from the server are shown; no batch after a failed start; files kept',
  { on: ['D'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const answers = [
      [409, 'Restore this vacancy first'],
      [400, 'Confirm the candidate notice first'],
      [400, 'Add at least one skill first'],
    ] as const;
    let n = 0;
    const { seen } = await vacApi(page, {
      views: [vview({ id: id(130), title: 'UAT Start errors', requirements: SKILLS() })],
      extra: async (route, url, method) => {
        if (method !== 'POST') return false;
        if (url.pathname.endsWith('/start')) {
          const a = answers[n++];
          if (a) await route.fulfill({ status: a[0], json: { statusCode: a[0], message: a[1] } });
          else await route.fulfill({ json: { queued: 0 } });
          return true;
        }
        if (url.pathname.endsWith('/upload-batches')) {
          await route.fulfill({
            status: 403,
            json: { statusCode: 403, message: 'You cannot change this vacancy' },
          });
          return true;
        }
        return false;
      },
    });
    ux.allow(/40[039]/);
    await page.goto(`/#/vacancies/${id(130)}`);
    const c = cvs(page, meta.lang);
    await choose(page, meta.lang, 'Choose files', [pdf('e1.pdf'), pdf('e2.pdf'), pdf('e3.pdf')]);
    await c.getByRole('checkbox').check();
    const msgs = [...answers.map((a) => a[1]), 'You cannot change this vacancy'];
    for (const [i, m] of msgs.entries()) {
      await startBtn(page, meta.lang).click();
      await expect.soft(c.getByRole('alert').filter({ hasText: t(m) }), m).toBeVisible();
      await expect.soft(startBtn(page, meta.lang)).toHaveText(t('Find the best fit →'));
      if (i < 3)
        expect.soft(reqs(seen, 'POST', /upload-batches$/).length, `no batch after: ${m}`).toBe(0);
      await ux.check(`error ${i + 1}`, [...STD, 'AZ']);
    }
    await expect.soft(page).not.toHaveURL(/\/candidates$/);
    await expect.soft(page.getByText(t('Started. The CVs are being read.'))).toHaveCount(0);
    await expect
      .soft(page.getByText(t('Hey {name}, go grab a coffee and relax.', { name: 'Ayla' })))
      .toHaveCount(0);
    await expect.soft(summary(page)).toHaveText(new RegExp(`^${esc(t('{n} files', { n: 3 }))}`));
  },
);

uat(
  'UP-14',
  'CVs card on tablets and phones with long Azerbaijani file names',
  { on: ['T', 'TL', 'A', 'I'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await vacApi(page, {
      views: [vview({ id: id(140), title: 'UAT Long names', requirements: SKILLS() })],
    });
    await page.goto(`/#/vacancies/${id(140)}`);
    const c = cvs(page, meta.lang);
    const long = (i: number) => {
      const base = `Məmmədova_Aysel_Şəmsəddin_qızı_Şəbəkə_mühəndisi_Gəncə_Sumqayıt_Lənkəran_Şəki_Quba_Xaçmaz_${i}_`;
      return `${base}${'ə'.repeat(Math.max(0, 120 - base.length - 12))}_CV_2026.pdf`;
    };
    const files = [1, 2, 3, 4, 5, 6].map((i) => pdf(long(i), 10));
    files.push({ name: 'boş.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
    await choose(page, meta.lang, 'Choose files', files);
    await c.getByRole('button', { name: t('Show all {n} files', { n: 7 }) }).click();
    await expect(c.locator('ul.divide-y > li')).toHaveCount(7);
    const wide = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((e) => e.getBoundingClientRect().right > W + 1)
        .slice(0, 3)
        .map(
          (e) =>
            `${e.tagName}.${String(e.className).slice(0, 60)} → ${Math.round(e.getBoundingClientRect().right)}`,
        );
    });
    expect.soft(await pageScrollsSideways(page), `page overflow (${wide.join('; ')})`).toBe(false);
    // Each long name on one line, with the full name in the Remove button's name.
    const first = c.locator('ul.divide-y > li').first();
    const name = first.locator('span > span').first();
    const one = await name.evaluate((s) => ({
      nowrap: getComputedStyle(s).whiteSpace === 'nowrap',
      h: s.getBoundingClientRect().height,
    }));
    expect.soft(one.nowrap && one.h < 30, 'one line').toBe(true);
    await expect
      .soft(first.getByRole('button', { name: t('Remove {name}', { name: long(1) }) }))
      .toBeVisible();
    // Remove targets at least 44 px on touch screens (SD-132).
    const small = (await smallTargets(c.locator('ul').first())).filter((s) =>
      s.startsWith(t('Remove {name}', { name: '' }).trim()),
    );
    expect.soft(small, "'Remove' targets under 44 px").toEqual([]);
    // The buttons wrap inside the card.
    const cb = (await c.boundingBox())!;
    for (const b of await c.locator('button').all()) {
      const bb = await b.boundingBox();
      if (bb && bb.width > 0)
        expect
          .soft(bb.x + bb.width, 'button inside the card')
          .toBeLessThanOrEqual(cb.x + cb.width + 1);
    }
    if (meta.lang === 'az')
      await expect.soft(startBtn(page, meta.lang)).toHaveText('Ən uyğununu tapın →');
    await ux.check('long names', [...STD, 'AZ']);
  },
);
