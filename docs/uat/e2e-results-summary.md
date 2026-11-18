# UAT results summary

Generated 2026-11-17 by `node scripts/uat-report.mjs` from `e2e/test-results/uat/*.json`. Case-by-case status is in `e2e-test-cases.csv` (columns Status, Run date, Evidence, Notes).

**398 cases:** 366 pass, 1 fail, 23 not run, 8 blocked (real AI, owner key).

## By priority

| | Pass | Fail | Not run | Blocked |
| --- | --- | --- | --- | --- |
| P1 | 162 | 0 | 2 | 5 |
| P2 | 175 | 0 | 15 | 3 |
| P3 | 29 | 1 | 6 | 0 |

## By area

| | Pass | Fail | Not run | Blocked |
| --- | --- | --- | --- | --- |
| Accessibility | 11 | 0 | 1 | 0 |
| Account menu | 12 | 0 | 0 | 0 |
| Administration | 15 | 0 | 7 | 0 |
| Batch panel and coffeebay | 14 | 0 | 0 | 0 |
| Candidate links | 5 | 0 | 0 | 0 |
| Candidate pool and selection | 29 | 0 | 0 | 0 |
| Criteria tab | 3 | 0 | 3 | 0 |
| CV pane and full screen | 26 | 0 | 0 | 0 |
| CV review screen | 22 | 0 | 0 | 0 |
| CVs card (upload) | 15 | 0 | 0 | 0 |
| Evidence map | 8 | 0 | 0 | 0 |
| Home (HM) | 5 | 0 | 0 | 0 |
| Language | 6 | 0 | 4 | 0 |
| New vacancy and Role card | 17 | 0 | 0 | 0 |
| Performance | 7 | 0 | 1 | 0 |
| Real-AI smoke | 0 | 0 | 0 | 8 |
| Report and sharing | 16 | 0 | 0 | 0 |
| Requirements drawer | 4 | 0 | 1 | 0 |
| Results and star map | 16 | 0 | 0 | 0 |
| Review sprint | 9 | 0 | 0 | 0 |
| Role matrix | 8 | 0 | 0 | 0 |
| Runs tab | 2 | 0 | 0 | 0 |
| Security | 13 | 0 | 1 | 0 |
| SenAI admin, roles and limits | 7 | 0 | 5 | 0 |
| SenAI candidate panel | 14 | 0 | 0 | 0 |
| SenAI pool panel | 31 | 0 | 0 | 0 |
| Shell and navigation | 13 | 1 | 0 | 0 |
| Sign-in and passwords | 17 | 0 | 0 | 0 |
| Vacancy list | 11 | 0 | 0 | 0 |
| Vacancy page | 10 | 0 | 0 | 0 |

## Failing cases

- **SH-14** Rail highlight on the landing page #/ and on a CV review (P3): Projects run: A-AZ A-EN D-AZ D-EN T-AZ T-EN. Failing: D-EN: Error: expect(locator).toBeVisible() failed

## Not run

- AD-04 Row 'Copy invite link' copies the link and gives feedback at the row (P2, L1)
- AD-06 Reset two-step for someone who lost the phone (P2, L2)
- AD-07 Users: load error, empty list, long list, action error (P2, L1)
- AD-08 AI models: status notice, empty and error states (P2, L1)
- AD-13 Assistant tab opens and saves the basic settings (P2, L1)
- AD-14 Assistant: 'Test connection' keeps unsaved changes, including a model just added (P2, L1)
- AD-20 Admin pages in Azerbaijani and on all four backgrounds (P3, L1)
- RQ-03 'Back to original' from the drawer and from the page notice (P2, L2)
- CR-02 Extract with AI: empty state, AI confidence hints, replace confirm only after a press (P2, L2)
- CR-04 Freeze criteria: confirm, saved first, frozen state, error without scored criteria (P2, L2)
- CR-05 Edit the job text, create a new version, double new version refused, re-analyze hint (P2, L2)
- SX-02 Name, reader model and the unavailable message (P2, L2)
- SX-03 Function switches change the panels after a reload and the API refuses switched-off calls (P2, L2)
- SX-06 Breaker and 'How SenAI is doing' (P2, L2)
- SX-07 Words the assistant knows: add, aliases, approve, reject, remove (P3, L2)
- SX-12 Admin > Assistant page: loading, errors, empty states and layout (P3, L2)
- I18-05 Server and file messages in AZ (P1, L2)
- I18-08 Long AZ labels fit on small screens (P2, L1)
- I18-09 Consistent Azerbaijani terms and register (P3, L1)
- I18-10 One name per place across the app (P3, L1)
- A11-08 Live regions announce once and in the UI language (P2, L1)
- PF-04 Candidate pool with 300 CVs: scroll, select all, ZIP (P1, L2)
- SEC-14 UAT seed tooling loads accounts and data without errors (P3, L2)
