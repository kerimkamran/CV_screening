import type { Page } from '@playwright/test';
import { hasRing, pageScrollsSideways, tabTo } from '../fixtures/pkg-c';
import {
  adjustments,
  AYSEL,
  bandRows,
  cards,
  crow,
  docOf,
  DVID,
  esc,
  gets,
  onBackgrounds,
  resultsApi,
  scrOf,
  stars,
  starMap,
  T,
  type CRow,
} from '../fixtures/pkg-d';
import { SENAI_ON } from '../fixtures/api';
import { expect, STD, uat } from '../ux/test';

// 7.12 Results and star map (RS), 7.13 Requirements drawer (RQ), 7.16 Runs tab (RN), layer L1.
// UAT plan v1.1; each case is the row of the same ID.

const open = (page: Page, tab = 'results') => page.goto(`/#/vacancies/${DVID}/${tab}`);
const legend = (page: Page, lang: 'en' | 'az') =>
  page.getByRole('list', { name: T(lang)('Candidates by match') });

uat(
  'RS-01',
  'Results on desktop: heading, counts, legend, star map, cards, 4 backgrounds',
  { on: ['D', 'DW', 'DS', 'E'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const rows = bandRows({ strong: 6, good: 8, partial: 8, limited: 5, human: 3 });
    await resultsApi(page, { rows, adj: adjustments() });
    await open(page);
    await expect(
      page.getByRole('heading', { level: 2, name: t('Your constellation') }),
    ).toBeVisible();
    await expect
      .soft(page.getByText(t('Select a star. Brighter means a better fit.'), { exact: true }))
      .toBeVisible();
    await expect
      .soft(page.getByRole('button', { name: t('Requirements'), exact: true }))
      .toBeVisible();
    await expect
      .soft(page.getByText(t('{n} CVs in this scan', { n: 30 }), { exact: true }))
      .toBeVisible();
    await expect
      .soft(
        page.getByText(
          t('{read} read, {scored} scored, {human} need a human look', {
            read: 30,
            scored: 27,
            human: 3,
          }),
          { exact: true },
        ),
      )
      .toBeVisible();
    const lg = legend(page, meta.lang).getByRole('listitem');
    const want = [
      ['Strong', 6],
      ['Good', 8],
      ['Partial', 8],
      ['Limited', 5],
      ['Needs a human look', 3],
    ] as const;
    for (const [i, [b, n]] of want.entries())
      await expect.soft(lg.nth(i)).toHaveText(`${t(b)} ${n}`);
    const box = await starMap(page).boundingBox();
    expect.soft(Math.round(box!.height), 'star map 360 px tall').toBe(360);
    await expect.soft(stars(page)).toHaveCount(12);
    await expect.soft(cards(page, meta.lang)).toHaveCount(20);
    const first = cards(page, meta.lang).first();
    await expect.soft(first.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
    await expect.soft(first).toHaveClass(/border-accent/);
    // Star names on the navy map: light text on #0C1A3D.
    const label = starMap(page).locator('span.whitespace-nowrap').first();
    await expect.soft(label).toHaveCSS('color', 'rgb(232, 238, 255)');
    await ux.check('results', [...STD, 'AZ']);
    await onBackgrounds(page, meta.lang, async (bg) => {
      await ux.check(`background ${bg}`, ['AXE']);
    });
  },
);

uat(
  'RS-03',
  'Star map by keyboard: arrows, Home, End, Enter, spoken summary',
  { on: ['D', 'E'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await resultsApi(page, { rows: bandRows({ strong: 4, good: 4, partial: 4 }) });
    await open(page);
    const s = stars(page);
    await expect(s).toHaveCount(12);
    expect(await tabTo(page, s.first()), 'Tab reaches the first star').toBe(true);
    expect.soft(await hasRing(s.first()), 'visible focus outline').toBe(true);
    const at = () =>
      s.evaluateAll((els) => els.indexOf(document.activeElement as HTMLButtonElement) + 1);
    const seq: number[] = [];
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await page.keyboard.press(k);
      seq.push(await at());
    }
    expect.soft(seq, 'rank order 2, 3, 4, 3, 2').toEqual([2, 3, 4, 3, 2]);
    await page.keyboard.press('End');
    expect.soft(await at()).toBe(12);
    await page.keyboard.press('Home');
    expect.soft(await at()).toBe(1);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect
      .soft(cards(page, meta.lang).nth(1).getByRole('button').first())
      .toHaveAttribute('aria-expanded', 'true');
    await expect.soft(s.nth(1)).toHaveAttribute('aria-pressed', 'true');
    const sec = page.getByRole('region', { name: t('Star map') });
    const desc = await sec.evaluate(
      (el) =>
        document
          .getElementById(el.getAttribute('aria-describedby') ?? '')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim() ?? '',
    );
    expect
      .soft(
        desc.startsWith(
          t('Star map, a picture of the ranked list below. {n} stars, best first:', { n: 12 }),
        ),
        desc,
      )
      .toBe(true);
    expect.soft(desc).toContain(`${t('; and more')}.`);
    expect
      .soft(desc.endsWith(t('Use the arrow keys to move between stars and Enter to select one.')))
      .toBe(true);
    await ux.check('keyboard', [...STD, 'AZ']);
  },
);

uat(
  'RS-04',
  "'Show all' and 'Show top 12 only' on the star map (up to 79 stars)",
  { on: ['D', 'DW'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const always = page.getByText(t("A star's place on the map has no meaning beyond its rank."));
    // A: 30 scored.
    await resultsApi(page, { rows: bandRows({ strong: 10, good: 10, partial: 10 }) });
    await open(page);
    await expect(stars(page)).toHaveCount(12);
    await expect
      .soft(page.getByText(t('Showing top {n} of {total}.', { n: 12, total: 30 })))
      .toBeVisible();
    await page.getByRole('button', { name: t('Show all'), exact: true }).click();
    await expect.soft(stars(page)).toHaveCount(30);
    await page.getByRole('button', { name: t('Show top {n} only', { n: 12 }) }).click();
    await expect.soft(stars(page)).toHaveCount(12);
    await expect.soft(always).toBeVisible();
    await ux.check('A', [...STD, 'AZ']);
    // B: 100 scored.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, {
      rows: Array.from({ length: 100 }, (_, i) => crow(i + 1, { score: 99 - (i % 50) })),
    });
    await page.reload();
    await expect(stars(page)).toHaveCount(12);
    await page.getByRole('button', { name: t('Show all'), exact: true }).click();
    await expect.soft(stars(page)).toHaveCount(79);
    await expect
      .soft(page.getByText(t('Showing top {n} of {total}.', { n: 79, total: 100 })))
      .toBeVisible();
    // SD-96: no 'Show all' that does nothing; 'Show top 12 only' is offered.
    await expect
      .soft(
        page.getByRole('button', { name: t('Show all'), exact: true }),
        "no 'Show all' left that does nothing",
      )
      .toHaveCount(0);
    const back = page.getByRole('button', { name: t('Show top {n} only', { n: 12 }) });
    await expect.soft(back, "'Show top 12 only' offered at 79 of 100").toBeVisible();
    if (await back.count()) {
      await back.click();
      await expect.soft(stars(page)).toHaveCount(12);
    }
    await expect.soft(always).toBeVisible();
    await ux.check('B', [...STD, 'AZ']);
  },
);

uat(
  'RS-07',
  'Candidate card: expand, score line, Why, proof chips with quotes and page, not found, errors, links',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    ux.allow(/500/);
    // Card 2: 2 found (quotes on pages 1 and 2), 1 partly without quote, 1 missing 'CCIE certification'.
    const rows: CRow[] = [
      crow(1, { score: 92 }),
      crow(2, { score: 88, statuses: ['met', 'met', 'not_found', 'partially_met', 'not_found'] }),
      crow(3, { score: 84 }),
      crow(4, { score: 76 }),
    ];
    // Only 4 requirements for card 2: drop Python (index 4) from its breakdown.
    rows[1]!.score!.breakdown.items.splice(4, 1);
    const body2 = {
      summary: 'Six years of carrier BGP and OSPF work.',
      aiProvider: 'Fake AI',
      aiModel: 'fake-1',
      assessments: [
        {
          requirementId: rows[1]!.score!.breakdown.items[0]!.requirementId,
          text: 'BGP routing',
          status: 'met',
          rationale: null,
          evidence: [{ quote: 'BGP route reflectors for the core', page: 1 }],
        },
        {
          requirementId: rows[1]!.score!.breakdown.items[1]!.requirementId,
          text: 'OSPF',
          status: 'met',
          rationale: null,
          evidence: [{ quote: 'OSPF areas redesigned', page: 2 }],
        },
        {
          requirementId: rows[1]!.score!.breakdown.items[2]!.requirementId,
          text: 'CCIE certification',
          status: 'not_found',
          rationale: null,
          evidence: [],
        },
        {
          requirementId: rows[1]!.score!.breakdown.items[3]!.requirementId,
          text: '5G transport experience',
          status: 'partially_met',
          rationale: null,
          evidence: [],
        },
      ],
    };
    await resultsApi(page, {
      rows,
      assistant: SENAI_ON,
      detail: (sid) =>
        sid === scrOf(2)
          ? { delay: 1000, body: body2 }
          : sid === scrOf(3)
            ? { status: 500 }
            : undefined,
    });
    await open(page);
    const c = cards(page, meta.lang);
    await expect(c).toHaveCount(4);
    const head = (i: number) => c.nth(i).getByRole('button').first();
    await head(1).click();
    await expect.soft(head(1)).toHaveAttribute('aria-expanded', 'true');
    await expect.soft(head(0)).toHaveAttribute('aria-expanded', 'false');
    await expect.soft(c.nth(1).getByText(t('Loading the reasons…'))).toBeVisible();
    await expect.soft(c.nth(1).getByText(t('Why'), { exact: false }).first()).toBeVisible();
    await expect.soft(c.nth(1).getByText(body2.summary)).toBeVisible();
    await head(1).click();
    await expect
      .soft(head(1), 'pressing an open header keeps it open')
      .toHaveAttribute('aria-expanded', 'true');
    await expect
      .soft(c.nth(1).getByText(t('Score {n} of 100. A sorting aid, not a decision.', { n: 88 })))
      .toBeVisible();
    const chips = c
      .nth(1)
      .getByRole('list', { name: t('Requirements') })
      .getByRole('button');
    await expect(chips).toHaveCount(4);
    const marks = await chips.evaluateAll((bs) => bs.map((b) => (b.textContent ?? '').trim()[0]));
    expect
      .soft(
        marks.every((m) => m === '✓' || m === '~' || m === '✗'),
        `chips start with ✓, ~ or ✗: ${marks.join(' ')}`,
      )
      .toBe(true);
    const chip = (text: string, kind: string) =>
      c.nth(1).getByRole('button', {
        name: t('{text}: {kind}. Show the proof', { text, kind: t(kind) }),
      });
    // Found with a quote on page 1.
    await chip('BGP routing', 'Found').click();
    const proof = (text: string) =>
      c.nth(1).getByRole('region', { name: t('Proof for {text}', { text }) });
    await expect.soft(proof('BGP routing')).toContainText('BGP route reflectors for the core');
    await expect.soft(proof('BGP routing')).toContainText(t('page {n}', { n: 1 }));
    await chip('OSPF', 'Found').click();
    await expect.soft(proof('OSPF')).toContainText(t('page {n}', { n: 2 }));
    await chip('5G transport experience', 'Partly found').click();
    await expect
      .soft(proof('5G transport experience'))
      .toContainText(t('No quote was kept for this requirement.'));
    await chip('CCIE certification', 'Not found').click();
    const miss = proof('CCIE certification');
    await expect
      .soft(miss)
      .toContainText(
        t('Not found in this CV. Searched for: {text}.', { text: 'CCIE certification' }),
      );
    // not_found is never shown as 'not met' / 'Missing'.
    expect.soft(await c.nth(1).innerText()).not.toMatch(/not met|Missing/i);
    await ux.check('proof', [...STD, 'AZ']);
    await chip('CCIE certification', 'Not found').click();
    await expect.soft(miss).toHaveCount(0);
    // Card 3: the detail fails.
    await head(2).click();
    await expect.soft(c.nth(2).getByText(t('The reasons could not be loaded.'))).toBeVisible();
    // Every expanded card with a score shows its chips.
    for (let i = 0; i < 4; i++) {
      await head(i).click();
      const scoreLine = c
        .nth(i)
        .getByText(
          new RegExp(
            esc(t('Score {n} of 100. A sorting aid, not a decision.', { n: 999 })).replace(
              '999',
              '\\d+',
            ),
          ),
        );
      if (await scoreLine.count())
        await expect
          .soft(
            c.nth(i).getByRole('list', { name: t('Requirements') }),
            `card ${i + 1}: no score without its breakdown`,
          )
          .toBeVisible();
    }
    // Ask SenAI and the review link.
    await head(1).click();
    await c
      .nth(1)
      .getByRole('button', { name: t('Ask {name} about this candidate', { name: 'SenAI' }) })
      .click();
    await expect.soft(page.getByRole('complementary', { name: t('Assistant') })).toBeVisible();
    await ux.check('assistant', [...STD, 'AZ']);
    await page.keyboard.press('Escape');
    const link = c
      .nth(1)
      .getByRole('link', { name: t('Open the full review and record a decision') });
    await expect.soft(link).toHaveAttribute('href', new RegExp(`^#/cv/${docOf(2)}`));
    // SenAI off: no Ask button.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await resultsApi(page, { rows });
    await page.reload();
    await expect(cards(page, meta.lang)).toHaveCount(4);
    await expect
      .soft(
        page.getByRole('button', {
          name: new RegExp(
            esc(t('Ask {name} about this candidate', { name: 'XX' })).replace('XX', '.+'),
          ),
        }),
      )
      .toHaveCount(0);
  },
);

