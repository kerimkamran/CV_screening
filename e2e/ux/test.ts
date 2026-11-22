import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import {
  axe,
  az,
  occ,
  ovf,
  ovl,
  rm,
  settled,
  tgt,
  watchErrors,
  type Code,
  type Finding,
} from './checks';

/**
 * The UAT test fixture (plan section 3). Every UAT test is written with `uat(id, title, opts, fn)`:
 * - it runs only on the devices and languages the plan lists for it (others are skipped, with the
 *   reason, so the report can tell "not on this device" from "not run");
 * - `ux.check(step)` runs the automatic checks after a step and saves a screenshot;
 * - errors (page errors, console errors, CSP violations, failed requests) are watched all along;
 * - S1 and S2 findings fail the test; S3 and S4 findings are recorded for the bug log.
 */
export type Dev = 'D' | 'DW' | 'DS' | 'E' | 'T' | 'TL' | 'A' | 'I';
export type Lang = 'en' | 'az';
export interface Meta {
  dev: Dev;
  lang: Lang;
  touch: boolean;
  layer: 'L1' | 'L2';
}
export const ALL: Dev[] = ['D', 'E', 'T', 'TL', 'A', 'I'];
/** "Std" in the plan: OCC, OVL, OVF, TGT, AXE, ERR (always on) and SHOT. */
export const STD: Code[] = ['OCC', 'OVL', 'OVF', 'TGT', 'AXE'];

export const RUN_DATE = process.env.UAT_RUN_DATE ?? new Date().toISOString().slice(0, 10);
export const EVIDENCE = join(
  new URL('..', import.meta.url).pathname,
  'test-results',
  'uat',
  RUN_DATE,
);

export class Ux {
  readonly findings: Finding[] = [];
  private readonly errors: Finding[];
  private readonly ignore: RegExp[] = [];
  private shots = 0;
  constructor(
    readonly page: Page,
    readonly meta: Meta,
    private readonly info: TestInfo,
    readonly id: string,
  ) {
    this.errors = watchErrors(page, this.ignore);
  }

  /** Errors the test causes on purpose (an aborted request, a 500 it asked for). */
  allow(...re: RegExp[]) {
    this.ignore.push(...re);
  }

  /** Watch another page (a second tab) for errors too. */
  watch(page: Page) {
    const more = watchErrors(page, this.ignore);
    return () => this.errors.push(...more);
  }

  /**
   * Run the automatic checks after a step, record the findings and save a screenshot.
   * `codes` defaults to the plan's Std set; add 'RM' or 'AZ' where the plan lists them. AZ runs
   * only in Azerbaijani projects.
   */
  async check(
    step: string,
    codes: Code[] = STD,
    opts: { overlay?: string; axeExclude?: string[] } = {},
  ) {
    const p = this.page;
    const out: Finding[] = [];
    // A screen change in progress (View Transition) puts its own layer over the whole page, so hit
    // tests would land on <html>; an entrance still moving gives the same false 'covered': wait until
    // every animation that ends has ended. Not before RM, which must see what is still moving.
    if (codes.includes('RM'))
      await p
        .waitForFunction(
          () =>
            !document
              .getAnimations()
              .some((a) =>
                ((a.effect as KeyframeEffect | null)?.pseudoElement ?? '').startsWith(
                  '::view-transition',
                ),
              ),
          null,
          { timeout: 3000 },
        )
        .catch(() => undefined);
    else await settled(p, 4000);
    try {
      if (codes.includes('OCC')) out.push(...(await occ(p, { overlay: opts.overlay })));
      if (codes.includes('OVL')) out.push(...(await ovl(p)));
      if (codes.includes('OVF')) out.push(...(await ovf(p)));
      if (codes.includes('TGT')) out.push(...(await tgt(p, this.meta.touch)));
      if (codes.includes('AXE'))
        out.push(...(await axe(p, { exclude: opts.axeExclude, settle: !codes.includes('RM') })));
      if (codes.includes('RM')) out.push(...(await rm(p)));
      if (codes.includes('AZ') && this.meta.lang === 'az') out.push(...(await az(p)));
    } catch (e) {
      out.push({
        code: 'ERR',
        level: 'S4',
        what: `check could not run: ${String(e).slice(0, 120)}`,
      });
    }
    for (const f of out) this.findings.push({ ...f, step });
    await this.shot(step);
    return out;
  }

