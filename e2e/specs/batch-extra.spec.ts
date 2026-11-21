import type { Page } from '@playwright/test';
import { ulidOf } from '../fixtures/files';
import {
  AYSEL,
  batchApi,
  BVID,
  coffeebay,
  esc,
  startBatch,
  T,
  type BatchStep,
} from '../fixtures/pkg-d';
import { expect, STD, uat } from '../ux/test';

// 7.10 Batch panel and coffeebay (BP), layer L1: the cases the first pass left out. UAT plan v1.1;
// each case is the row of the same ID.

const scene = (page: Page) => coffeebay(page).locator('.cb-scene').first();
const reading = (analyzed: number, total = 20): BatchStep => ({
  received: total,
  by: { analyzing: total - analyzed, analyzed },
});
async function openVacancy(page: Page) {
  await page.goto('about:blank');
  await page.goto(`/#/vacancies/${BVID}`);
}

uat(
  'BP-02',
  'Greeting variants: batch size, names that are not first names, Azerbaijani',
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const run = async (displayName: string, files: number) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await batchApi(page, {
        files,
        holdUploads: true,
        me: { displayName },
        script: [{ received: 1, by: { analyzing: 1, not_sent: files - 1 } }],
      });
      await openVacancy(page);
      await startBatch(page, meta.lang, files);
      await expect(coffeebay(page)).toBeVisible();
      return coffeebay(page).getByRole('heading', { level: 2 });
    };
    const cases: [string, number, string][] = [
      ['Aysel Mammadova', 5, t('Hey {name}, this only takes a minute or two.', { name: 'Aysel' })],
      ['Aysel Mammadova', 6, t('Hey {name}, go grab a coffee and relax.', { name: 'Aysel' })],
      ['UAT Recruiter', 5, t('This only takes a minute or two.')],
      ['UAT Recruiter', 6, t('Go grab a coffee and relax.')],
      ['Mammadova, Aysel', 6, t('Go grab a coffee and relax.')],
      ['aysel@example.az', 5, t('This only takes a minute or two.')],
    ];
    for (const [name, n, text] of cases) {
      const head = await run(name, n);
      await expect.soft(head, `${name}, ${n} files`).toHaveText(text);
      // An unusable name never leaves a stray comma, greeting word or placeholder behind.
      if (!/Aysel/.test(text)) expect.soft(await head.textContent()).not.toMatch(/[{}]|Hey|Salam/);
    }
    if (meta.lang === 'az') {
      const head = await run('Aysel Mammadova', 6);
      await expect(head).toHaveText('Salam, Aysel! Özünüzə bir qəhvə götürün və dincəlin.');
    }
    await ux.check('greeting', [...STD, 'AZ']);
  },
);