uat(
  'RS-13',
  "'Needs a human look' list and labels that name tabs that exist",
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const rows = [
      ...bandRows({ strong: 2, good: 2 }),
      crow(10, { score: null, state: 'failed', error: 'model timeout' }),
      crow(11, { score: null, state: 'completed', knockout: true, band: 'needs_review' }),
      crow(12, { score: null, state: 'manual', parseStatus: 'empty' }),
      crow(13, { score: null, state: 'queued' }),
      crow(14, { score: null, state: 'queued' }),
    ];
    await resultsApi(page, { rows });
    await open(page);
    await expect
      .soft(page.getByRole('heading', { level: 3, name: t('Needs a human look ({n})', { n: 3 }) }))
      .toBeVisible();
    await expect
      .soft(page.getByText(t('These could not be scored. Open the original and read it yourself.')))
      .toBeVisible();
    for (const r of ['screening failed', 'a knockout rule matched', 'no readable text'])
      await expect.soft(page.getByText(new RegExp(`· ${esc(t(r))}$`))).toBeVisible();
    await expect
      .soft(page.getByRole('link', { name: t('Open'), exact: true }).first())
      .toHaveAttribute('href', new RegExp(`^#/cv/${docOf(10)}`));
    // SD-32 / SD-94: every label names a tab that exists (Candidates, Runs), never 'Table' or 'Past scans'.
    const text = await page.getByRole('tabpanel').innerText();
    const bad = meta.lang === 'az' ? /Cədvəl|Keçmiş yoxlamalar/ : /\bTable\b|Past scans/;
    expect
      .soft(text.match(new RegExp(bad.source, 'g')) ?? [], 'labels name tabs that do not exist')
      .toEqual([]);
    await ux.check('human look', [...STD, 'AZ']);
    // The retry action on the failed row lands on the Candidates tab.
    const retry = page
      .getByRole('listitem')
      .filter({ hasText: t('screening failed') })
      .getByRole('button');
    await retry.click();
    await expect.soft(page).toHaveURL(new RegExp(`#/vacancies/${DVID}/candidates`));
  },
);

