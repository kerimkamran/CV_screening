import type { Page } from '@playwright/test';
import { pageScrollsSideways } from '../fixtures/pkg-c';
import {
  AYSEL,
  bandRows,
  cards,
  crow,
  DVID,
  esc,
  posts,
  resultsApi,
  stars,
  starMap,
  T,
  type CRow,
} from '../fixtures/pkg-d';
import { test } from '@playwright/test';
import { expect, STD, uat } from '../ux/test';

// 7.12 Results and star map (RS), layer L1: the cases the first pass left out. UAT plan v1.1; each
// case is the row of the same ID.

const open = (page: Page, tab = 'results') => page.goto(`/#/vacancies/${DVID}/${tab}`);
const label = (page: Page) => starMap(page).locator('span.whitespace-nowrap');
const rect = async (loc: ReturnType<Page['locator']>) => (await loc.boundingBox())!;
/** Wide screens show the star map at once, the others show the toggle first: wait for either, then open it. */
async function showMap(page: Page, t: ReturnType<typeof T>) {
  const toggle = page.getByRole('button', { name: t('Show star map'), exact: true });
  await expect(toggle.or(starMap(page)).first()).toBeVisible();
  if (await toggle.isVisible()) await toggle.click();
}

uat(
  'RS-02',
  'Star map with the mouse: select, names, hover, tooltip, lines',
  { on: ['D', 'DW'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await resultsApi(page, { rows: bandRows({ strong: 4, good: 4, partial: 4 }) });
    await open(page);
    const s = stars(page);
    await expect(s).toHaveCount(12);
    // 1) Stars 1 to 5 show their names.
    await expect.soft(label(page)).toHaveCount(5);
    // 2) Hover star 8: its name shows, leaving hides it.
    const eight = s.nth(7);
    await eight.hover();
    await expect(label(page)).toHaveCount(6);
    const name8 = (await eight.getAttribute('aria-label'))!.split(',')[0]!;
    await expect.soft(label(page).filter({ hasText: name8 })).toBeVisible();
    await expect.soft(eight).toHaveAttribute('title', /Score \d+/);
    await page.mouse.move(5, 5);
    await expect.soft(label(page)).toHaveCount(5);
    // Every star button is 44 by 44.
    for (const [i, b] of (
      await s.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return [Math.round(r.width), Math.round(r.height)];
        }),
      )
    ).entries())
      expect.soft(b, `star ${i + 1} is 44 by 44`).toEqual([44, 44]);
    // 3) Click star 8: pressed, card 8 open and marked, lines touching it brighten.
    const lines = starMap(page).locator('line');
    const bright = () =>
      lines.evaluateAll((els) =>
        els
          .map((e, i) => [i, e.getAttribute('opacity')] as const)
          .filter(([, o]) => o === '0.95')
          .map(([i]) => i),
      );
    const before = await bright();
    await eight.click();
    await expect(eight).toHaveAttribute('aria-pressed', 'true');
    const card = cards(page, meta.lang).nth(7);
    await expect.soft(card.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
    await expect.soft(card).toHaveClass(/border-accent/);
    const after = await bright();
    expect.soft(after.length, 'lines touch the selected star').toBeGreaterThan(0);
    expect.soft(after, 'the bright lines moved with the selection').not.toEqual(before);
    await expect
      .poll(
        async () => {
          const b = await card.boundingBox();
          return !!b && b.y < page.viewportSize()!.height && b.y + b.height > 0;
        },
        { message: 'card 8 is scrolled into view' },
      )
      .toBe(true);
    expect.soft(await s.nth(0).getAttribute('aria-pressed')).toBe('false');
    void t;
    await ux.check('star 8 selected', STD);
  },
);

const LONG = [
  'Gülnarə Məmmədova-Hüseynova (Bakı)',
  'Əliabbas Rəhimzadə-Qasımov (Sumqayıt)',
  'Aysel Məmmədova',
  'Rauf Əliyev-Nəsirov (Gəncə şəhəri)',
  'Leyla Hüseynbəyli-Ağayeva (Lənkəran)',
  'Tural Quliyev',
  'Nigar Ələkbərova-Səfərova (Mingəçevir)',
  'Elvin Cəfərov',
  'Fidan Abdullayeva-Məhərrəmova (Şəki)',
  'Kamal Rzayev',
  'Sevinc Bayramova-İsmayılzadə (Naxçıvan)',
  'Orxan Vəliyev',
];

