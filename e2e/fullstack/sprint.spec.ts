import { cvText } from '../fixtures/files';
import { expect, STD, uat } from '../ux/test';
import { accounts, db, login, openAs, screenedVacancy, uniq } from './stack';

/**
 * UAT package E, layer L2: a review sprint over a 12-CV list with the real API (SP-08).
 * Every person here is invented.
 */

const STORED: Record<string, string> = {
  shortlist: 'shortlist',
  maybe: 'hold',
  not_now: 'reject',
  new: 'new',
};

uat(
  'SP-08',
  'Sprint over a 12-CV list end to end',
  { on: ['D'], langs: 'EN', timeout: 120_000 },
  async ({ page, ux }) => {
    const acc = accounts();
    const token = await login(acc.recruiter);
    const tag = uniq('Sprint').split(' ')[1];
    const files = Array.from({ length: 12 }, (_, i) => ({
      name: `sprint-${tag}-${String(i + 1).padStart(2, '0')}.txt`,
      type: 'text/plain',
      data: cvText(
        `Sprint Person ${tag} ${i + 1}`,
        i % 2
          ? ['BGP routing in a carrier network.', 'Kubernetes production clusters.']
          : ['BGP routing in a carrier network.'],
      ),
    }));
    const v = await screenedVacancy(token, { title: uniq('UAT Sprint Network Engineer'), files });
    await openAs(page, acc.recruiter, `#/vacancies/${v.id}/candidates`);
    const items = page.locator('li[id^=cand-]');
    await expect(items).toHaveCount(12);
    const order = await items.evaluateAll((l) => l.map((x) => x.id.slice(5)));
    await items.first().getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`#/cv/${order[0]}\\?l=`));
    const keys = ['s', 'm', 'n'];
    const want: Record<string, string> = {};
    const slow: number[] = [];
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (let i = 0; i < 12; i++) {
      const k = keys[i % 3]!;
      const t0 = Date.now();
      await page.keyboard.press(k);
      want[order[i]!] = { s: 'shortlist', m: 'maybe', n: 'not_now' }[k]!;
      if (i < 11) {
        await expect(page).toHaveURL(new RegExp(`#/cv/${order[i + 1]}\\?l=`));
        await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
        slow.push(Date.now() - t0);
      }
      if (i === 4) {
        // Undo once on the way: the decision on CV 5 goes back to New.
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
        want[order[4]!] = 'new';
      }
    }
    await expect(
      page.getByRole('heading', { name: 'That was the last CV in this list.' }),
    ).toBeVisible();
    await ux.check('summary');
    const count = (m: string) => Object.values(want).filter((x) => x === m).length;
    for (const m of ['shortlist', 'maybe', 'not_now'] as const) {
      const label = { shortlist: 'Shortlist', maybe: 'Maybe', not_now: 'Not now' }[m];
      await expect(page.getByText(`${count(m)} ${label}`, { exact: true })).toBeVisible();
    }
    // The stored decisions: 12 key decisions and 1 Undo, by the recruiter, no conflict.
    const rows = await db<{ document_id: string; outcome: string; decided_by: string }>(
      `SELECT s.document_id, d.outcome::text AS outcome, d.decided_by FROM decision d JOIN screening s ON s.id = d.screening_id
      WHERE s.document_id = ANY($1) ORDER BY d.decided_at, d.id`,
      [order],
    );
    expect(rows).toHaveLength(13);
    expect(rows.every((r) => r.decided_by === acc.recruiter.userId)).toBe(true);
    const latest: Record<string, string> = {};
    for (const r of rows) latest[r.document_id] = r.outcome;
    for (const id of order) expect(latest[id], id).toBe(STORED[want[id]!]);
    expect(Math.max(...slow), 'each key press reaches the next CV within 1 s').toBeLessThan(1000);
    // Back to the list: each row shows its new mark.
    await page
      .getByRole('link', { name: /← Back to/ })
      .first()
      .click();
    await expect(items).toHaveCount(12);
    for (const id of order)
      await expect(page.locator(`#cand-${id}`).getByRole('combobox')).toHaveValue(want[id]!);
    expect(STD.length).toBeGreaterThan(0);
  },
);
