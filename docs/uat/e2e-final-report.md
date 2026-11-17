# UAT final report: parallax by Azerconnect Group (stage2)

Written 2026-11-17 by Claude for Kamran Karimli (AG HR). Plan: docs/uat/e2e-test-plan.md v1.1 (392 cases). Case list with status per case: docs/uat/e2e-test-cases.csv. Totals and lists: docs/uat/e2e-results-summary.md. Fix log: e2e/test-results/uat/STATUS.md (not tracked by git; the same text is in the Project doc `claude/stage2-build-status.md`).

## Verdict

The tool is **not fully tested**, and I will not call it that. It is well tested where tests exist, and the gaps are listed below.

|         | Cases                                                                       |
| ------- | --------------------------------------------------------------------------- |
| Pass    | 336 of 392                                                                  |
| Fail    | 3 (PF-03, PF-05, PF-06: speed limits, see "Open")                           |
| Not run | 45 (never built, list below; 13 of them are P1)                             |
| Blocked | 8 (the real-AI cases RA/L3 need your own provider key; I will not type one) |

By priority: P1 149 pass, 1 fail, 13 not run, 5 blocked. P2 158 pass, 2 fail, 26 not run, 3 blocked. P3 29 pass, 6 not run.

Test and fix ran together. In this pass the tests found 14 more product defects, all fixed and re-tested (list below). Together with the roughly 70 fixed in the earlier pass, no known functional defect is open in the cases that have tests. What is open is speed on a weak machine, two product decisions for you, and the cases nobody wrote.

## What was run

| Level                                                                               | What                                                                                                                                                                                                  | Result of the last run                                                                                               |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| L1 (mocked API, Chromium) desktop D 1440, English and Azerbaijani                   | all cases written for D, 423 tests                                                                                                                                                                    | 420 pass, 2 pass on retry, 1 fail (BP-13 az); BP-13 passes when run alone (it only fails when the machine is loaded) |
| L1 phone A (Pixel 7)                                                                | full run, then the cases that failed plus the vacancy, pool, results, criteria and report slice again                                                                                                 | full run 308 pass, 15 fail; all 15 fixed and re-verified; last slice (A and T together) 136 of 136 pass              |
| L1 tablet T 820 and TL 1180 (touch)                                                 | full run                                                                                                                                                                                              | 256 pass, 3 pass on retry, 0 fail                                                                                    |
| L1 DW 1920 and DS 1280                                                              | full run                                                                                                                                                                                              | DW 42 tests and DS 52 tests, all pass except PF-05 on DW (see Open)                                                  |
| L2 (real API, Postgres, fake AI) desktop D, English and Azerbaijani, fresh database | 128 tests                                                                                                                                                                                             | 126 pass, 1 pass on retry, 1 fail (SX-04 az); passes when run alone (two workers share one SenAI setting)            |
| L3 (real AI)                                                                        | 8 cases                                                                                                                                                                                               | not run: needs your key                                                                                              |
| Edge (E) and iPhone/Safari (I)                                                      |                                                                                                                                                                                                       | not run: those browsers are not installed in the sandbox                                                             |
| Unit and static                                                                     | web 364 tests, API 545 (57 suites), shared 24; lint 0 errors (16 warnings, all in e2e files); prettier, typecheck, build, guard:bundle (no provider key in the bundle), guard:residency, db:roundtrip | all pass                                                                                                             |

Where "pass on retry" appears, the report notes it per case in the CSV (Notes column). The retry cases are timing-sensitive tests that share one machine and one database; none of them failed twice.

## Defects found by the tests and fixed in this pass

Serious (S2) first. Each one has a test that fails without the fix.

1. **Archived vacancy could still be changed (SD-27, VP-06).** Only the page header was read-only. The Criteria tab, Results (Stop, Continue, the Requirements drawer, marks) and the API accepted changes. The API now answers 409 "This vacancy is archived. Restore it to change it." for criteria edit, new version, extract and freeze, adjustments, stop/continue/re-scan and decisions; the page disables the fields and hides the buttons. API integration test added.
2. **"Reload their version" kept the stale form (SD-54, VN-14).** A later Save could write the old value back over a colleague's edit. It now shows the newer version, keeps what you typed as "Restore them", and restoring takes only the fields you changed. New module `draft.ts` with unit tests.
3. **"Read requirements" on a new vacancy (SD-28, VN-06, VN-01).** The page jumped to the saved vacancy before the AI finished, so "Reading…" disappeared and the skills showed only after a reload. Also, Save cleared the "Reading…" state on an existing vacancy. Fixed; if reading fails, the new vacancy is opened so a retry cannot create a second one.
4. **SenAI "candidates from other vacancies" took about a minute on 8,600 CVs (SA-22).** It read every CV once per skill. It now reads each CV once for all skills. On the test database the case went from a 20 s timeout to a pass.
5. **No skip link, one title for every page, no focus ring in Windows high contrast, unnamed regions (A11-01, A11-02, A11-03, A11-10, BP-13, SD-120, SD-123).** Skip link on every page; the tab title follows the page heading; forced-colours focus outline; `role=img` on the brand mark; the CV scroll region is reachable by keyboard and named; every page has an h1; both SenAI panels use the configured name.