uat(
  'RS-15',
  'Results states: no CVs, no AI provider, loading, error, skipped list',
  { on: ['D', 'A'] },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    ux.allow(/500/);
    const scen = async (o: Parameters<typeof resultsApi>[1]) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await resultsApi(page, o);
      await page.goto('about:blank');
      await open(page);
    };
    // A: no CVs.
    await scen({ rows: [] });
    await expect
      .soft(
        page.getByText(
          t('No CVs yet. Add CVs on the CVs card above, then choose “Find the best fit”.'),
        ),
      )
      .toBeVisible();
    await ux.check('A', [...STD, 'AZ']);
    // B: no AI provider, 5 queued.
    await scen({
      rows: Array.from({ length: 5 }, (_, i) => crow(i + 1, { score: null, state: 'queued' })),
      aiActive: false,
    });
    await expect
      .soft(
        page.getByText(
          t(
            'No AI provider is active, so CVs wait in the queue. An administrator can set one up under Admin → AI models.',
          ),
        ),
      )
      .toBeVisible();
    await ux.check('B', [...STD, 'AZ']);
    // C: delayed.
    await scen({
      rows: bandRows({ strong: 2 }),
      answers: {
        [`GET /vacancies/${DVID}/candidates`]: async () => {
          await new Promise((r) => setTimeout(r, 2000));
          return undefined;
        },
      },
    });
    await expect.soft(page.getByRole('tabpanel').getByText(t('Loading…'))).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: t('Your constellation') }),
    ).toBeVisible();
    // D: 500.
    await scen({
      rows: bandRows({ strong: 2 }),
      answers: {
        [`GET /vacancies/${DVID}/candidates`]: async (route) => {
          await route.fulfill({
            status: 500,
            json: { statusCode: 500, message: 'Database not reachable' },
          });
          return true;
        },
      },
    });
    await expect
      .soft(page.getByRole('tabpanel').getByText(t('Database not reachable')))
      .toBeVisible();
    await ux.check('D', [...STD, 'AZ']);
    // E: skipped files.
    await scen({
      rows: bandRows({ strong: 2 }),
      skipped: {
        skipped: [
          { filename: 'a.png', reason: 'Not a CV file type' },
          { filename: 'b.zip', reason: 'Not a CV file type' },
        ],
      },
    });
    const see = page.getByRole('button', { name: t('see which') });
    await expect.soft(page.getByText(t('{n} skipped,', { n: 2 }))).toBeVisible();
    await expect.soft(see).toHaveAttribute('aria-expanded', 'false');
    await see.click();
    await expect.soft(page.getByText('a.png: Not a CV file type')).toBeVisible();
    await expect
      .soft(page.getByRole('button', { name: t('hide which') }))
      .toHaveAttribute('aria-expanded', 'true');
    await ux.check('E', [...STD, 'AZ']);
  },
);

