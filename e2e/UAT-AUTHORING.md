# Writing the UAT tests (for the people and agents building them)

The plan is `docs/uat/e2e-test-plan.md` (v1.1); the same 392 cases, one per row, are in
`docs/uat/e2e-test-cases.csv` (columns ID, Area, Title, Layer, Priority, Devices, Languages,
Account, Data / preconditions, Steps, Expected, Auto checks, Spec file, Linked SD, Source in code).
The row's **Expected** is the specification. Read the suspected-defect rows (plan section 6) for
the SDs a case links to.

## The build under test

- App code: `apps/web` (React, hash routes) and `apps/api` (NestJS). **Never change anything under
  `apps/`, `packages/`, `db/` or `scripts/`.** The UAT finds bugs; it does not fix them.
- No git commands (no commit, no checkout, no stash).
- The web app is already built (`apps/web/dist`); do not rebuild it.

## Running alongside others

Several packages run at the same time, and the main session fixes app bugs and rebuilds the app
while you test. So:
- Always run with your package tag: `UAT_TAG=pkg-x` (your letter). Your results then go to
  `test-results/uat/results-l1-pkg-x.json` / `results-l2-pkg-x.json` and nobody overwrites them.
- A test that fails once with a connection error or a blank page may have hit a rebuild: run it
  again before you call it a bug.
- Report bugs exactly (file:line); the main session fixes them. Do not wait for fixes.

## Notes learned during the run (read these)

- The main session rebuilds the web app and restarts the L2 server while you test (the L2 server
  caches index.html, so a rebuild without a restart breaks its styles). A blank or unstyled page,
  a connection error or a sudden 'Failed to fetch' once: wait 30 s and run the test again.
- Use the JSON reporter so results land in your file: the CLI `--reporter` replaces the config's
  reporters, so run with `--reporter=line` only when you also set nothing else, or better
  `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/uat/<pkg>-<name>.json ... --reporter=json`.
- Touch devices (T, TL, A) take viewport screenshots (a full-page screenshot drops Chromium's touch
  emulation); `pointer: coarse` stays on for the whole test.
- On touch screens every button, link block, select, summary and text field is at least 44 px tall
  (global CSS); a TGT check that still finds small targets there is a real finding.
- The CV pane is now a `<dialog>` element (role region with the name 'CV' in the page; in full
  screen it is opened with showModal(): role dialog, aria-modal, top layer). Toolbar: 'Zoom out',
  a '%' value, 'Zoom in', 'Fit', 'Open in new tab', 'Download', 'Full screen'/'Close full screen'.
- Sign-in rate limit on L2 is 600 a minute (AUTH_IP_LIMIT_PER_MIN), so parallel tests no longer
  trip it.
- Another package may be running at the same time on the same 2 CPUs: use `--workers=1`, run only
  the projects you need while writing (D en, then D az and A where the row lists them), and keep
  whole-matrix runs for the end of your work.

## Two layers

| Layer | Folder | Server (already running, never stop it) | Run |
| --- | --- | --- | --- |
| L1 screens, mocked API | `e2e/specs/<area>.spec.ts` | `e2e/serve.mjs`, port 4310 | `cd e2e && UAT_TAG=pkg-x UAT_DEVICES=D UAT_LANGS=en npx playwright test -c playwright.config.ts specs/<file>` |
| L2 full app, fake AI | `e2e/fullstack/<area>.spec.ts` | `e2e/fullstack/server.mjs`, port 4320 (+4321 control) | `cd e2e && UAT_TAG=pkg-x UAT_DEVICES=D UAT_LANGS=en npx playwright test -c playwright.full.config.ts fullstack/<file>` |

If a server is not answering (`curl -s http://127.0.0.1:4310/healthz`, `curl -s http://127.0.0.1:4320/readyz`),
start it in the background from `e2e/`: `nohup node serve.mjs >/tmp/l1.log 2>&1 &` or
`nohup node fullstack/server.mjs >/tmp/l2.log 2>&1 &`. Never kill a server another run may be using.
The machine has 2 CPUs: run with `--workers=1` while developing, and only the projects you need
(`UAT_DEVICES=D,A UAT_LANGS=en,az`). Projects are named `<device>-<lang>`: D, DW, DS, T, TL, A
(E = Edge and I = iPhone are not installed here; never try to install browsers).

## How a case is written

```ts
import { mockApi, openReview, SENAI_ON, ME, DID } from '../fixtures/api';
import { expect, uat, step } from '../ux/test';

uat('SH-01', 'Recruiter frame on desktop and tablet: brand, rail, footer',
  { on: ['D', 'DW', 'DS', 'E', 'T', 'TL'] /* or 'All' */, langs: 'EN+AZ' /* or 'EN' */ },
  async ({ page, ux, meta, tx, context, browser }) => {
    await mockApi(page);
    await page.goto('/#/vacancies');
    await expect(page.getByRole('navigation', { name: tx('Main', 'Əsas') })).toBeVisible();
    await ux.check('frame', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']); // after a step
  });
```

- **One `uat()` per CSV row**, title = the CSV Title, ID first. `on` = the row's Devices
  (`All` = D, E, T, TL, A, I), `langs` = the row's Languages. The fixture skips other projects.
- `tx(en, az)` picks the text for the run's language. Azerbaijani wording is in
  `apps/web/src/i18n/az*.ts` (English key → Azerbaijani); use those exact strings.
