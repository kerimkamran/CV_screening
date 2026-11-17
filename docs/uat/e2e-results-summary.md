# UAT results summary

Generated 2026-11-16 by `node scripts/uat-report.mjs` from `e2e/test-results/uat/*.json`. Case-by-case status is in `e2e-test-cases.csv` (columns Status, Run date, Evidence, Notes).

**392 cases:** 336 pass, 3 fail, 45 not run, 8 blocked (real AI, owner key).

## By priority

|     | Pass | Fail | Not run | Blocked |
| --- | ---- | ---- | ------- | ------- |
| P1  | 149  | 1    | 13      | 5       |
| P2  | 158  | 2    | 26      | 3       |
| P3  | 29   | 0    | 6       | 0       |

## By area

|                               | Pass | Fail | Not run | Blocked |
| ----------------------------- | ---- | ---- | ------- | ------- |
| Accessibility                 | 11   | 0    | 1       | 0       |
| Account menu                  | 12   | 0    | 0       | 0       |
| Administration                | 9    | 0    | 13      | 0       |
| Batch panel and coffeebay     | 10   | 0    | 4       | 0       |
| Candidate links               | 4    | 0    | 1       | 0       |
| Candidate pool and selection  | 29   | 0    | 0       | 0       |
| Criteria tab                  | 3    | 0    | 3       | 0       |
| CV pane and full screen       | 26   | 0    | 0       | 0       |
| CV review screen              | 22   | 0    | 0       | 0       |
| CVs card (upload)             | 14   | 0    | 0       | 0       |
| Evidence map                  | 8    | 0    | 0       | 0       |
| Language                      | 3    | 0    | 7       | 0       |
| New vacancy and Role card     | 17   | 0    | 0       | 0       |
| Performance                   | 4    | 3    | 1       | 0       |
| Real-AI smoke                 | 0    | 0    | 0       | 8       |
| Report and sharing            | 11   | 0    | 5       | 0       |
| Requirements drawer           | 4    | 0    | 1       | 0       |
| Results and star map          | 15   | 0    | 1       | 0       |
| Review sprint                 | 9    | 0    | 0       | 0       |
| Role matrix                   | 8    | 0    | 0       | 0       |
| Runs tab                      | 1    | 0    | 1       | 0       |
| Security                      | 12   | 0    | 2       | 0       |
| SenAI admin, roles and limits | 7    | 0    | 5       | 0       |
| SenAI candidate panel         | 14   | 0    | 0       | 0       |
| SenAI pool panel              | 31   | 0    | 0       | 0       |
| Shell and navigation          | 14   | 0    | 0       | 0       |
| Sign-in and passwords         | 17   | 0    | 0       | 0       |
| Vacancy list                  | 11   | 0    | 0       | 0       |
| Vacancy page                  | 10   | 0    | 0       | 0       |

## Failing cases

- **PF-03** CV review first page render (P1): Projects run: A-en D-en. Failing: D-en: Error: first page drawn 1872 ms after navigation (limit 1500)
- **PF-05** Full-screen CV on a 1920 px screen (P2): Projects run: DW-en. Failing: DW-en: Error: first page after 1024 ms (limit 1000)
- **PF-06** Coffeebay waiting scene animation budget (P2): Projects run: D-en. Failing: D-en: Error: main thread busy 2.17 % over 60 s (limit 1 %; script 0.08 %, layout 0.06 %, style 0.32 %)

## Not run

- AD-04 Row 'Copy invite link' copies the link and gives feedback at the row (P2, L1)
- AD-06 Reset two-step for someone who lost the phone (P2, L2)
- AD-07 Users: load error, empty list, long list, action error (P2, L1)
- AD-08 AI models: status notice, empty and error states (P2, L1)
- AD-12 AI models for real: add the fake company, switch the active model, the key never reaches the browser (P1, L2)
- AD-13 Assistant tab opens and saves the basic settings (P2, L1)
- AD-14 Assistant: 'Test connection' keeps unsaved changes, including a model just added (P2, L1)
- AD-15 Fairness monitoring for admins: run the paired-CV test and read the results (P2, L1)
- AD-16 Fairness monitoring for governance: read-only (P2, L1)
- AD-19 Data retention for real: preview, hold, erase and certificate (P1, L2)
- AD-20 Admin pages in Azerbaijani and on all four backgrounds (P3, L1)
- AD-21 First administrator from the environment: created once, must change the password, never reset by a restart (P2, L2)
- AD-22 The last active administrator can never be removed, also by two admins at the same moment (P2, L2)
- BP-09 Retry failed (n) and row Retry: server retry and resend from this tab, no new AI calls for finished CVs (P1, L2)
- BP-10 Reload or another device during a batch: same picture, choose the missing files again (P1, L2)
- BP-11 A colleague's batch: plain 'Latest upload' section, no scene, no signals for the viewer (P2, L2)
- BP-12 Session expiry (401) in the middle of sending: sending resumes after signing in again (P1, L2)
- RS-14 Stop the scan and Continue reading; Report and Runs agree (P1, L2)
- RQ-03 'Back to original' from the drawer and from the page notice (P2, L2)
- CR-02 Extract with AI: empty state, AI confidence hints, replace confirm only after a press (P2, L2)
- CR-04 Freeze criteria: confirm, saved first, frozen state, error without scored criteria (P2, L2)
- CR-05 Edit the job text, create a new version, double new version refused, re-analyze hint (P2, L2)
- RP-07 The named person opens the shared report; opens are logged; quotes follow the setting (P1, L2)
- RP-08 Shared report not on the list, revoked, expired, and a load error (P1, L2)
- RP-09 'Reports shared with me' list: rows, empty, loading, phone (P2, L2)
- RP-10 A share is a snapshot: later changes do not reach it; Azerbaijani viewer (P2, L2)
- RP-12 A share's names promise matches what the viewer sees, also for a share made through the API (P2, L2)
- RN-02 Runs agree with Results and Report after stop, continue and re-analyze (P2, L2)
- LK-05 Link review end to end: consent, redaction, not scored, withdraw (P1, L2)
- SX-02 Name, reader model and the unavailable message (P2, L2)
- SX-03 Function switches change the panels after a reload and the API refuses switched-off calls (P2, L2)
- SX-06 Breaker and 'How SenAI is doing' (P2, L2)
- SX-07 Words the assistant knows: add, aliases, approve, reject, remove (P3, L2)
- SX-12 Admin > Assistant page: loading, errors, empty states and layout (P3, L2)
- I18-02 Language is saved per account and follows the person (P1, L2)
- I18-04 AZ completeness of Admin, Retention, Monitoring and account pages (P2, L1)
- I18-05 Server and file messages in AZ (P1, L2)
- I18-07 Dates, times and counts in AZ (P2, L1)
- I18-08 Long AZ labels fit on small screens (P2, L1)
- I18-09 Consistent Azerbaijani terms and register (P3, L1)
- I18-10 One name per place across the app (P3, L1)
- A11-08 Live regions announce once and in the UI language (P2, L1)
- PF-04 Candidate pool with 300 CVs: scroll, select all, ZIP (P1, L2)
- SEC-06 A token past its lifetime ends the session; refresh does not lengthen it (P1, L2)
- SEC-14 UAT seed tooling loads accounts and data without errors (P3, L2)