uat(
  'RS-05',
  'Star-map names fit, do not overlap, and are reachable on touch screens',
  { on: ['DS', 'T', 'TL', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const rows: CRow[] = LONG.map((n, i) => crow(i + 1, { score: 98 - i * 3, name: n }));
    await resultsApi(page, { rows });
    await open(page);
    const map = starMap(page);
    await showMap(page, t);
    await expect(map).toBeVisible();
    await expect(stars(page)).toHaveCount(12);
    // Touch: tap star 9, its name shows without hover.
    if (meta.touch) {
      await stars(page).nth(8).tap();
      await expect(stars(page).nth(8)).toHaveAttribute('aria-pressed', 'true');
    }
    const box = await rect(map);
    const labels = await label(page).evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { text: (e.textContent ?? '').trim(), x: r.left, y: r.top, w: r.width, h: r.height };
      }),
    );
    expect(labels.length).toBeGreaterThanOrEqual(5);
    for (const l of labels)
      expect
        .soft(
          l.x >= box.x - 0.5 &&
            l.x + l.w <= box.x + box.width + 0.5 &&
            l.y >= box.y - 0.5 &&
            l.y + l.h <= box.y + box.height + 0.5,
          `'${l.text}' lies inside the map box`,
        )
        .toBe(true);
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!;
        const b = labels[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect
          .soft(
            overlap,
            `'${a.text}' and '${b.text}' do not overlap: ${JSON.stringify([a, b].map((l) => [Math.round(l.x), Math.round(l.y), Math.round(l.w), Math.round(l.h)]))} in the map ${JSON.stringify([Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)])}`,
          )
          .toBe(false);
      }
    // The full name stays available to assistive technology on the star button.
    for (const n of LONG.slice(0, 3))
      await expect.soft(map.getByRole('button', { name: new RegExp(`^${esc(n)}`) })).toHaveCount(1);
    await ux.check('long names', [...STD, 'AZ']);
  },
);

uat(
  'RS-06',
  "Results on tablet and phone: 'Show star map' toggle, full-width cards",
  { on: ['T', 'TL', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await resultsApi(page, {
      rows: bandRows({ strong: 6, good: 8, partial: 8, limited: 5, human: 3 }),
    });
    await open(page);
    await expect(
      page.getByRole('heading', { level: 2, name: t('Your constellation') }),
    ).toBeVisible();
    const show = page.getByRole('button', { name: t('Show star map'), exact: true });
    const hide = page.getByRole('button', { name: t('Hide star map'), exact: true });
    const wide = page.viewportSize()!.width >= 1024;
    if (wide) {
      await expect(starMap(page), 'the map shows at once on a wide tablet').toBeVisible();
      await expect(show).toBeHidden();
      await expect(hide).toBeHidden();
    } else {
      await expect(starMap(page)).toBeHidden();
      await expect(show).toBeVisible();
      await ux.check('map hidden', [...STD, 'AZ']);
      await show.click();
      await expect(starMap(page)).toBeVisible();
      await expect(hide).toBeVisible();
      await ux.check('map shown', [...STD, 'AZ']);
      await hide.click();
      await expect(starMap(page)).toBeHidden();
      await expect(show).toBeVisible();
    }
    // Cards use the full width of the column; nothing scrolls sideways.
    const list = page.locator(`section[aria-label="${t('Candidates')}"]`);
    const l = await rect(list);
    const c = await rect(cards(page, meta.lang).first());
    expect.soft(Math.abs(c.width - l.width), 'cards are full width').toBeLessThanOrEqual(1);
    expect.soft(await pageScrollsSideways(page), 'no horizontal page scroll').toBe(false);
    await ux.check('cards', [...STD, 'AZ']);
  },
);

uat(
  'RS-10',
  "'My marks' group: tally, Copy shortlist, copy refused, Download CSV",
  { on: ['D', 'A'], timeout: 90_000 },
  async ({ page, context, ux, meta }) => {
    const t = T(meta.lang);
    const decide = (outcome: 'shortlist' | 'hold' | 'reject') => ({
      outcome,
      reason: 'Checked the quotes against the CV.',
    });
    const rows: CRow[] = [
      crow(1, { score: 95, name: 'Aysel Mammadova', decision: decide('shortlist') }),
      crow(2, { score: 88, name: 'Rauf Aliyev', decision: decide('shortlist') }),
      crow(3, { score: 77, name: 'Leyla Hasanova', decision: decide('hold') }),
      crow(4, { score: 60, name: 'Tural Guliyev', decision: decide('reject') }),
      crow(5, { score: 85, name: 'Nigar Safarova' }),
    ];
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await resultsApi(page, { rows });
    await open(page);
    const group = page.getByRole('group', { name: t('My marks') });
    await expect(group).toBeVisible();
    await expect
      .soft(group)
      .toContainText(t('{a} shortlisted · {b} maybe · {c} not now', { a: 2, b: 1, c: 1 }));
    await expect.soft(group).toContainText(t('They never change the match or the order.'));
    await ux.check('my marks', [...STD, 'AZ']);
    // 2) Copy shortlist.
    await group.getByRole('button', { name: t('Copy shortlist'), exact: true }).click();
    await expect(group.getByRole('status')).toHaveText(t('Copied.'));
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    if (clip) {
      expect.soft(clip).toContain('Aysel Mammadova');
      expect.soft(clip).toContain('Rauf Aliyev');
      expect.soft(clip).not.toContain('Leyla Hasanova');
    }
    // 3) The browser refuses: a plain message that points to the CSV.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
    });
    await group.getByRole('button', { name: t('Copy shortlist'), exact: true }).click();
    await expect(group.getByRole('status')).toHaveText(
      t('Your browser did not allow copying. Use the CSV instead.'),
    );
    // 4) Download CSV.
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      group.getByRole('button', { name: t('Download CSV'), exact: true }).click(),
    ]);
    expect(dl.suggestedFilename()).toBe('shortlist.csv');
    const { readFileSync } = await import('node:fs');
    const csv = readFileSync((await dl.path())!, 'utf8');
    expect.soft(csv).toContain('Aysel Mammadova');
    expect.soft(csv).toContain('Rauf Aliyev');
    expect.soft(csv).not.toContain('Leyla Hasanova');
    // B: nobody marked: no group.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { rows: bandRows({ strong: 3, good: 2 }) });
    await page.goto('about:blank');
    await open(page);
    await expect(
      page.getByRole('heading', { level: 2, name: t('Your constellation') }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: t('My marks') })).toHaveCount(0);
    void AYSEL;
  },
);

