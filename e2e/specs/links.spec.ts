import { DID, DID2, MID, SENAI_ON } from '../fixtures/api';
import { reviewApi, SPRINT, storeList, words } from '../fixtures/pkg-e';
import { expect, STD, uat } from '../ux/test';
import type { Page, Route } from '@playwright/test';

/**
 * UAT package E: the links a candidate gave (LK-01 … LK-04, layer L1). A page is read only after
 * a recorded consent and only when the recruiter presses the button. Every person here is invented.
 */

const BASE = `/assistant/candidates/${MID}/links`;
const LINKS = [
  { url: 'https://github.com/aysel', host: 'github.com', blocked: false },
  { url: 'https://linkedin.com/in/aysel', host: 'linkedin.com', blocked: true },
  { url: 'https://example.az/portfolio', host: 'example.az', blocked: false },
];
const CONSENT = {
  source: 'application_form',
  evidence: 'Form 12, 20 Oct',
  recordedBy: 'Ayla Karimova',
  recordedAt: new Date().toISOString(),
};
const review = (host: string, url: string, flagged: boolean) => ({
  id: `R-${host}`,
  url,
  host,
  text: `[name removed] builds carrier networks. Contact: [phone removed], [e-mail removed]. ${host}`,
  words: 120,
  flagged,
  fetchedAt: new Date().toISOString(),
});

interface LinkOpts {
  state?: Record<string, unknown> | null;
  assistant?: Record<string, unknown>;
  consent?: (body: unknown) => { status: number; body: unknown } | undefined;
  read?: (body: { url: string }) => { status: number; body: unknown; delay?: number } | undefined;
  withdraw?: () => { status: number; body: unknown } | undefined;
  /** Load the page (false: the test reloads it itself). */
  goto?: boolean;
}

async function linksApi(page: Page, o: LinkOpts = {}) {
  let st: Record<string, unknown> = {
    enabled: true,
    consent: null,
    links: LINKS,
    reviews: [],
    ...(o.state ?? {}),
  };
  const seen = await reviewApi(page, SPRINT.slice(0, 2), {
    assistant: o.assistant ?? SENAI_ON,
    more: async (route: Route, url: URL) => {
      const p = url.pathname;
      const m = route.request().method();
      if (p === BASE && m === 'GET') {
        await route.fulfill({ json: o.state === null ? null : st });
        return true;
      }
      if (p === `${BASE}/consent` && m === 'POST') {
        const body = route.request().postDataJSON();
        const f = o.consent?.(body);
        if (f) return route.fulfill({ status: f.status, json: f.body }).then(() => true);
        st = { ...st, consent: CONSENT };
        await route.fulfill({ json: st });
        return true;
      }
      if (p === `${BASE}/review` && m === 'POST') {
        const body = route.request().postDataJSON() as { url: string };
        const f = o.read?.(body);
        if (f?.delay) await new Promise((r) => setTimeout(r, f.delay));
        if (f && f.status !== 200)
          return route.fulfill({ status: f.status, json: f.body }).then(() => true);
        const host = new URL(body.url).host;
        st = {
          ...st,
          reviews: [...(st.reviews as unknown[]), review(host, body.url, host === 'example.az')],
        };
        await route.fulfill({ json: st });
        return true;
      }
      if (p === `${BASE}/consent` && m === 'DELETE') {
        st = { ...st, consent: null, reviews: [] };
        await route.fulfill({ json: st });
        return true;
      }
      return false;
    },
  });
  if (o.goto === false) return seen;
  await storeList(page, [DID, DID2]);
  await page.goto(`/#/cv/${DID}?l=e2e-list`);
  await expect(page.getByRole('heading', { level: 1, name: 'Aysel Məmmədova' })).toBeVisible();
  return seen;
}
const card = (page: Page, w: ReturnType<typeof words>) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: w('Links the candidate gave') }) });