uat(
  'BP-03',
  'Progress picture: stars lit, chalk board numbers, 25/50/75 % announcements, finished announcement',
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await page.addInitScript(() => {
      const w = window as unknown as { __live: string[] };
      w.__live = [];
      const rec = () => {
        const el = document.querySelector('[data-testid=coffeebay] [role=status]');
        const tx = el?.textContent?.trim() ?? '';
        if (tx && w.__live[w.__live.length - 1] !== tx) w.__live.push(tx);
      };
      new MutationObserver(rec).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    // Sending a batch makes the app ask for the picture several times in a row (after each send), so
    // the steps start only once the sending is over: until then the first picture is repeated.
    const seq: BatchStep[] = [
      reading(0),
      reading(5),
      reading(10),
      reading(15),
      { received: 20, by: { analyzed: 20 } },
    ];
    let gateAt = -1;
    const { polls } = await batchApi(page, {
      files: 20,
      script: (k) => (gateAt < 0 ? seq[0]! : seq[Math.min(1 + k - gateAt, 4)]!),
    });
    await openVacancy(page);
    await startBatch(page, meta.lang, 20);
    const cb = coffeebay(page);
    await expect(
      cb.getByText(
        t('All files are sent. You can close this page: {assistant} keeps reading.', {
          assistant: 'parallax',
        }),
      ),
    ).toBeVisible({ timeout: 20_000 });
    gateAt = polls();
    const lit = [0, 4, 7, 11, 14];
    const board = ['0/20', '5/20', '10/20', '15/20', '20/20'];
    const prog = cb.getByRole('progressbar', { name: t('Progress') });
    for (let i = 0; i < 5; i++) {
      await expect(scene(page), `poll ${i}: stars lit`).toHaveAttribute(
        'data-lit',
        String(lit[i]),
        {
          timeout: 15_000,
        },
      );
      expect.soft((await scene(page).textContent()) ?? '', `poll ${i}: board`).toContain(board[i]!);
      await expect.soft(prog).toHaveAttribute('value', String(i * 5));
      if (i === 2) await ux.check('half way', [...STD, 'AZ']);
    }
    await expect.soft(scene(page)).toContainText(t('All ready'));
    await expect(cb.getByRole('heading', { level: 2 })).toHaveText(
      t('All {n} CVs are ready, {name}. Enjoy your coffee.', { n: 20, name: 'Aysel' }),
    );
    const live = await page.evaluate(() => (window as unknown as { __live: string[] }).__live);
    const marks = [25, 50, 75].map((n) => t('About {n}% of the CVs are read.', { n }));
    expect.soft(live.slice(0, 3), 'announcements 25, 50 and 75 once each, in order').toEqual(marks);
    expect.soft(live.length, 'then only the finished headline').toBe(4);
    expect
      .soft(live[3], 'the finished headline, in the page language')
      .toBe(t('All {n} CVs are ready, {name}. Enjoy your coffee.', { n: 20, name: 'Aysel' }));
    await ux.check('finished', [...STD, 'AZ']);
  },
);

uat(
  'BP-04',
  'Time left appears only after 45 s and 3 finished CVs; slow message after 3 minutes without progress',
  { on: ['D'], timeout: 180_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    // The number of finished CVs follows the test's own clock (one more CV every 10 s for 60 s, then
    // none), so it does not depend on how many times the app happened to ask.
    let finished = 0;
    const { polls } = await batchApi(page, {
      files: 30,
      script: () => ({ received: 30, by: { analyzing: 30 - finished, analyzed: finished } }),
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __first?: number };
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const u =
          typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (/upload-batches\/\w{26}/.test(u) && w.__first === undefined) w.__first = Date.now();
        return real(input, init);
      };
    });
    await page.clock.install();
    await openVacancy(page);
    await startBatch(page, meta.lang, 30);
    const cb = coffeebay(page);
    await expect(cb).toBeVisible();
    await page.clock.pauseAt(Date.now() + 1000);
    const line = async () =>
      (await cb.locator('p.tabular-nums').first().textContent())?.trim() ?? '';
    const left = meta.lang === 'az' ? /təxminən (\d+) dəqiqə/ : /about (\d+) minutes? left/;
    const shown: number[] = [];
    let elapsed = 0;
    let sawTime = false;
    let slowAt = -1;
    const slowText = t(
      'This is taking a little longer than usual. {assistant} keeps going, and you can leave this page.',
      { assistant: 'parallax' },
    );
    const sentText = t('All files are sent. You can close this page: {assistant} keeps reading.', {
      assistant: 'parallax',
    });
    for (let i = 1; i <= 70; i++) {
      const before = polls();
      elapsed += 4;
      finished = Math.min(6, Math.floor(elapsed / 10));
      await page.clock.runFor(4000);
      await expect.poll(polls, { message: `poll ${i}` }).toBeGreaterThan(before);
      await page.waitForTimeout(40);
      const text = await line();
      const mm = left.exec(text);
      const done = finished;
      // 45 s are counted from the first reading, which came a moment before the test's own clock.
      const since = await page.evaluate(
        () =>
          (Date.now() - ((window as unknown as { __first?: number }).__first ?? Date.now())) / 1000,
      );
      if (since < 44 || done < 3)
        expect.soft(mm, `no time left at ${since.toFixed(0)} s with ${done} CVs`).toBeNull();
      if (mm) {
        sawTime = true;
        const v = Number(mm[1]);
        const last = shown[shown.length - 1];
        if (last !== undefined && v !== last)
          expect
            .soft(v === last + 1, `the number never rises by only 1 (${last} to ${v})`)
            .toBe(false);
        if (last !== v) shown.push(v);
      }
      if (slowAt < 0 && (await cb.getByText(slowText).count())) {
        slowAt = elapsed;
        expect.soft(mm, 'the time left disappears with the slow message').toBeNull();
        expect.soft(await cb.getByText(sentText).count(), 'the sent line is replaced').toBe(0);
      }
      if (slowAt >= 0) break;
    }
    expect.soft(sawTime, 'a time left was shown once there was enough to go on').toBe(true);
    expect
      .soft(slowAt, 'the slow message came after more than 3 minutes without a result')
      .toBeGreaterThan(180);
    await page.clock.resume();
    await ux.check('slow', [...STD, 'AZ']);
  },
);

