import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { longAfter, now, perfProbe, perfRead } from '../fixtures/pkg-h';
import { expect, test, uat } from '../ux/test';
import {
  accounts,
  db,
  growVacancy,
  login,
  openAs,
  resumeFiles,
  screenedVacancy,
  uniq,
} from './stack';

/**
 * UAT PF-04, layer L2: the candidate pool with 300 CVs. The vacancy is made through the app (three
 * real CVs, analyzed by the fake AI) and grown to 300 by cloning those three in SQL (growVacancy in
 * stack.ts, the way apps/api/src/pipeline/volume.integration.spec.ts does). Every person is invented.
 */

uat(
  'PF-04',
  'Candidate pool with 300 CVs: scroll, select all, ZIP',
  { on: ['D', 'A'], langs: 'EN', timeout: 300_000 },
  async ({ page, meta }) => {
    const acc = accounts();
    const token = await login(acc.recruiter);
    const v = await screenedVacancy(token, {
      title: uniq('UAT Pool 300'),
      files: resumeFiles().slice(0, 3),
    });
    expect(v.documents).toHaveLength(3);
    await growVacancy(v.id, 300);
    const total = (
      await db<{ n: number }>(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [
        v.id,
      ])
    )[0]!.n;
    expect(total).toBe(300);

    await perfProbe(page);
    await openAs(page, acc.recruiter, '#/vacancies');
    const rows = page.locator('li[id^=cand-]');
    const timed = async (f: () => Promise<unknown>) => {
      const t = Date.now();
      await f();
      return Date.now() - t;
    };
    const log: Record<string, number | string> = {};

    // 1) Open the candidates of that vacancy: the first 50 rows.
    log.first50 = await timed(async () => {
      await page.goto(`${new URL(page.url()).origin}/#/vacancies/${v.id}/candidates`);
      await page
        .getByRole('combobox', { name: 'Show', exact: true })
        .selectOption({ label: 'All CVs' });
      await expect(rows).toHaveCount(50);
    });
    expect(log.first50 as number, 'first 50 rows').toBeLessThanOrEqual(1500);

    // 1b) From the first 50: select them, then every one of the 300 through the banner.
    const all = page.getByRole('checkbox', {
      name: meta.touch ? 'Select all' : 'Select all shown',
      exact: true,
    });
    const bar = page.getByRole('region', { name: 'Selected candidates' });
    await all.check();
    log.selectAll300 = await timed(async () => {
      await page.getByRole('button', { name: 'Select all 300 in this list' }).click();
      await expect(bar).toContainText('300 selected');
    });
    expect(log.selectAll300 as number, 'select all 300 in this list').toBeLessThanOrEqual(500);
    await bar.getByRole('button', { name: 'Clear selection' }).first().click();
    await expect(bar).toHaveCount(0);

    // 2) 'Show 50 more' five times.
    const more = page.getByRole('button', { name: /^Show \d+ more/ });
    for (let i = 1; i <= 5; i++) {
      const ms = await timed(async () => {
        await more.click();
        await expect(rows).toHaveCount(Math.min(300, 50 + 50 * i));
      });
      log[`more${i}`] = ms;
      expect(ms, `'Show 50 more' number ${i}`).toBeLessThanOrEqual(1000);
    }
    await expect(rows).toHaveCount(300);

    // 3) Scroll top to bottom: no long task above the limit.
    const t0 = await now(page);
    await page.evaluate(async () => {
      const h = () => document.documentElement.scrollHeight;
      for (let y = 0; y < h(); y += window.innerHeight * 0.8) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      window.scrollTo(0, h());
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    const perf = await perfRead(page);
    const worst = Math.max(0, ...longAfter(perf, t0).map((l) => l.dur));
    log.longestTaskOnScroll = worst;
    expect(worst, 'longest task while scrolling').toBeLessThanOrEqual(meta.dev === 'A' ? 200 : 100);

    // 4) Select all shown: all 300 are loaded by now.
    log.selectShown = await timed(async () => {
      await all.check();
      await expect(bar).toContainText('300 selected');
    });
    expect(log.selectShown as number, 'select all shown').toBeLessThanOrEqual(500);

    // 5) Download CVs: it starts within 15 s, with its message.
    const started = Date.now();
    const download = page.waitForEvent('download', { timeout: 15_000 });
    await bar.getByRole('button', { name: 'Download CVs' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /Downloading 300 CVs/ })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    const file = await download;
    log.zipStart = Date.now() - started;
    expect(log.zipStart as number, 'ZIP starts').toBeLessThanOrEqual(15_000);
    const dir = mkdtempSync(join(tmpdir(), 'pf04-zip-'));
    const zip = join(dir, 'cvs.zip');
    await file.saveAs(zip);
    const listed = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    expect(listed).toHaveLength(300);

    // The heap, where the browser reports it.
    const heapMb = await page.evaluate(() => {
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return m ? Math.round(m.usedJSHeapSize / 1024 / 1024) : null;
    });
    log.heapMb = heapMb ?? 'n/a';
    if (heapMb !== null && meta.dev === 'D')
      expect(heapMb, 'JS heap (MB)').toBeLessThanOrEqual(150);
    test.info().annotations.push({ type: 'measured', description: JSON.stringify(log) });
  },
);