// ------------------------------------------------------------------------------------------ LK-01
uat(
  'LK-01',
  'Links card shows only when link review is on and the CV has links',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    await linksApi(page);
    const c = card(page, w);
    await expect(c).toBeVisible();
    await expect(c).toContainText(
      w(
        'A page is read only with the candidate’s recorded consent and only when you press the button. Contact details and the name are removed, and the text is not scored.',
      ),
    );
    await expect(c.getByRole('combobox', { name: w('Where the consent came from') })).toBeVisible();
    const list = c.getByRole('list', { name: w('Links in the CV') });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list.getByRole('listitem').nth(1)).toContainText(
      w('Social networks are never read'),
    );
    // The name is the visible 'Read this page' plus the host (SD-60).
    const reads = c.getByRole('button', { name: new RegExp(w('Read this page')) });
    await expect(reads).toHaveCount(2);
    for (const b of await reads.all()) await expect(b).toBeDisabled();
    // Above the CV and Analysis area.
    const cb = (await c.boundingBox())!;
    const pane = page.getByTestId('cv-pane');
    const tab = page.getByRole('tab', { name: w('CV'), exact: true });
    const below = (await pane.isVisible())
      ? (await pane.boundingBox())!
      : (await tab.boundingBox())!;
    expect(cb.y + cb.height).toBeLessThanOrEqual(below.y + 1);
    await ux.check('links card', [...STD, 'AZ']);
    // Variants: switched off for the CV, no links, feature off: no card.
    for (const o of [
      { state: { enabled: false } },
      { state: { links: [] } },
      { assistant: { ...SENAI_ON, features: { ...SENAI_ON.features, linkReview: false } } },
    ] as LinkOpts[]) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await linksApi(page, { ...o, goto: false });
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Aysel Məmmədova' })).toBeVisible();
      await page.waitForTimeout(500);
      await expect(page.getByRole('heading', { name: w('Links the candidate gave') })).toHaveCount(
        0,
      );
    }
  },
);

// ------------------------------------------------------------------------------------------ LK-02
uat(
  'LK-02',
  "Recording the candidate's consent",
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    ux.allow(/400/);
    let bad = false;
    const seen = await linksApi(page, {
      consent: () =>
        bad ? { status: 400, body: { message: 'The reference is not valid.' } } : undefined,
    });
    const c = card(page, w);
    const src = c.getByRole('combobox', { name: w('Where the consent came from') });
    await expect(src.locator('option')).toHaveText(
      ['Application form', 'HR system', 'E-mail from the candidate', 'Other'].map((x) => w(x)),
    );
    const ref = c.getByRole('textbox', {
      name: w('Reference (form number, date, e-mail subject)'),
    });
    const rec = c.getByRole('button', { name: w('Record the candidate’s consent') });
    await ref.fill('F1');
    await expect(rec).toBeDisabled();
    await ref.fill('x'.repeat(201));
    expect((await ref.inputValue()).length).toBe(200);
    await ref.fill('Form 12, 20 Oct');
    await expect(rec).toBeEnabled();
    await ux.check('form filled', [...STD, 'AZ']);
    // 6) first the 400: an error, and the form stays.
    bad = true;
    await rec.click();
    await expect(c.getByText('The reference is not valid.')).toBeVisible();
    await expect(ref).toHaveValue('Form 12, 20 Oct');
    bad = false;
    await rec.click();
    await expect.poll(() => seen.posts.filter((p) => p.url === `${BASE}/consent`).length).toBe(2);
    expect(seen.posts.filter((p) => p.url === `${BASE}/consent`)[1]!.body).toEqual({
      source: 'application_form',
      evidence: 'Form 12, 20 Oct',
    });
    await expect(c).toContainText(
      w('Consent recorded: {source} ({evidence}) by {name} {when}.', {
        source: w('Application form'),
        evidence: 'Form 12, 20 Oct',
        name: 'Ayla Karimova',
        when: w('just now'),
      }),
    );
    await expect(
      c.getByRole('button', { name: w('Withdraw consent and delete what was read') }),
    ).toBeVisible();
    for (const b of await c.getByRole('list').getByRole('button').all())
      await expect(b).toBeEnabled();
    await ux.check('consent recorded', [...STD, 'AZ']);
  },
);

