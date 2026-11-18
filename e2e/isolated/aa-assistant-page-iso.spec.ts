import { expect, STD, uat } from '../ux/test';
import { accounts, openAs } from '../fullstack/stack';

// 7.x SenAI admin page (SX), isolated stack: the empty states need a database where nobody has
// asked, changed or added anything yet. This file sorts first so it runs right after a reset
// (iso-up.sh reset); a later run shows the same page with content in it and fails on purpose.

uat(
  'SX-12',
  'Admin > Assistant page: loading, errors, empty states and layout',
  { on: ['D', 'DS', 'T', 'A'], langs: 'EN', timeout: 120_000 },
  async ({ page, ux }) => {
    ux.allow(/500/);
    const acc = accounts();
    const overview = /\/admin\/assistant(\?.*)?$/;
    const loaded = page.getByLabel('Turn the assistant on');

    // 1) The settings arrive after two seconds: 'Loading…' meanwhile.
    await page.route(overview, async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
    await openAs(page, acc.admin, '#/admin/assistant');
    await expect(page.getByText('Loading…').first()).toBeVisible();
    await ux.check('loading', STD);
    await expect(loaded).toBeVisible();
    await page.unroute(overview);

    // 2) The settings fail with a 500: a readable notice, no stack and no raw JSON.
    await page.route(overview, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }),
      }),
    );
    await page.reload();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    const said = (await alert.innerText()).trim();
    expect(said.length, 'the notice says something').toBeGreaterThan(5);
    expect(said).not.toMatch(/[{}]|undefined|\bat \S+ \(|statusCode/);
    await ux.check('error', STD);
    await page.unroute(overview);

    // 3) Normally, on the fresh database: every list says it is empty, and a company can be added.
    await page.reload();
    await expect(loaded).toBeVisible();
    await expect(page.getByText('Nothing yet.', { exact: true })).toBeVisible();
    await expect(page.getByText('No questions yet.', { exact: true })).toBeVisible();
    await expect(page.getByText('No model call yet.', { exact: true })).toBeVisible();
    await expect(page.getByText('No words added yet.', { exact: true })).toBeVisible();
    const add = page.getByRole('region', { name: 'Add an API for SenAI' });
    await expect(add).toBeVisible();
    await expect(add.getByLabel('Company')).toBeVisible();
    await expect(add.getByLabel(/^API key/)).toBeVisible();
    await expect(add.getByRole('list', { name: 'Models' })).toBeVisible();

    // 4) The whole page, top to bottom, at this width.
    const wide = await page.evaluate(async () => {
      const h = () => document.documentElement.scrollHeight;
      let widest = 0;
      for (let y = 0; y <= h(); y += window.innerHeight * 0.7) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        widest = Math.max(widest, document.documentElement.scrollWidth - window.innerWidth);
      }
      window.scrollTo(0, 0);
      return widest;
    });
    expect(wide, 'no horizontal page scroll').toBeLessThanOrEqual(0);
    const cards = await page.locator('main section').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { right: r.right, left: r.left, w: window.innerWidth };
      }),
    );
    for (const c of cards) {
      expect(c.left, 'a card starts inside the page').toBeGreaterThanOrEqual(-1);
      expect(c.right, 'a card ends inside the page').toBeLessThanOrEqual(c.w + 1);
    }
    await ux.check('empty states', STD);

    // Save and Test show their answer next to their own button, inside the window. The service's
    // answers are stood in for, so the page stays empty for the devices that run after this one.
    await page.route(/\/admin\/assistant\/test$/, (route) =>
      route.fulfill({
        json: { ok: true, detail: 'Anthropic / claude-fake-1 answered in the expected shape.' },
      }),
    );
    await page.route(overview, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({ response: await route.fetch({ method: 'GET', postData: undefined }) });
    });
    const near = async (button: string, answer: RegExp | string) => {
      const b = page.getByRole('button', { name: button, exact: true });
      await b.scrollIntoViewIfNeeded();
      await b.click();
      const msg = page.getByText(answer, { exact: typeof answer === 'string' }).first();
      await expect(msg).toBeVisible();
      await expect(msg, `${button}: the answer is in the window`).toBeInViewport();
      const [bb, mb] = [await b.boundingBox(), await msg.boundingBox()];
      expect(Math.abs(mb!.y - bb!.y), `${button}: the answer is next to the button`).toBeLessThan(
        140,
      );
    };
    await near('Test connection', /answered in the expected shape\./);
    await near('Save', 'Saved.');
    await ux.check('after save', STD);
  },
);