uat(
  'RQ-01',
  'Requirements drawer: open, contents, Close, Escape, phones, 4 backgrounds',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await resultsApi(page, {
      rows: bandRows({ strong: 2, good: 2 }),
      adj: adjustments({ knockouts: ['No work permit'] }),
    });
    await open(page);
    const btn = page.getByRole('button', { name: t('Requirements'), exact: true });
    await expect.soft(btn).toHaveAttribute('aria-haspopup', 'dialog');
    await btn.click();
    const dlg = page.getByRole('dialog', { name: t('Requirements') });
    await expect(dlg).toBeVisible();
    await expect.soft(btn).toHaveAttribute('aria-expanded', 'true');
    await expect.soft(dlg).toBeFocused();
    await expect.soft(dlg.getByText(t('No changes since the first scan.'))).toBeVisible();
    await expect
      .soft(
        dlg.getByText(
          t(
            'Change what counts and the list re-ranks. No CV is read again. A missing must-have lowers the match; it never hides anyone.',
          ),
        ),
      )
      .toBeVisible();
    const groups = dlg.getByRole('group');
    await expect.soft(groups).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      const g = groups.nth(i);
      for (const k of ['Must-have', 'Nice-to-have', 'Ignore'])
        await expect.soft(g.getByRole('radio', { name: t(k) })).toHaveCount(1);
      await expect
        .soft(g.getByRole('radio', { name: t(i < 3 ? 'Must-have' : 'Nice-to-have') }))
        .toBeChecked();
    }
    await expect
      .soft(
        dlg.getByText(
          t('Knockout rules ({n}) are not changed here. They only send a CV to a human look.', {
            n: 1,
          }),
        ),
      )
      .toBeVisible();
    await expect.soft(dlg.getByRole('button', { name: t('Back to original') })).toBeDisabled();
    if (meta.dev === 'A' || meta.dev === 'I') {
      const w = await dlg.boundingBox();
      expect.soft(Math.round(w!.width), 'full width on phones').toBe(page.viewportSize()!.width);
    }
    await ux.check('drawer', [...STD, 'AZ'], { overlay: 'aside[role=dialog]' });
    // The drawer (z-30) starts at the top of the viewport, under the sticky app header (z-40).
    const close = dlg.getByRole('button', { name: t('Close'), exact: true });
    const hit = await close.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!e && b.contains(e);
    });
    expect.soft(hit, "'Close' is on top (not covered by the app header)").toBe(true);
    if (hit) await close.click();
    else await page.keyboard.press('Escape');
    await expect.soft(dlg).toHaveCount(0);
    await btn.click();
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.soft(dlg).toHaveCount(0);
    // The drawer is a modal: the page behind, the account menu with it, is out of reach while it
    // is open. Each background is chosen with the drawer closed, then the drawer is checked on it.
    await onBackgrounds(page, meta.lang, async (bg) => {
      await btn.click();
      await expect(dlg).toBeVisible();
      await ux.check(`background ${bg}`, ['AXE'], { overlay: 'aside[role=dialog]' });
      await page.keyboard.press('Escape');
      await expect(dlg).toHaveCount(0);
    });
  },
);