// ------------------------------------------------------------------------------------------ LK-03
uat(
  'LK-03',
  'Reading a page the candidate gave',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    ux.allow(/502/);
    let bad = false;
    const seen = await linksApi(page, {
      state: { consent: CONSENT },
      read: () =>
        bad
          ? { status: 502, body: { message: 'The page could not be read.' } }
          : { status: 200, body: null, delay: 1200 },
    });
    const c = card(page, w);
    const items = c.getByRole('list', { name: w('Links in the CV') }).getByRole('listitem');
    const gh = items.nth(0).getByRole('button');
    await expect(gh).toContainText(w('Read this page')); // the host follows, so the name is distinct
    const name = await gh.evaluate((e) => e.getAttribute('aria-label') ?? e.textContent);
    await gh.click();
    await expect(gh).toContainText(w('Reading…'));
    await expect(items.nth(2).getByRole('button')).toBeDisabled();
    const busyName = await gh.evaluate((e) => e.getAttribute('aria-label') ?? e.textContent);
    await expect(c.locator('figure')).toHaveCount(1, { timeout: 5000 });
    expect(seen.posts.find((p) => p.url === `${BASE}/review`)!.body).toEqual({
      url: 'https://github.com/aysel',
    });
    await expect(c.locator('figcaption').first()).toHaveText(
      w('Candidate-provided link · {host} · read {when} · not assessed', {
        host: 'github.com',
        when: w('just now'),
      }),
    );
    const box = c.locator('blockquote').first();
    await expect(box).toContainText('[phone removed]');
    expect(await box.evaluate((e) => getComputedStyle(e).overflowY)).toBe('auto');
    await items.nth(2).getByRole('button').click();
    await expect(c.locator('figure')).toHaveCount(2, { timeout: 5000 });
    await expect(c.locator('figure').nth(1)).toContainText(
      w('This page contains instructions aimed at an AI. They were ignored.'),
    );
    await ux.check('two pages read', [...STD, 'AZ']);
    bad = true;
    await gh.click();
    await expect(c.getByText('The page could not be read.')).toBeVisible();
    // Bug SD-60 (CandidateLinks.tsx:148): aria-label 'Read {host}' replaces the visible text, so the
    // name lacks 'Read this page' (WCAG 2.5.3) and 'Reading…' is never announced.
    expect
      .soft(name, 'the accessible name contains the visible text and the host')
      .toContain(w('Read this page'));
    expect.soft(name).toContain('github.com');
    expect
      .soft(busyName, "'Reading…' is in the accessible name while reading")
      .toContain(w('Reading…'));
  },
);

// ------------------------------------------------------------------------------------------ LK-04
uat(
  'LK-04',
  'Withdrawing consent asks first',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const w = words(meta);
    const seen = await linksApi(page, {
      state: {
        consent: CONSENT,
        reviews: [review('github.com', 'https://github.com/aysel', false)],
      },
    });
    const c = card(page, w);
    await expect(c.locator('figure')).toHaveCount(1);
    const dels = () => seen.requests.filter((r) => r.method === 'DELETE').length;
    let dialogs = 0;
    page.once('dialog', async (d) => {
      dialogs++;
      await d.dismiss();
    });
    await c.getByRole('button', { name: w('Withdraw consent and delete what was read') }).click();
    await page.waitForTimeout(500);
    // Bug SD-14 (CandidateLinks.tsx:96-105): the withdraw runs at once, with no confirmation.
    const confirm = page.getByRole('button', { name: w('Cancel') });
    const asked = dialogs > 0 || (await confirm.isVisible());
    expect.soft(asked, 'a confirmation with Cancel appears first').toBe(true);
    expect.soft(dels(), 'nothing is sent before the person confirms').toBe(0);
    if (asked) {
      if (await confirm.isVisible()) await confirm.click();
      expect(dels()).toBe(0);
      await expect(c.locator('figure')).toHaveCount(1);
      page.once('dialog', (d) => d.accept());
      await c.getByRole('button', { name: w('Withdraw consent and delete what was read') }).click();
      const ok = page.getByRole('alertdialog').getByRole('button').first();
      if (await ok.isVisible().catch(() => false)) await ok.click();
    }
    await expect.poll(dels).toBe(1);
    expect(seen.requests.find((r) => r.method === 'DELETE')!.url).toBe(`${BASE}/consent`);
    await expect(c.locator('figure')).toHaveCount(0);
    await expect(
      c.getByRole('button', { name: w('Record the candidate’s consent') }),
    ).toBeVisible();
    for (const b of await c.getByRole('list').getByRole('button').all())
      await expect(b).toBeDisabled();
    await ux.check('withdrawn', [...STD, 'AZ']);
  },
);