uat(
  'BP-06',
  "Hide, 'Show the waiting screen', reload while hidden, Close for good",
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const { LATEST } = await batchApi(page, {
      files: 12,
      latest: { mine: true },
      // The first answers are still reading; later ones are final.
      script: (k) => (k < 4 ? reading(k * 2, 12) : { received: 12, by: { analyzed: 12 } }),
    });
    await openVacancy(page);
    const cb = coffeebay(page);
    await expect(cb).toBeVisible();
    // 1) Hide.
    await cb.getByRole('button', { name: t('Hide'), exact: true }).click();
    const latest = page.getByRole('region', { name: t('Latest upload') });
    await expect(latest).toBeVisible();
    await expect(latest.getByRole('heading', { level: 2 })).toContainText(
      `${t('Latest upload')} · `,
    );
    await expect(latest.getByRole('heading', { level: 2 })).toContainText(AYSEL.displayName);
    await expect.soft(latest.getByText(/Sent \d+ of 12|Göndərildi/)).toBeVisible();
    for (const b of ['See results so far', 'Details', 'Show the waiting screen'])
      await expect.soft(latest.getByRole('button', { name: t(b), exact: true })).toBeVisible();
    await expect(
      latest.getByRole('button', { name: t('Show the waiting screen') }),
      'focus moves to Show the waiting screen',
    ).toBeFocused();
    expect
      .soft(
        await page.evaluate(
          ([u, b]) => localStorage.getItem(`cv-coffeebay-view:${u}:${b}`),
          [AYSEL.userId, LATEST],
        ),
      )
      .toBe('hidden');
    await ux.check('hidden', [...STD, 'AZ']);
    // 2) Show the waiting screen again.
    await latest.getByRole('button', { name: t('Show the waiting screen') }).click();
    await expect(cb).toBeVisible();
    // 3) Hide again and reload: the choice is remembered for this batch.
    await cb.getByRole('button', { name: t('Hide'), exact: true }).click();
    await page.reload();
    await expect(page.getByRole('region', { name: t('Latest upload') })).toBeVisible();
    await expect(cb).toHaveCount(0);
    // 4) Show it, let the batch finish, press Close.
    await page.getByRole('button', { name: t('Show the waiting screen') }).click();
    await expect(cb.getByRole('button', { name: t('Close'), exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveTitle(new RegExp(`${esc(t('✓ Ready · parallax'))}|parallax`));
    await cb.getByRole('button', { name: t('Close'), exact: true }).click();
    await expect(page.getByTestId('batch-panel')).toHaveCount(0);
    await expect.soft(page).not.toHaveTitle(/\(\d+\/\d+\)|✓/);
    await ux.check('closed', [...STD, 'AZ']);
    // 5) Reload: no panel.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('batch-panel')).toHaveCount(0);
    expect
      .soft(
        await page.evaluate(
          ([u, b]) => localStorage.getItem(`cv-coffeebay-view:${u}:${b}`),
          [AYSEL.userId, LATEST],
        ),
      )
      .toBe('closed');
  },
);

uat(
  'BP-07',
  "'See results so far' opens the Candidates tab filtered to the latest upload",
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const { seen, LATEST } = await batchApi(page, {
      files: 12,
      latest: { mine: true },
      script: (k) => (k < 3 ? reading(3, 12) : { received: 12, by: { analyzed: 12 } }),
    });
    await openVacancy(page);
    const cb = coffeebay(page);
    await expect(cb).toBeVisible();
    await cb.getByRole('button', { name: t('See results so far'), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${BVID}/candidates`));
    const chip = page.getByRole('button', { name: new RegExp(esc(t('Latest upload only'))) });
    await expect(chip).toBeVisible();
    expect
      .soft(
        await page.evaluate((v) => sessionStorage.getItem(`cv-batch-filter:${v}`), BVID),
        'the filter is removed once the Candidates tab has read it',
      )
      .toBeNull();
    const cands = () =>
      seen.requests.filter((r) => r.method === 'GET' && r.url.startsWith('/candidates'));
    await expect
      .poll(() => cands().some((r) => r.url.includes(`batch=${LATEST}`)), {
        message: 'the candidates request carries the batch',
      })
      .toBe(true);
    await ux.check('filtered', [...STD, 'AZ']);
    // 3) Remove the chip.
    const n = cands().length;
    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect
      .poll(() => cands().length, { message: 'a new request after the chip' })
      .toBeGreaterThan(n);
    expect
      .soft(cands()[cands().length - 1]!.url, 'no batch in the next request')
      .not.toContain('batch=');
    // 4) Back on the overview the batch has finished: the button reads 'See results'.
    await openVacancy(page);
    await expect(
      page.getByRole('button', { name: t('See results'), exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
  },
);

uat(
  'BP-08',
  'Details file list: filters, statuses, Open, empty filter, long list, real limits, poll error',
  { on: ['D', 'A'], timeout: 150_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const item = (i: number, status: string, extra: Record<string, unknown> = {}) => ({
      itemId: ulidOf('ITM', i),
      parentItemId: null,
      position: i,
      filename: `cv-${String(i).padStart(3, '0')}.pdf`,
      clientPath: null,
      size: 2048,
      status,
      code: null,
      message: null,
      documentId: status === 'analyzed' || status === 'needs_look' ? ulidOf('DOC', i) : null,
      container: false,
      ...extra,
    });
    const make = (spec: [string, number, Record<string, unknown>?][]) => {
      const out: ReturnType<typeof item>[] = [];
      for (const [status, n, extra] of spec)
        for (let k = 0; k < n; k++) out.push(item(out.length + 1, status, extra));
      return out;
    };
    const longName = `${'a-very-long-candidate-file-name-'.repeat(4)}final.pdf`;
    const items = make([
      ['analyzed', 40],
      ['needs_look', 5],
      ['failed', 3],
      ['not_sent', 3],
      ['vacancy_full', 2],
      ['rejected', 2, { code: 'too_many_entries', filename: 'big.zip' }],
      ['duplicate', 2],
      ['analyzing', 3],
    ]);
    items[0] = { ...items[0]!, filename: longName };
    const by = {
      analyzed: 40,
      needs_look: 5,
      failed: 3,
      not_sent: 3,
      vacancy_full: 2,
      rejected: 2,
      duplicate: 2,
      analyzing: 3,
    };
    await batchApi(page, {
      files: 60,
      latest: { mine: true },
      script: [{ received: 60, by, items }],
    });
    await openVacancy(page);
    const cb = coffeebay(page);
    await expect(cb).toBeVisible();
    // 1) Details.
    const details = cb.getByRole('button', { name: t('Details'), exact: true });
    await details.click();
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('region', { name: t('Details') });
    await expect(panel.getByRole('heading', { name: t('Files in this upload') })).toBeVisible();
    const all = panel.getByRole('button', { name: t('All {n}', { n: 60 }), exact: true });
    const attention = panel.getByRole('button', {
      name: t('Needs attention {n}', { n: 15 }),
      exact: true,
    });
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(attention).toHaveAttribute('aria-pressed', 'false');
    // Status words in the list.
    const list = panel.locator('ul');
    for (const w of [
      'Analyzed',
      'Needs a human look',
      'Analysis failed',
      'Not sent',
      'Vacancy full',
      'Already in this vacancy',
    ])
      await expect.soft(list, `row status '${w}'`).toContainText(t(w));
    // The ZIP rows name the server's limit, not a fixed 10.
    await expect
      .soft(list.getByText(t('The ZIP holds more than {n} files', { n: 500 })).first())
      .toBeVisible();
    expect
      .soft(await list.getByText(t('The ZIP holds more than {n} files', { n: 10 })).count())
      .toBe(0);
    // The list scrolls inside its own box.
    const box = await list.evaluate((el) => ({
      h: el.clientHeight,
      sh: el.scrollHeight,
      page: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    expect.soft(box.h, 'the list is at most 384 px tall').toBeLessThanOrEqual(384);
    expect.soft(box.sh, 'a long list scrolls inside its box').toBeGreaterThan(box.h);
    expect.soft(box.page, 'no horizontal page scroll').toBe(false);
    await expect
      .soft(list.getByText(longName, { exact: true }), 'a long name keeps its full text')
      .toHaveCount(1);
    await ux.check('all files', [...STD, 'AZ']);
    // 2) Needs attention.
    await attention.click();
    await expect(attention).toHaveAttribute('aria-pressed', 'true');
    await expect(list.locator('li')).toHaveCount(15);
    await ux.check('needs attention', [...STD, 'AZ']);
    // 3) Back to all, scroll, then Open an analyzed row.
    await all.click();
    await expect(list.locator('li')).toHaveCount(60);
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await list.evaluate((el) => (el.scrollTop = 0));
    await list
      .getByRole('link', { name: t('Open'), exact: true })
      .nth(1)
      .click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${ulidOf('DOC', 2)}`));
  },
);

uat(
  'BP-08',
  'Details: a filter with no rows, and a poll that fails (scenario B)',
  { on: ['D', 'A'], timeout: 120_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const items = Array.from({ length: 4 }, (_, i) => ({
      itemId: ulidOf('ITM', i + 1),
      parentItemId: null,
      position: i + 1,
      filename: `ok-${i + 1}.pdf`,
      clientPath: null,
      size: 1000,
      status: 'analyzed',
      code: null,
      message: null,
      documentId: ulidOf('DOC', i + 1),
      container: false,
    }));
    await batchApi(page, {
      files: 4,
      latest: { mine: true },
      script: [{ received: 4, by: { analyzed: 4 }, items }],
    });
    await openVacancy(page);
    await coffeebay(page)
      .getByRole('button', { name: t('Details'), exact: true })
      .click();
    const panel = page.getByRole('region', { name: t('Details') });
    await panel
      .getByRole('button', { name: t('Needs attention {n}', { n: 0 }), exact: true })
      .click();
    await expect(panel.getByText(t('Nothing to show here.'))).toBeVisible();
    await ux.check('empty filter', [...STD, 'AZ']);
    // Scenario B: the poll answers 500.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    ux.allow(/500|Database not reachable|Failed to load resource/);
    await batchApi(page, {
      files: 4,
      latest: { mine: true },
      script: [{ received: 4, by: { analyzed: 4 } }],
      batchError: 'Database not reachable',
    });
    await openVacancy(page);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Database not reachable' }),
    ).toBeVisible();
    await expect(coffeebay(page)).toHaveCount(0);
    await ux.check('poll error', [...STD, 'AZ']);
  },
);