uat(
  'RQ-04',
  'Requirements drawer behaves as a modal dialog: trap, inert page, backdrop, focus return, focus kept',
  { on: ['D', 'T'], langs: 'EN' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    await resultsApi(page, { rows: bandRows({ strong: 2, good: 2 }) });
    await open(page);
    const btn = page.getByRole('button', { name: t('Requirements'), exact: true });
    await btn.click();
    const dlg = page.getByRole('dialog', { name: t('Requirements') });
    await expect(dlg).toBeVisible();
    await expect.soft(dlg, 'aria-modal').toHaveAttribute('aria-modal', 'true');
    let left = 0;
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      if (!(await dlg.evaluate((d) => d.contains(document.activeElement)))) left++;
    }
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Shift+Tab');
      if (!(await dlg.evaluate((d) => d.contains(document.activeElement)))) left++;
    }
    expect.soft(left, 'Tab presses that left the drawer').toBe(0);
    // The page behind: a star the drawer does not cover is not reachable.
    if (meta.dev === 'D') {
      const st = stars(page).nth(0);
      const b = (await st.boundingBox())!;
      const hit = await page.evaluate(
        ([x, y]) => {
          const e = document.elementFromPoint(x!, y!);
          return e ? `${e.tagName}${e.closest('[data-star]') ? ' (star)' : ''}` : 'none';
        },
        [b.x + b.width / 2, b.y + b.height / 2],
      );
      expect
        .soft(hit.includes('(star)'), `elementFromPoint on a star behind the drawer hits ${hit}`)
        .toBe(false);
    }
    await page.keyboard.press('Escape');
    await expect.soft(dlg).toHaveCount(0);
    await expect.soft(btn, 'focus returns to the Requirements button').toBeFocused();
    await ux.check('closed', STD);
  },
);