- The language is preset before load (localStorage `cv-lang`). A test that switches the language
  itself (I18 cases) sets `test.use({ presetLang: false })` in its own `describe`.
- `meta.dev`, `meta.lang`, `meta.touch` tell the device and language.
- **Checks:** call `await ux.check(stepName, codes)` after the steps where the row's "Auto checks"
  apply. `Std` = `['OCC','OVL','OVF','TGT','AXE']` (ERR is always on). Add `'RM'` or `'AZ'` where
  listed (AZ only acts in Azerbaijani projects). KEY is written as explicit assertions in the test.
  `ux.check(..., { overlay: 'css selector' })` checks a specific overlay. Every check also saves a
  screenshot (SHOT). S1/S2 findings fail the test; S3/S4 are recorded for the bug log.
- Errors the test causes on purpose (an aborted request, a 500 it asked for): `ux.allow(/pattern/)`.
- For reduced motion: `await page.emulateMedia({ reducedMotion: 'reduce' })` before `goto`.
- A second tab: `const p2 = await context.newPage(); const flush = ux.watch(p2); …; flush();`.

### L1 fixtures (`e2e/fixtures/api.ts`)

`mockApi(page, { signedIn, me, assistant, vacancies, total, extra })` signs in (or not) and answers
the API; `extra(route, url)` answers anything else first (return `true` when handled). `seen.requests`
lists every API call (method, url, body, headers). Exports: `ME`, `SENAI_ON`, `VID`, `DID`, `DID2`,
`DID3`, `MID`, `MID2`, `DOCS`, `ROWS`, `row()`, `analysis()`, `vacancy`, `decision`, `TEXT`, `PDF`,
`openReview(page, id)` (stores a 2-CV review list `e2e-list` and opens `#/cv/<id>?l=e2e-list`),
`showAnalysis(page)` (the Analysis tab on narrow screens), `watchProblems(page)`.
Generated data: `e2e/fixtures/files.ts` (`FILES.docx()`, `densePdf()`, `protectedPdf()`,
`brokenPdf()`, `notPdf()`, `zip()`, `oversizeZip()`, `tooManyZip()`, `batch(n)`, `pool(n)`,
`ulidOf()`, `cvText()`).
Put mocks that only your area needs in **your own** file `e2e/fixtures/<area>.ts`. Do not edit
`fixtures/api.ts`, `fixtures/files.ts`, `ux/*`, `fullstack/stack.ts`, `fullstack/seed.ts` or the
configs; if one of them is wrong, say so in your report.

### L2 helpers (`e2e/fullstack/stack.ts`)

Seeded accounts (`accounts()`): admin, adminTa, recruiter ("Aysel Mammadova"), recruiter2, lead,
governance, viewer (no role), mustChange (temporary password). `login(acc)` → token; `openAs(page,
acc, '#/route')` opens the app signed in; `signInUi(page, acc)` uses the real form; `api(token)`
(`get/post/put/patch/del/upload`); `adminApi()`; `freshAccount(role, {keepTemp})` makes a
throwaway account — **use it whenever a test changes an account** (disable, reset, two-step,
roles, password) so the shared accounts stay usable; `screenedVacancy(token, { title, jd, files })`
makes a started vacancy and analyzes the files with the fake AI; `resumeFiles()` the 10 invented
CVs in `docs/uat/resumes`; `JD_EN()`, `JD_AZ()`; `uniq(prefix)` for unique titles (the database is
shared by every test, so always make your own vacancies); `db(sql, params)` reads the database as
its owner (audit checks); `outbox()`, `tempPasswordFor(email)`; `modelCalls()`/`clearModelCalls()`
(what the fake AI was sent); `setAi('fail'|'slow'|'scripted')` (put it back to `'scripted'` in a
`finally`); `drain()` waits for the screening queue.
The fake AI (`fullstack/fake-ai.mjs`) reads requirements from the job text's "Required:" and "Nice
to have:" lines, marks a requirement met when a CV line contains its longest word, answers the
SenAI candidate panel from the evidence package, and answers nothing else (so SenAI's pool panel
falls back to its rules).

## Deciding pass or fail

- Implement the row's Steps and assert its Expected as written. Do not weaken an assertion to make
  it pass. When the app does something else, find out why in the code:
  - the app is wrong (the Expected is reasonable and the code does not do it): keep the failing
    assertion; that is a bug. Note file:line and a severity (S1-S4, plan section 1).
  - the plan's Expected is wrong (a wording or detail the plan got wrong, while the behaviour is
    fine): adjust the assertion to the real, reasonable behaviour, add a comment
    `// PLAN: <what the plan said> — <why the real behaviour is right>`, and list it in your report.
  - something cannot be tested here (needs Edge, WebKit, a real phone, the real AI): use
    `test.skip(true, 'Blocked: <reason>')` for that part.
- Your own selector or timing mistakes are not bugs: fix them. Prefer roles and labels
  (`getByRole`, `getByLabel`) over CSS.
- Every test must finish in under 45 s (L1) or 120 s (L2).

## Your report

Write `e2e/test-results/uat/triage-<package>.md` with one line per case:
`| ID | Result (Pass / Fail / Blocked / Not built) | devices/langs run | what failed (one sentence) | file:line in app | severity | SD confirmed or cleared |`
then a list of PLAN corrections, then problems with the shared infrastructure.