// ---------------------------------------------------------------------------- BP-13 and BP-14

uat(
  'BP-13',
  'Ready signals: tab title, favicon ring, notification when hidden, chime, restore, no signal for an old batch',
  { on: ['D', 'E'], timeout: 180_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      const notes: { title: string; body?: string; tag?: string; inst: unknown }[] = [];
      w.__notes = notes;
      class N {
        static permission = 'granted';
        static requestPermission = () => Promise.resolve('granted');
        onclick: (() => void) | null = null;
        constructor(title: string, o?: { body?: string; tag?: string }) {
          notes.push({ title, body: o?.body, tag: o?.tag, inst: this });
        }
        close() {}
      }
      w.Notification = N;
      let oscillators = 0;
      w.__osc = () => oscillators;
      class Ctx {
        state = 'running';
        currentTime = 0;
        destination = {};
        resume() {
          return Promise.resolve();
        }
        createGain() {
          const g = { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } };
          return Object.assign(g, { connect: () => ({ connect() {} }) });
        }
        createOscillator() {
          oscillators++;
          return {
            type: '',
            frequency: { value: 0 },
            connect: () => ({ connect() {} }),
            start() {},
            stop() {},
          };
        }
      }
      w.AudioContext = Ctx;
      let hidden = false;
      Object.defineProperty(document, 'visibilityState', {
        get: () => (hidden ? 'hidden' : 'visible'),
      });
      Object.defineProperty(document, 'hidden', { get: () => hidden });
      document.hasFocus = () => !hidden;
      w.__setHidden = (h: boolean) => {
        hidden = h;
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    const title = () => page.title();
    const icon = () =>
      page.evaluate(() => document.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? '');
    const notes = () =>
      page.evaluate(() =>
        (window as unknown as { __notes: { title: string; body?: string }[] }).__notes.map((n) => ({
          title: n.title,
          body: n.body,
        })),
      );
    const oscillators = () =>
      page.evaluate(() => (window as unknown as { __osc: () => number }).__osc());
    const setHidden = (h: boolean) =>
      page.evaluate(
        (x) => (window as unknown as { __setHidden: (b: boolean) => void }).__setHidden(x),
        h,
      );

    // The batch finishes when the test says so (while the tab is hidden), not after a fixed number of
    // readings: the app asks several times in a row right after the send.
    let finish = false;
    const { polls } = await batchApi(page, {
      files: 4,
      script: (k) =>
        finish ? { received: 4, by: { analyzed: 4 } } : k < 1 ? reading(1, 4) : reading(2, 4),
    });
    await page.clock.install();
    await openVacancy(page);
    // The tab names the page ('<vacancy> · parallax …') once the page has drawn; that is the title
    // the signals must put back.
    await expect.poll(title).toContain(' · parallax');
    const original = await title();
    await startBatch(page, meta.lang, 4);
    await expect(coffeebay(page)).toBeVisible();
    // 2) While running: '(n/4) parallax' and a data: favicon.
    await expect.poll(title).toMatch(/^\(\d\/4\) parallax$/);
    expect.soft(await icon()).toMatch(/^data:image\/svg\+xml/);
    expect.soft(await oscillators(), 'the chime is off: no oscillator').toBe(0);
    await ux.shot('running');
    // 3) Hidden before the finish; step the clock through the polls (15 s each when hidden).
    await page.clock.pauseAt(Date.now() + 500);
    await setHidden(true);
    finish = true;
    for (let i = 0; i < 4; i++) {
      const before = polls();
      await page.clock.runFor(16_000);
      await expect.poll(polls).toBeGreaterThan(before);
      if ((await title()) === t('✓ Ready · parallax')) break;
    }
    await expect.poll(title).toBe(t('✓ Ready · parallax'));
    const n = await notes();
    expect.soft(n.length, 'one notification').toBe(1);
    expect.soft(n[0]?.title).toBe(t('{assistant}: your CVs are ready', { assistant: 'parallax' }));
    expect
      .soft(n[0]?.body)
      .toBe(t('{ready} of {total} CVs are ready to review', { ready: 4, total: 4 }));
    expect
      .soft(`${n[0]?.title} ${n[0]?.body}`, 'no names or file names')
      .not.toMatch(/uat-cv|Person|Aysel/);
    // 4) Click the notification: opens the Candidates tab.
    await page.evaluate(() => {
      const w = window as unknown as { __notes: { inst: { onclick?: () => void } }[] };
      w.__notes[0]!.inst.onclick?.();
    });
    await expect(page).toHaveURL(new RegExp(`#/vacancies/${BVID}/candidates`));
    // 5) Visible again: 10 s later the title and icon are restored.
    await setHidden(false);
    await page.clock.runFor(10_500);
    await expect.poll(title).toBe(original);
    expect.soft(await icon()).not.toMatch(/^data:image\/svg\+xml.*%23F5C461/);
    await page.clock.resume();
    await ux.check('restored', [...STD, 'AZ']);
    // 6) The chime: tick the box, one preview is played and the choice is stored.
    await page.goto(`/#/vacancies/${BVID}`);
    const box = page.getByRole('checkbox', { name: t('Soft sound when ready') });
    if (await box.count()) {
      await box.check();
      await expect.poll(oscillators).toBe(2);
      expect
        .soft(await page.evaluate((u) => localStorage.getItem(`cv-coffeebay:${u}`), AYSEL.userId))
        .toBe('1');
    }
  },
);