uat(
  'RN-01',
  'Runs tab: loading, empty, rows, running count, many runs, load error, phones, 4 backgrounds',
  { on: 'All' },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    ux.allow(/500/);
    const runOf = (v: number, read: number, total: number, scored: number, running: number) => ({
      id: `01K00000000000000000RUN${String(v).padStart(3, '0')}`,
      version: v,
      requirementsVersion: v,
      frozenAt: new Date(Date.now() - (4 - v) * 86_400_000).toISOString(),
      total,
      read,
      scored,
      running,
      finishedAt: running ? null : new Date().toISOString(),
    });
    const scen = async (
      runs: unknown,
      delay = 0,
      status = 200,
      counts: Record<string, number> = {},
    ) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      const r = await resultsApi(page, {
        rows: bandRows({ strong: 2, good: 1 }),
        view: counts.running
          ? { counts: { documents: 30, analyzed: 25, running: counts.running } }
          : {},
        answers: {
          [`GET /vacancies/${DVID}/runs`]: async (route) => {
            if (delay) await new Promise((res) => setTimeout(res, delay));
            if (status !== 200)
              await route.fulfill({
                status,
                json: { statusCode: status, message: 'Database not reachable' },
              });
            else await route.fulfill({ json: runs });
            return true;
          },
        },
      });
      await page.goto('about:blank');
      await open(page, 'runs');
      return r.seen;
    };
    const panel = page.getByRole('tabpanel');
    // A: loading.
    await scen([runOf(1, 3, 3, 3, 0)], 2000);
    await expect.soft(panel.getByText(t('Loading…'))).toBeVisible();
    // B: none.
    await scen([]);
    await expect.soft(panel.getByText(t('No analysis has been run yet.'))).toBeVisible();
    // C: 3 runs, one running.
    const seen = await scen(
      [runOf(3, 25, 30, 22, 5), runOf(2, 30, 30, 27, 0), runOf(1, 30, 30, 26, 0)],
      0,
      200,
      { running: 5 },
    );
    const list = page.getByRole('list', { name: t('Runs') });
    await expect.soft(list.getByRole('listitem')).toHaveCount(3);
    const r1 = list.getByRole('listitem').first();
    await expect.soft(r1).toContainText(t('Run {n}', { n: 3 }));
    await expect.soft(r1).toContainText(t('Started {when}', { when: '' }).trim());
    await expect
      .soft(r1)
      .toContainText(
        `${t('{a} of {b} read', { a: 25, b: 30 })} · ${t('{n} scored', { n: 22 })} · ${t('{n} running', { n: 5 })}`,
      );
    const before = gets(seen, /\/runs$/).length;
    await expect
      .poll(() => gets(seen, /\/runs$/).length, { timeout: 7000, message: 'a new GET after 4 s' })
      .toBeGreaterThan(before);
    expect.soft(await pageScrollsSideways(page), 'no sideways scroll').toBe(false);
    await ux.check('C', [...STD, 'AZ']);
    // D: 25 runs.
    await scen(Array.from({ length: 25 }, (_, i) => runOf(25 - i, 30, 30, 27, 0)));
    await expect.soft(list.getByRole('listitem')).toHaveCount(25);
    await ux.check('D', [...STD, 'AZ']);
    // E: a load error is an error, not 'No analysis has been run yet.' (SD-58).
    await scen([], 0, 500);
    await expect
      .soft(panel.getByRole('alert').or(panel.locator('[class*=err]')).first(), 'an error notice')
      .toBeVisible({ timeout: 3000 });
    await expect
      .soft(
        panel.getByText(t('No analysis has been run yet.')),
        "not 'No analysis has been run yet.'",
      )
      .toHaveCount(0);
    await expect
      .soft(page.getByTestId('last-run'), "not 'Last run: none yet'")
      .not.toContainText(t('none yet'));
    await ux.check('E', [...STD, 'AZ']);
    await scen([runOf(1, 3, 3, 3, 0)]);
    await expect(list).toBeVisible();
    await onBackgrounds(page, meta.lang, async (bg) => ux.check(`background ${bg}`, ['AXE']));
  },
);

void AYSEL;