uat(
  'RS-11',
  "'Show n more (m not shown)' paging and selecting a star beyond the shown cards",
  { on: ['D', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    // 45 ranked CVs, all at 50 or more (below that a CV is Limited and sits in its own group).
    await resultsApi(page, {
      rows: Array.from({ length: 45 }, (_, i) => crow(i + 1, { score: 99 - i })),
    });
    await open(page);
    const cs = cards(page, meta.lang);
    await expect(cs).toHaveCount(20);
    const more = (n: number, m: number) =>
      page.getByRole('button', { name: t('Show {n} more ({m} not shown)', { n, m }), exact: true });
    await expect(more(20, 25)).toBeVisible();
    await ux.check('first 20', [...STD, 'AZ']);
    await more(20, 25).click();
    await expect(cs).toHaveCount(40);
    await expect(more(5, 5)).toBeVisible();
    await more(5, 5).click();
    await expect(cs).toHaveCount(45);
    await expect(
      page.getByRole('button', { name: /^(Show \d+ more|\d+ .* göstərin)/ }),
    ).toHaveCount(0);
    // 4) Reload; on a phone press 'Show star map' first; 'Show all' on the map; star 33.
    await page.reload();
    await expect(cs).toHaveCount(20);
    await showMap(page, t);
    await page.getByRole('button', { name: t('Show all'), exact: true }).click();
    await expect(stars(page)).toHaveCount(45);
    await stars(page).nth(32).click();
    await expect(cs).toHaveCount(40);
    await expect(stars(page).nth(32)).toHaveAttribute('aria-pressed', 'true');
    await expect(cs.nth(32).getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(async () => {
        const b = await cs.nth(32).boundingBox();
        return !!b && b.y < page.viewportSize()!.height && b.y + b.height > 0;
      })
      .toBe(true);
    await ux.check('star 33', [...STD, 'AZ']);
  },
);

uat(
  'RS-12',
  "Limited, 'Missed by one must-have', 'No strong match', and a Limited star",
  { on: ['D', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const all = ['met', 'met', 'met', 'met', 'met'] as const;
    const two = ['not_found', 'not_found', 'met', 'met', 'met'] as const;
    const rows: CRow[] = [
      // Good: two with one mandatory gap (CCIE not found), two with none.
      crow(1, { score: 79, name: 'Aysel Mammadova' }),
      crow(2, { score: 78, name: 'Rauf Aliyev' }),
      crow(3, { score: 77, name: 'Leyla Hasanova', statuses: [...all], gaps: 0 }),
      crow(4, { score: 76, name: 'Tural Guliyev', statuses: [...all], gaps: 0 }),
      // Partial: gaps of two.
      crow(5, { score: 66, name: 'Nigar Safarova', statuses: [...two], gaps: 2 }),
      crow(6, { score: 62, name: 'Elvin Jafarov', statuses: [...two], gaps: 2 }),
      crow(7, { score: 58, name: 'Fidan Abdullayeva', statuses: [...two], gaps: 2 }),
      // Limited.
      ...[44, 40, 36, 32, 28].map((sc, k) =>
        crow(8 + k, { score: sc, name: `Limited Person ${k + 1}`, statuses: [...two], gaps: 2 }),
      ),
    ];
    await resultsApi(page, { rows });
    await open(page);
    await expect(
      page.getByText(
        t(
          'No strong match in this batch. These are the best matches found; none of them reached Strong.',
        ),
      ),
    ).toBeVisible();
    // 2) Limited (5).
    const limited = page.locator('details').filter({
      has: page.getByText(
        t('Limited ({n}): fewer of the requirements found. Nobody is rejected.', { n: 5 }),
      ),
    });
    await expect(limited).toHaveCount(1);
    await limited.locator('summary').click();
    await expect(limited.locator('article')).toHaveCount(5);
    await ux.check('limited open', [...STD, 'AZ']);
    // 3) Missed by one must-have (2).
    const missed = page.locator('details').filter({
      has: page.getByText(t('Missed by one must-have ({n})', { n: 2 })),
    });
    await missed.locator('summary').click();
    const lis = missed.locator('li');
    await expect(lis).toHaveCount(2);
    await expect.soft(lis.first()).toContainText(`Aysel Mammadova · ${t('Good')}`);
    await expect
      .soft(lis.first())
      .toContainText(t('Not found: {text}', { text: 'CCIE certification' }));
    await ux.check('missed by one', [...STD, 'AZ']);
    // 4) Close Limited, then press a Limited star on the map.
    await limited.locator('summary').click();
    await expect(limited).not.toHaveAttribute('open', '');
    await showMap(page, t);
    const limitedStar = starMap(page).getByRole('button', {
      name: new RegExp(`Limited Person 1, ${esc(t('Limited'))}$`),
    });
    await expect(limitedStar).toHaveCount(1);
    await limitedStar.click();
    await expect(limited).toHaveAttribute('open', '');
    const chosen = limited.locator('article').first();
    await expect(chosen.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
    await expect(chosen).toBeInViewport();
    await ux.check('limited star', [...STD, 'AZ']);
  },
);

uat(
  'RS-16',
  'Scanning sweep and hover effects under reduced motion; Azerbaijani labels',
  { on: ['D', 'A'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const rows: CRow[] = [
      ...bandRows({ strong: 3, good: 2 }),
      ...[6, 7, 8, 9, 10].map((i) => crow(i, { score: null, state: 'queued', band: null })),
    ];
    await resultsApi(page, { rows, aiActive: true });
    await open(page);
    await showMap(page, t);
    // 1) No preference: the map is scanning and the sweep runs.
    await expect(starMap(page)).toHaveAttribute('data-scanning', 'true');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (a) =>
                  a.playState === 'running' &&
                  !!(a.effect as KeyframeEffect).target?.closest?.('[data-testid="star-map"]'),
              ).length,
        ),
      )
      .toBeGreaterThan(0);
    // 2) Reduced motion: nothing runs, nothing grows or lifts on hover.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await showMap(page, t);
    await expect(starMap(page)).toBeVisible();
    await stars(page).first().hover();
    await cards(page, meta.lang).first().hover();
    const anims = await page.evaluate(() =>
      document.getAnimations().map((a) => {
        const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const n = a as CSSAnimation & CSSTransition;
        return `${a.constructor.name} ${n.animationName ?? n.transitionProperty ?? ''} ${a.playState} on ${el?.tagName}.${String(el?.getAttribute('class') ?? '').slice(0, 60)}`;
      }),
    );
    expect.soft(anims, 'no animation at all').toEqual([]);
    const grown = await stars(page)
      .first()
      .locator('span')
      .first()
      .evaluate((e) => getComputedStyle(e).transform);
    expect
      .soft(['none', 'matrix(1, 0, 0, 1, 0, 0)'], 'the star does not grow on hover')
      .toContain(grown);
    await ux.check('reduced motion', [...STD, 'RM', 'AZ']);
    // 3) Azerbaijani: the tab is Azerbaijani, for example Stop.
    if (meta.lang === 'az')
      await expect(page.getByRole('button', { name: 'Skanı dayandırın' })).toBeVisible();
    else await expect(page.getByRole('button', { name: t('Stop the scan') })).toBeVisible();
  },
);

uat(
  'RS-09',
  "One marking rule for one decision, and a visible reason when 'Save my mark' is disabled",
  { on: ['D', 'T'], timeout: 90_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const { seen } = await resultsApi(page, { rows: bandRows({ strong: 3, good: 2 }) });
    await open(page);
    const cs = cards(page, meta.lang);
    await expect(cs).toHaveCount(5);
    // 1) Shortlist on card 1, note left empty.
    const head = cs.first().getByRole('button').first();
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    const group = cs.first().getByRole('group', { name: t('Choose a mark') });
    await group.getByRole('button', { name: t('Shortlist'), exact: true }).click();
    const save = cs.first().getByRole('button', { name: t('Save my mark'), exact: true });
    await expect(save).toBeDisabled();
    // 2) A visible text near the button says why, and the button points to it.
    const needNote = cs.first().getByText(t('Add a note of at least 10 characters to save.'));
    await expect(needNote).toBeVisible();
    await expect(save).toHaveAccessibleDescription(
      t('Add a note of at least 10 characters to save.'),
    );
    await ux.check('disabled with a reason', [...STD, 'AZ']);
    // 3) Not now with a 12-character note: the evidence tick is what is missing.
    await group.getByRole('button', { name: t('Not now'), exact: true }).click();
    await cs.first().getByLabel(t('One line, in your words')).fill('Twelve chars');
    await expect(needNote).toHaveCount(0);
    const needTick = cs.first().getByText(t('Tick the evidence box to save.'));
    await expect(needTick).toBeVisible();
    await expect(save).toBeDisabled();
    await cs.first().getByRole('checkbox').check();
    await expect(needTick).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(() => posts(seen, /^\/screenings\/\w+\/decision$/).length, {
        message: 'one decision sent',
      })
      .toBe(1);
    const sent = posts(seen, /^\/screenings\/\w+\/decision$/)[0]!.body as Record<string, unknown>;
    expect
      .soft(sent)
      .toMatchObject({ outcome: 'reject', reason: 'Twelve chars', evidenceReviewed: true });
    // 4) The Candidates tab marks at once, with an Undo (a quick triage mark), with no note and no
    // tick: the Results card records a reasoned decision. The plan lists this as one decision with
    // two rules (SD-33); which way to settle it is a product choice, so the test pins what the
    // person sees today and says so, instead of changing a flow people already use.
    test.info().annotations.push({
      type: 'owner-decision',
      description:
        'SD-33: Results needs a 10-character note (and the evidence tick for Not now); the Candidates tab marks at once with Undo. The reason text is fixed; the single rule is the owner to choose.',
    });
    await page.goto(`/#/vacancies/${DVID}/candidates`);
    const wide = page.viewportSize()!.width >= 1024;
    const second = 'Rauf Əliyev';
    if (wide) {
      await page
        .getByRole('link', { name: second })
        .first()
        .click({ trial: true })
        .catch(() => undefined);
      await page.locator('[id^="cand-"]').nth(1).click();
      await page
        .getByRole('button', { name: t('Shortlist'), exact: true })
        .last()
        .click();
    } else {
      await page
        .getByRole('combobox', { name: t('Decision for {name}', { name: second }) })
        .selectOption({ label: t('Shortlist') });
    }
    await expect
      .poll(
        () => seen.requests.filter((r) => r.method === 'PUT' && /\/decision$/.test(r.url)).length,
      )
      .toBe(1);
    const put = seen.requests.find((r) => r.method === 'PUT' && /\/decision$/.test(r.url))!;
    expect.soft(put.body).toMatchObject({ mark: 'shortlist' });
    expect.soft((put.body as { note?: unknown }).note ?? null, 'no note is sent').toBeNull();
    await expect(page.getByRole('button', { name: t('Undo'), exact: true })).toBeVisible();
    await ux.check('pool mark', [...STD, 'AZ']);
  },
);