uat(
  'BP-13',
  'Ready signals: a batch that was already finished at page open changes nothing',
  { on: ['D', 'E'], timeout: 90_000 },
  async ({ page, meta }) => {
    const t = T(meta.lang);
    await batchApi(page, {
      files: 4,
      latest: { mine: true },
      script: [{ received: 4, by: { analyzed: 4 } }],
    });
    await page.goto('about:blank');
    await page.goto(`/#/vacancies/${BVID}`);
    await expect.poll(() => page.title()).toContain(' · parallax');
    const before = await page.title();
    await expect(coffeebay(page)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await page.title(), 'no ready title for an old batch').toBe(before);
    expect(await page.title()).not.toBe(t('✓ Ready · parallax'));
    expect(
      await page.evaluate(
        () => document.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? '',
      ),
    ).not.toMatch(/^data:image\/svg\+xml/);
  },
);

uat(
  'BP-14',
  'Coffeebay scene with reduced motion, forced colours, hidden tab, and on tablet and phone',
  { on: ['D', 'T', 'TL', 'A'], langs: 'EN', timeout: 150_000 },
  async ({ page, ux, meta }) => {
    const running = () =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' &&
                (a.effect as KeyframeEffect | null)?.target instanceof Element &&
                (a.effect as KeyframeEffect).target!.closest('.cb-scene'),
            ).length,
      );
    const forty = (analyzed: number): BatchStep => ({
      received: 40,
      by: { analyzing: 40 - analyzed, analyzed },
    });
    // 1) Reduced motion: nothing moves and 7 of the 14 stars are lit at once.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await batchApi(page, { files: 40, latest: { mine: true }, script: [forty(20)] });
    await openVacancy(page);
    await expect(scene(page)).toBeVisible();
    await expect(scene(page)).toHaveAttribute('data-lit', '7');
    expect
      .soft(await page.evaluate(() => document.getAnimations().length), 'no animation at all')
      .toBe(0);
    await ux.check('reduced motion', [...STD, 'RM']);
    // 2) No preference: the scene moves; hidden or out of view it pauses.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(scene(page)).toBeVisible();
    await expect.poll(running, { message: 'animations run' }).toBeGreaterThan(0);
    await expect(scene(page)).toHaveAttribute('data-paused', 'false');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(scene(page), 'paused while the tab is hidden').toHaveAttribute(
      'data-paused',
      'true',
    );
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(scene(page)).toHaveAttribute('data-paused', 'false');
    await page.evaluate(() => {
      const s = document.createElement('div');
      s.style.height = '4000px';
      s.id = 'uat-spacer';
      document.querySelector('main')!.appendChild(s);
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await expect(scene(page), 'paused while scrolled out of view').toHaveAttribute(
      'data-paused',
      'true',
    );
    await page.evaluate(() => {
      document.getElementById('uat-spacer')?.remove();
      window.scrollTo(0, 0);
    });
    // 3) Layout by device.
    await expect(scene(page)).toBeVisible();
    const sc = (await scene(page).boundingBox())!;
    const head = (await coffeebay(page).getByRole('heading', { level: 2 }).boundingBox())!;
    const vw = page.viewportSize()!.width;
    if (vw < 640) {
      expect.soft(sc.y + sc.height <= head.y + 1, 'scene above the text on a phone').toBe(true);
      expect.soft(sc.height, 'at most 216 px tall').toBeLessThanOrEqual(216);
      expect
        .soft(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          'no horizontal scroll',
        )
        .toBe(false);
      const hidden = await page.evaluate(() =>
        [...document.querySelectorAll('.cb-lamp-2, .cb-plant')].map(
          (e) => getComputedStyle(e).display,
        ),
      );
      expect.soft(hidden, 'second lamp and plant hidden on a phone').toEqual(['none', 'none']);
    } else if (vw >= 768) {
      expect.soft(sc.x + sc.width <= head.x + 1, 'two columns: scene left, text right').toBe(true);
    }
    await ux.check('layout', STD);
    // 4) Forced colours: no scene, the text stays.
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(scene(page)).toBeHidden();
    await expect(coffeebay(page).getByRole('heading', { level: 2 })).toBeVisible();
  },
);