  /** A full-page screenshot for the visual review (SHOT). */
  async shot(step: string) {
    const dir = join(EVIDENCE, 'shots', this.id);
    mkdirSync(dir, { recursive: true });
    const n = String(++this.shots).padStart(2, '0');
    const file = join(
      dir,
      `${this.meta.dev}-${this.meta.lang}-${n}-${step.replace(/[^\w-]+/g, '_').slice(0, 40)}.png`,
    );
    try {
      // On touch devices a full-page screenshot resizes Chromium's device metrics and drops the touch
      // emulation (pointer: coarse turns fine) for the rest of the test, so those get the viewport.
      await this.page.screenshot({ path: file, fullPage: !this.meta.touch, timeout: 10_000 });
      await this.info.attach(`${n} ${step}`, { path: file, contentType: 'image/png' });
    } catch {
      /* a closed page has no screenshot */
    }
    return file;
  }

  /** Called when the test ends: records every finding and fails on S1/S2. */
  finish() {
    const all = [...this.findings, ...this.errors.map((e) => ({ ...e, step: e.step ?? 'any' }))];
    // One finding per distinct sentence, so a repeated check does not flood the log.
    const seen = new Set<string>();
    const uniq = all.filter((f) => {
      const k = `${f.code}|${f.what}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (const f of uniq)
      this.info.annotations.push({
        type: `ux:${f.level}:${f.code}`,
        description: `${f.step}: ${f.what}`,
      });
    const blocking = uniq.filter((f) => f.level === 'S1' || f.level === 'S2');
    if (blocking.length && this.info.status === 'passed')
      throw new Error(
        `UX checks found ${blocking.length} S1/S2 problem(s):\n${blocking
          .map((f) => `  [${f.level} ${f.code}] ${f.step}: ${f.what}`)
          .join('\n')}`,
      );
  }
}

interface Fixtures {
  meta: Meta;
  /** Set the interface language before the page loads (off for tests that switch it themselves). */
  presetLang: boolean;
  ux: Ux;
}

export const test = base.extend<Fixtures>({
  meta: async ({}, use, info) => {
    await use(info.project.metadata as Meta);
  },
  presetLang: [true, { option: true }],
  page: async ({ page, meta, presetLang }, use) => {
    if (presetLang)
      await page.addInitScript((lang) => {
        try {
          if (!sessionStorage.getItem('uat-lang-set')) {
            localStorage.setItem('cv-lang', lang);
            sessionStorage.setItem('uat-lang-set', '1');
          }
        } catch {
          /* storage blocked */
        }
      }, meta.lang);
    await use(page);
  },
  ux: async ({ page, meta }, use, info) => {
    const id = /^([A-Z0-9]+-\d+)/.exec(info.title)?.[1] ?? 'X';
    const ux = new Ux(page, meta, info, id);
    await use(ux);
    ux.finish();
  },
});
export { expect };

export interface UatArgs {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  ux: Ux;
  meta: Meta;
  info: TestInfo;
  /** Pick the text for the language of this run. */
  tx: (en: string, azText: string) => string;
}

/**
 * Declare one UAT case. `on` is the plan's device list; `langs` 'EN' runs in English only.
 * The test title starts with the ID, which the report uses to match the CSV row.
 */
export function uat(
  id: string,
  title: string,
  opts: { on: Dev[] | 'All'; langs?: 'EN' | 'EN+AZ'; timeout?: number },
  fn: (a: UatArgs) => Promise<void>,
) {
  test(`${id} ${title}`, async ({ page, context, browser, ux, meta }, info) => {
    const on = opts.on === 'All' ? ALL : opts.on;
    test.skip(!on.includes(meta.dev), `not listed for ${meta.dev}`);
    test.skip((opts.langs ?? 'EN+AZ') === 'EN' && meta.lang === 'az', 'English only');
    if (opts.timeout) test.setTimeout(opts.timeout);
    const tx = (en: string, azText: string) => (meta.lang === 'az' ? azText : en);
    await fn({ page, context, browser, ux, meta, info, tx });
  });
}

/** A step: names the action in the report and runs the checks after it. */
export async function step(ux: Ux, name: string, fn: () => Promise<void>, codes?: Code[]) {
  await test.step(name, fn);
  await ux.check(name, codes);
}
