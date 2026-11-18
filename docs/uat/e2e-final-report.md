# UAT final report: parallax by Azerconnect Group (stage2)

Written 2026-11-18 by Claude for Kamran Karimli (AG HR). Plan: docs/uat/e2e-test-plan.md v1.1 (398 cases). Case list with status per case: docs/uat/e2e-test-cases.csv. Totals and lists: docs/uat/e2e-results-summary.md. Fix log: e2e/test-results/uat/STATUS.md (not tracked by git; the same text is in the Project doc `claude/stage2-build-status.md`).

## Verdict

Every case that can be run without your provider key has been built, run and passes. Of 398 cases, **390 pass, 0 fail, 0 not run and 8 are blocked**: the eight real-AI cases (RA-01 to RA-08) need your own provider key, which I will not type. Two kinds of coverage are still missing and are named below: Edge and Safari/iPhone (the browsers are not installed in the sandbox), and a speed check on a normal laptop with a GPU. Anything else open is a product decision for you, not a defect.

|         | Cases                                                        |
| ------- | ------------------------------------------------------------ |
| Pass    | 390 of 398 (279 screen tests L1, 111 full-app journeys L2)   |
| Fail    | 0                                                            |
| Not run | 0                                                            |
| Blocked | 8 (real-AI cases RA-01 to RA-08, L3: need your provider key) |

By priority: P1 164 pass, 5 blocked. P2 190 pass, 3 blocked. P3 36 pass.

Test and fix ran together. Since the report of 17 Nov the plan grew from 392 to 398 cases, the 45 cases that were never built were written and run, and the tests found more product defects, all fixed and re-tested (list below). Together with the roughly 85 fixed in the earlier passes, no known functional defect is open.

## What was run (latest result of every case on every device)

1,368 case-and-device results: 1,357 pass the first time, 11 pass on the automatic retry, 0 fail. None of the retry cases failed twice; each is a timing-sensitive test on a 2-CPU machine (A11-05, AC-02, CP-08, CV-19, HM-01, PF-03, RN-02, RS-14, SA-30, SC-12). The CSV notes the retry per case.

| Level                                                                                                                   | What                                                                                                                                                                                                  | Result of the last run                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| L1 (mocked API, Chromium) desktop D 1440, English and Azerbaijani                                                       | all cases written for D                                                                                                                                                                               | green; 664 case-and-device results (D also carries the L2 and isolated cases)                                 |
| L1 phone A (Pixel 7), tablet T 820 and TL 1180 (touch), DS 1280, DW 1920                                                | full runs, then targeted re-runs of every case fixed                                                                                                                                                  | A 369, T 176, TL 78, DS 46, DW 35 results, all green                                                          |
| L2 (real API, Postgres, fake AI) desktop D, English and Azerbaijani, fresh database, one worker                         | 169 tests                                                                                                                                                                                             | 167 pass, 2 pass on retry (RS-14 az, RN-02 az), 0 fail                                                        |
| L2 isolated stack (cases that change the whole stack: AD-12, AD-19, AD-21, AD-22, SEC-06, SEC-14, I18-05, LK-05, SX-12) | own database and port                                                                                                                                                                                 | all pass; SX-12 on all four device groups on a fresh database                                                 |
| Speed cases PF-03, PF-05, PF-06 on the final build                                                                      | measured in the sandbox                                                                                                                                                                               | pass (PF-03 desktop failed its first attempt at 1,529 ms against the 1,500 ms limit, then passed; see "Open") |
| L3 (real AI)                                                                                                            | 8 cases                                                                                                                                                                                               | not run: needs your key                                                                                       |
| Edge (E) and iPhone/Safari (I)                                                                                          |                                                                                                                                                                                                       | not run: those browsers are not installed in the sandbox                                                      |
| Unit and static                                                                                                         | web 443 tests, API 546 (57 suites), shared 24; lint 0 errors (15 warnings, all in e2e files); prettier, typecheck, build, guard:bundle (no provider key in the bundle), guard:residency, db:roundtrip | all pass                                                                                                      |

An earlier two-worker L2 run showed three failures (PF-04, SP-08, SX-03). They came from two workers sharing one fake-AI setting and one database (one test makes the fake provider answer 500 while another is reading CVs), and all three passed in the one-worker run. One of them also exposed a weak spot in the test harness (cloned CV rows with no score needed an explicit empty score); that is fixed.

## New in this pass

Home is a menu of functions; the waiting screen is a coffee-break scene (rewritten to cost little main-thread time, PF-06); CVs can be added in bulk and as a ZIP (pdf, Word, md) with a list of what was skipped and why. All have cases (HM, BP, UP, PF) that pass.

