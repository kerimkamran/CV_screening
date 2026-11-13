# UAT final report: parallax by Azerconnect Group (stage2)

Written 2026-11-13 by Claude for Kamran Karimli (AG HR). Plan: docs/uat/e2e-test-plan.md v1.1 (392 cases). Case list: docs/uat/e2e-test-cases.csv.

## Honest summary

- The tool is **not fully tested**. The overnight window (08:00 Baku, 2026-11-04) was missed because the 5-hour usage limit stopped the run. The work resumed on 2026-11-12/13 and this report closes it out.
- 221 of the 392 cases have an automated result (L1 mocked API, L2 full stack with Postgres and a fake AI). 171 cases have no result: they were never built or never run (list below). The 8 real-AI cases (RA, L3) were not run because they need your provider key typed by you.
- About 70 app defects found by the tests were fixed in the code during the run (list in STATUS.md). The two serious ones (S1) are fixed: governance could change retention (SD-40), and the CV viewer was not a real full-screen layer (UAT-BUG-001).
- 21 cases still failed in the last full re-run of the previously failing IDs (fix2-l1.json, fix2-l2.json). One of them (AD-02) was fixed afterwards and not re-run. The rest are open and listed below.

## Last re-run (2026-11-12): 32 previously failing IDs, D/T/A × en/az on L1 and D en on L2

Passing now: AD-03, AD-18, CP-13, CP-17, CR-01, CV-02, RQ-02, RS-13, SEC-07, SP-03, SP-05, SP-08 (passed this time; it was intermittent before, cause not found).

Still failing (open):

| ID | Failure | Likely severity | Where to look |
| --- | --- | --- | --- |
| SX-08 | Governance role sees "Administrators only." on #/admin/assistant instead of read-only Recent answers and payload log. Needs an API permission change too (GOVERNANCE read on /admin/assistant/*) | S2 | App.tsx admin route, assistant.controller.ts |
| AD-02 | Invite-link field not focused/selected after a blocked copy | S3 | **Fixed after the run** (Admin.tsx, ref + focus + select). Not re-run. |
| AD-11, AD-17 | Admin action result / timeout on A-en (AD-17 timed out at 45 s) | S3 | e2e/specs/admin.spec.ts, Admin.tsx |
| CP-12 | Active pool row is not focusable by keyboard in the test's sense | S3 | CandidatePool.tsx list keys |
| CP-22, RP-06 | Visible "copying failed" message is not found next to the copy control when the clipboard is blocked | S3 | CandidatePool.tsx, ShareReport.tsx (may be a test emulation issue) |
| CP-27 | Results table has no columnheader cells | S3 | CandidatePool.tsx sort headers |
| CV-07 | T and A: page 2 with the mark not inside the viewport; aria-controls on the tab does not point to a tabpanel (all touch devices, en and az) | S3 | CvPane.tsx, Segmented.tsx |
| CV-21 | AZ: "Back link" is in the Tab order | S4 | CvReview.tsx |
| EM-03 | Evidence-map box measurements off by more than 1 % after zoom; one page does not fit after Fit | S3 | PdfPages.tsx, EvidenceMap.tsx |
| FS-18 | Layout shift sum above the limit on D-en | S3 | CvPane.tsx |
| FS-20 | "Original" tab does not return to the same scroll position (all six projects) | S3 | CvPane.tsx scroll memory |
| LK-03, LK-04 | Link reader status text (D, A) and AZ value mismatch | S3 | CandidateLinks.tsx, az.stage2.ts |
| RN-01 | Runs card shows "Last run: none yet" after a run (all projects) | S3 | VacancyPage.tsx Runs |
| RP-01 | AZ: footer report date is ISO instead of a localized date (D, T, A az) | S4 | Report.tsx |
| RP-15 | Show-more button reads "Close" with aria-expanded=true while nothing new is shown | S4 | Report.tsx |
| RQ-01, RQ-04, RS-04 | Result/criteria details (see fix2-l1.json) | S3-S4 | Results.tsx, Criteria |

Severity here is my reading of the failure message, not a confirmed triage. Triage files exist for packages A, B, D and E only (triage-A/B/D/E.md). There is no triage for F, G or H.

## Cases with no result (171)

Never built or never run: package G (SenAI panels: SA, SC, SX-01..06, SX-09..11), package H (language, accessibility, performance: I18, A11, PF), package E CP-04..07, CP-14, CP-15, CP-19, CP-23..25, CP-28, package B 13 cases (AD-12, AD-21, AD-22, SEC-06, SEC-12/13 step 5 need restarts, exclusive DB or a lower rate limit), package D 38 cases including the P1 cases BP-09, BP-10, BP-12, BP-13, BP-14, RS-14, RQ-05, RP-07, RP-08, package F FS-15 and FS-21..26, LK-05 (blocked: no link-reader override on L2), and the 8 real-AI cases (RA, L3). Full list: `python3` over the CSV minus the IDs in the result JSON files; the aggregate used here is in the session, not in the repo.

Devices: Edge and Safari (WebKit) projects were not run (browsers not installed in the sandbox). Chromium projects D, DW, DS, T, TL, A were used; the full matrix was not run for every case.

## Fixes made in code (summary)

See STATUS.md "Fixes so far" for the full log. Main groups: retention role split (API), logout and wrong-password responses (API), CV viewer as a native modal dialog with toolbar, zoom and reading-position memory, evidence map, bottom-bar and review-bar height variables, 44 px touch targets, error boundaries, network error messages, Azerbaijani strings, ARIA tabs and list keys, confirmation dialogs for destructive admin actions, leave guards, drag-and-drop guard, and invite-link focus.

## Before this goes to users

1. You review and push the stage2 commit and deploy to Render yourself (I cannot push or deploy).
2. Decide on SX-08 (a feature gap for the governance role), the CV viewer items (CV-07, EM-03, FS-18, FS-20) and RN-01. Everything else open is S3/S4.
3. Run the 8 real-AI cases (RA) with your own key. I will not type a provider key.
4. Build the 171 missing cases, or accept them as not covered. The P1 ones in package D come first.