Smaller (S3/S4):

6. Touch targets (A11-09, AU-01, TL): row select checkbox, labels around checkboxes and radios, stand-alone links, the Show/Hide password toggle (it stuck out of the field on touch).
7. Left rail pushed under the header on tablet widths (VL-02).
8. CV toolbar scrolled under the sticky bars on a touch tablet in landscape because the CV body was too tall for that layout (EM-06, TL): the body is shorter there.
9. The conflict message "Changed by X at HH:MM" used server time and English in the Azerbaijani page (SD-78, SD-43): Baku time, translated.
10. Upload card said "waiting for CV slots" for CVs that were done once the intake limit cleared (SD-57, UP-07).
11. 320 px: the pool filter pushed the page sideways (A11-11).
12. Reduced motion: the evidence-map box still slid (CV-22).
13. Azerbaijani dates, duplicate-vacancy names, star-map label overlaps, the SenAI slogan for another assistant name (I18-06).
14. Heavy pages are loaded on demand (main chunk about 416 kB, 128 kB gzip) to help first load.

Governance now sees a read-only SenAI admin page (SX-08, was open in the last report).

## Test-side changes (the app was right)

The test expected something the product does not do or the harness was racing. I changed the test, not the product, for: AZ date helper, AD-05 (confirm in the page's own dialog), VL-07 (the 10 s Undo toast outlasts the layout checks, so only the first toast's timer is stretched; the real 10 s is still timed), VN-06/VN-08/VN-01 (Azerbaijani wording as the app shows it; the fake reader finds 4 skills in the Azerbaijani role text), VP-06 (fieldset-disabled radios), CV-07 on TL (at 1180 px the app shows the two panes, not tabs: the test now checks that), EM-06 (judge the settled layout; scroll to the top first on TL), PF-02/08 clock, CV-02, EM-07, A11-02, A11-09, SA-20/21, RP-05, and legacy English-only specs skip the Azerbaijani projects.

## Open

| ID     | What                                                                                                          | Why it is open                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| PF-03  | First CV page drawn 1.87 s after navigation, limit 1.5 s                                                      | Measured on a 2-CPU sandbox without a GPU. Needs a run on a normal laptop.                         |
| PF-05  | First CV page on a 1920 px full screen 1.02 to 1.16 s, limit 1.0 s                                            | Same reason; the margin is small.                                                                  |
| PF-06  | Coffeebay scene keeps the main thread busy 2.2 % (limit 1 %); script, layout and style are each under 0.4 %   | The remainder is painting the animation, which a software renderer pays for. Needs a real GPU run. |
| SD-33  | One marking rule for Results, pool, preview and review                                                        | A product decision: the tests pass against the current behaviour.                                  |
| I18-06 | The slogan keeps the approved line when the assistant is called SenAI; it follows the name for any other name | A product decision between the plan text and the approved line.                                    |

## Not tested (45 cases never built, plus devices)

The 13 P1 cases first: AD-12 (AI models for real), AD-19 (retention for real), BP-09 (retry failed), BP-10 (reload during a batch), BP-12 (session expiry while sending), RS-14 (stop and continue agree with Report and Runs), RP-07 and RP-08 (shared report opened, revoked, expired), LK-05 (link review end to end; blocked, no override on L2), I18-02 (language saved per account), I18-05 (server and file messages in Azerbaijani), PF-04 (300-CV pool), SEC-06 (token lifetime).

P2 and P3 (32): AD-04, AD-06, AD-07, AD-08, AD-13, AD-14, AD-15, AD-16, AD-20, AD-21, AD-22, BP-11, RQ-03, CR-02, CR-04, CR-05, RP-09, RP-10, RP-12, RN-02, SX-02, SX-03, SX-06, SX-07, SX-12, I18-04, I18-07 to I18-10, A11-08, SEC-14.

Also not run: Edge and Safari/iPhone (browsers not installed), the phone project A was not re-run in full after the last build (the vacancy, pool, results, criteria and report slice was), real Android and iPhone devices, and the 8 real-AI cases.

## Before this goes to users

1. You review and push `stage2` and deploy to Render (I cannot push or deploy). The Mac sync for this pass is `stage2-sync-10.tgz`; it goes onto `stage2` only, never `main`.
2. Run the 8 real-AI cases (RA) with your own key.
3. Run PF-01 to PF-08 once on a normal laptop with a GPU; PF-03, PF-05 and PF-06 are the ones that need it.
4. Decide SD-33 and I18-06.
5. Ask for the 45 missing cases to be written, P1 first, or accept them as not covered. A native Azerbaijani review of the new strings is still needed.
6. The shared database of the L2 harness grows with every run (a vacancy list longer than its limit broke VL-08 once). Reset it with `UAT_RESET=1 node e2e/fullstack/server.mjs` before a full L2 run.