## Defects found by the tests and fixed in this pass

1. **Language and appearance changes could arrive out of order (AC-04).** Two quick changes were sent together; the older one could win on the server and the page would show a setting that was not saved. Changes are now sent one after another (`savePreference` in Appearance.tsx), with a unit test.
2. **Azerbaijani was not one voice (I18-08, I18-09, I18-10).** Mixed 'sən' and 'siz', two terms for Shortlist, different names for the same place, English server messages and English quoted button names. Now one register ('siz'), one term ("qısa siyahı"), one name per place (Administration, Fairness monitoring, Shared with me, Change password, SenAI tab and panels), server messages translated in the person's language (`az.server.ts`, also for files and the failed or needs-a-look notices on the review screen), quoted labels follow the page.
3. **Screen readers (A11-08).** Stop and Copy are announced. The Candidates page counted the CVs again on every refresh; the "As of" time now sits outside the live region, so only a change in counts is announced.
4. **Phone (A, 360 px).** Bottom-bar items fit in two lines, the vacancy tabs keep their width and the pool scope chip wraps instead of being cut off.
5. **Archived vacancy (SD-27), "Reload their version" (SD-54), "Read requirements" (SD-28), SenAI candidates from other vacancies (SA-22), skip link, tab titles, forced-colours focus ring, touch targets, tablet rail and CV toolbar, Baku time in the conflict message, upload card, 320 px pool filter, reduced-motion evidence map:** fixed in the pass of 14 to 17 Nov and re-verified in this run.

## Test-side changes (the app was right)

Many specs pinned old wording and were updated for the renames, the Azerbaijani register and the Home landing page (e.g. shell, roles, admin, results, review, pool, vacancy-list, fullscreen, batch, sprint, auth, role-card). Others: the SA-30 probe skips controls cut off by a scrolling ancestor; HM-02 clears the saved panel state; SP-08 waits for the analysis pane before each key; SX-12 needs a database where nobody has asked or changed anything, so it must run first after a reset of the isolated stack and once per device group (`iso-up.sh reset`, then SX-12 alone); the PF-05 probe reads a 96 x 128 thumbnail instead of the whole 1920 px page, because reading every pixel slowed the draw it was timing (limits unchanged).

## Open

| ID                  | What                                                                                                          | Why it is open                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RA-01 to RA-08      | Real-AI smoke cases                                                                                           | Need your own provider key (CLAUDE.md: never typed by Claude). Blocked, not failed.                                                                                                              |
| Edge, Safari/iPhone | Devices E and I                                                                                               | The browsers are not installed in the sandbox. The Chromium phone and tablet projects were run.                                                                                                  |
| PF-03, PF-05, PF-06 | Speed on a weak machine                                                                                       | They pass here, but PF-03 sits on its limit (1,529 ms then pass on retry, limit 1,500 ms) and all three were measured on a 2-CPU sandbox without a GPU. One run on a normal laptop settles them. |
| SD-33               | One marking rule for Results, pool, preview and review                                                        | A product decision: the tests pass against the current behaviour.                                                                                                                                |
| I18-06              | The slogan keeps the approved line when the assistant is called SenAI; it follows the name for any other name | A product decision between the plan text and the approved line.                                                                                                                                  |
| Azerbaijani review  | New strings of this pass                                                                                      | A native speaker should read them.                                                                                                                                                               |

## Repository hygiene (not part of the tests)

The repository tracks files of your agent tools: `.agentic-qe/` and `.claude-flow/` (71 files). Their logs and databases change on every run, which is what caused the merge conflicts you saw. `.agentic-qe/witness-keys/d937c24e71b2a071.key.pem` is a **private key** committed to the repository. I did not change or remove any of it. Suggested: untrack both folders, add them to `.gitignore`, and rotate that key if it is used for anything that matters. I can prepare that commit if you want it.

## Before this goes to users

1. You merge and push the sync branch and deploy to Render (I cannot push or deploy). Never to `main` until you decide.
2. Run the 8 real-AI cases (RA) with your own key.
3. Run PF-01 to PF-08 once on a normal laptop with a GPU.
4. Decide SD-33 and I18-06; have the new Azerbaijani strings read by a native speaker.
5. Remove the private key from the repository (see above).
6. The shared database of the L2 harness grows with every run. Reset it with `UAT_RESET=1 node e2e/fullstack/server.mjs` before a full L2 run, restart the L2 server after every web rebuild, and run the L2 suite with one worker (two workers share one fake-AI setting).