uat(
  'BP-14',
  'Coffeebay scene settles 12 s after the finish',
  { on: ['D'], langs: 'EN', timeout: 90_000 },
  async ({ page }) => {
    await batchApi(page, {
      files: 12,
      latest: { mine: true },
      script: (k) => (k < 1 ? reading(3, 12) : { received: 12, by: { analyzed: 12 } }),
    });
    await openVacancy(page);
    await expect(scene(page)).toHaveAttribute('data-finished', 'true', { timeout: 20_000 });
    await expect(scene(page)).toHaveAttribute('data-still', 'true', { timeout: 20_000 });
    expect(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                (a.effect as KeyframeEffect | null)?.target instanceof Element &&
                (a.effect as KeyframeEffect).target!.closest('.cb-scene') &&
                a.playState === 'running',
            ).length,
      ),
      'no animation runs once it is still',
    ).toBe(0);
  },
);

uat(
  'UP-20',
  '"Download report" after an upload: in Details of every batch, the token in a header (S3-UP-09)',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const items = [
      {
        itemId: ulidOf('ITM', 1),
        parentItemId: null,
        position: 0,
        filename: 'uat-cv-001.pdf',
        clientPath: null,
        size: 2057,
        status: 'analyzing',
        code: null,
        message: null,
        documentId: ulidOf('DOC', 1),
        container: false,
      },
    ];
    const { seen } = await batchApi(page, {
      files: 1,
      script: [{ received: 1, by: { analyzing: 1 }, items }],
    });
    await openVacancy(page);
    await startBatch(page, meta.lang, 1);
    await expect(coffeebay(page)).toBeVisible();
    await coffeebay(page)
      .getByRole('button', { name: t('Details'), exact: true })
      .click();
    const btn = page.getByRole('button', { name: t('Download the report of this upload (CSV)') });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(t('Download report'));
    await ux.check('details with the report button', [...STD, 'AZ']);
    const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()]);
    expect(dl.suggestedFilename()).toMatch(/^upload-report-\w{26}\.csv$/);
    const got = seen.requests.filter((r) => /\/report\.csv$/.test(r.url));
    expect(got).toHaveLength(1);
    expect(got[0]!.url).not.toMatch(/token|session/i);
  },
);
