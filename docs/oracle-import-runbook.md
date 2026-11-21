# Oracle import: admin runbook

For the Parallax administrator and the operator. One page; the sections are numbered so a person on the phone can say "section 11". The design is in `docs/stage-3/development-plan.md` (sections 5, 15, 17). The sentences on screen are the rows of its Wording table (section 16.4); this runbook names their keys.

> **Not live.** The import is off everywhere until the go-live checklist in `docs/deploy-render.md` is signed: ADR 0011 Accepted, the owner's written exception, the DPO's sign-off and the Oracle team's written scoping. Facts marked "to confirm" wait on the Oracle test-environment probe (`docs/stage-3/oracle-probe-report.md`).

## 1. What this is and who does what

A recruiter types an Oracle vacancy ID into a Parallax vacancy and clicks **Import CVs from Oracle**; Parallax copies that vacancy's CVs through Oracle's REST API and analyzes them like uploaded CVs. It only reads from Oracle, and only when a person clicks. An administrator connects Parallax to Oracle once (the **Oracle import** tab in Administration) and watches the run list. Nobody needs the Render dashboard, except the operator for the deploy switch.

## 2. Before you start

From the Oracle team: the Oracle API address (it ends in `.oraclecloud.com`), a dedicated read-only integration account, its password and the date that password expires, and the date the career-site notice about AI screening took effect. Passwords are handed over only through the channel the owner names; never by e-mail or chat.

## 3. Activate

One form: three fields (address, user name, password), one tick-box ("Applicants on our Oracle career site are told that AI assists screening"), one click on **Activate**. The password is encrypted and never shown again. The answer is always one of five result lines (sections 4 to 8). Do not click again within 5 minutes after a refused sign-in: failed tries can lock the Oracle account.

## 4. Result line 1, code `ok` (`result.ok`)

Nothing to do. The card reads "Active since …, last check OK". Recruiters now see the Oracle field.

## 5. Result line 2, code `auth_failed` (`result.auth_failed`)

Oracle refused the user name and password. Check both with the Oracle team. Wait 5 minutes between tries. If single sign-on blocks password sign-in, use OAuth under Advanced (to confirm on the Oracle test environment).

## 6. Result line 3, code `empty_scope` (`result.empty_scope`)

Oracle answered with no vacancies, or refused with 403: the account has no data access. Ask the Oracle team to grant the recruiting organisations in scope, then **Test again**.

## 7. Result line 4, code `unreachable` (`result.unreachable`)

Oracle did not answer, not within 15 seconds, or not in the expected form. Check the address, Oracle's maintenance window, and whether Oracle accepts only listed caller addresses: Parallax on Render has no fixed outbound address.

## 8. Result line 5, code `not_oracle_address` (`result.not_oracle_address`)

The address must start with `https://` and end in `.oraclecloud.com`, on the standard port, with no user name in it. A full link pasted from Oracle's documentation is accepted and trimmed to the address.

## 9. "Oracle import is not available in this environment." (`admin.unavailable`)

The deploy switch is not set here. That is by design everywhere except the production service.

## 10. The run list

Under the card, newest first. States: **Queued** (waiting for its turn, or parked with a reason), **Running** (reading the list or fetching CVs), **Waiting for the recruiter** (paused: more CVs than confirmed, or than fit), **Completed**, **Failed**, **Cancelled**. Counts only: no candidate, file name or Oracle number is shown.

## 11. Why a run stopped or waits: the thirteen codes

The Reason column shows the sentence of the code. A code with no line here shows `run_error.unknown`: note the run ID and tell the developers.

| Code                   | Sentence (Wording key)                                                      | What happened                                                                       | What the admin does                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `oracle_unavailable`   | `run_error.oracle_unavailable`; while waiting `wait.oracle_unavailable`     | Oracle did not answer for 2 hours                                                   | Check the address and Oracle's maintenance window (section 7), then Test again, once. On `ok` the recruiter clicks Refresh                    |
| `oracle_budget`        | `wait.oracle_budget` (a waiting reason, never an end)                       | Today's Oracle call budget is spent                                                 | Wait; do not Abandon. It goes on by itself the next day (section 13)                                                                          |
| `capacity_unavailable` | `run_error.capacity_unavailable`; while waiting `wait.capacity_unavailable` | The service lacked memory for 2 hours                                               | The recruiter clicks Refresh in a quiet hour. Tell the developers                                                                             |
| `storage_low`          | `run_error.storage_low`; while waiting `wait.storage_low`                   | The CVs would not fit on the database disk; nothing was copied                      | Section 15. Nobody clicks Refresh before space is back                                                                                        |
| `sign_in`              | `run_error.sign_in`                                                         | Oracle refused the sign-in                                                          | Section 14, then the recruiter clicks Refresh                                                                                                 |
| `vacancy_gone`         | `run_error.vacancy_gone`                                                    | Oracle no longer returns the linked vacancy                                         | The recruiter checks the ID in Oracle; if Oracle still shows it, ask the Oracle team whether the account can read it. CVs already copied stay |
| `schema_changed`       | `run_error.schema_changed`                                                  | Oracle answered in a form this version does not read (often after an Oracle update) | Tell the developers. Do not retry before they answer                                                                                          |
| `actor_revoked`        | `run_error.actor_revoked`                                                   | The person who started it lost the right to edit the vacancy                        | Check the change of rights was meant. Someone who can edit clicks Refresh                                                                     |
| `did_not_finish`       | `run_error.did_not_finish`                                                  | The run stopped 5 times without moving on                                           | Give the developers the run ID. Nobody clicks Refresh before they answer                                                                      |
| `not_confirmed`        | `run_error.not_confirmed`                                                   | A pause was not answered within 2 hours                                             | Nothing to repair. The recruiter starts again and answers the question                                                                        |
| `switched_off`         | `run_error.switched_off`                                                    | The import was turned off while the run was active                                  | Nothing if meant. Once active again, the recruiter clicks Refresh                                                                             |
| `abandoned`            | `run_error.abandoned`                                                       | An administrator abandoned the run (section 12)                                     | Tell the recruiter. Refresh fetches the rest                                                                                                  |
| `archived`             | `strip.archived`                                                            | The vacancy was archived while the run was listing or paused                        | Nothing to repair. If still wanted: restore the vacancy, then Refresh                                                                         |

Not a run code: one file can end as `crash_limit` ("Failed twice, so it was left out"). It is left out for good, shows in the report and is not fetched again on Refresh.

## 12. A stuck run

The list marks a run "No progress for n minutes" when it runs with no progress for 5 minutes, waits for 30, or waits for the recruiter for 60. The log has one `import.stalled` line per stalled run every 5 minutes. Wait one more check, then **Abandon** (one confirm step). Abandon cancels the run and keeps every CV already stored; the recruiter clicks Refresh to fetch the rest. A run that waits for the next day's call budget is never marked (section 13).

## 13. The daily Oracle call budget is spent

The default is 20,000 calls a day (to confirm with the Oracle team, question 13), counted in the database, the day in Asia/Baku time. A run then waits with the reason `oracle_budget` until the next day begins; lookup, a new import and Test again are refused with "Today's limit of calls to Oracle is used up. Try again tomorrow." until then. Nothing is lost: wait, do not Abandon. If it happens on an ordinary day, tell the developers.

## 14. A password that expired or was changed

A banner shows on the card from 14 days before the expiry date entered under Advanced. Imports stop with the sign-in sentence (`run_error.sign_in`, `refusal.sign_in`) and every Oracle call is refused until fixed: Test again is refused too, so a wrong password is not tried again. Use **Replace password**: the new password is tested first, and a wrong one changes nothing (the old one stays saved and running imports go on). If the account is locked, the Oracle team unlocks it first.

## 15. Storage low

Read the database disk in the Render dashboard. Check the retention purge is on (Data retention tab). Space comes back only after the erased rows are vacuumed in a quiet hour. A larger disk is the owner's decision. An import is refused before copying when the database size plus the projected bytes x 1.15 passes 70 % of `DB_SIZE_LIMIT_MB`.

## 16. The Oracle production-to-test refresh

About once a year; the Oracle team gives the date. Afterwards the test environment holds real applicants and the synthetic vacancy is gone: do not run the probe until the Oracle team has made both again. If production sign-in fails after a refresh, see section 14.

## 17. Oracle's quarterly updates

Dates from the Oracle team. Watch the first import after each one; see `schema_changed` in section 11.

## 18. Rotating the tombstone key

`IMPORT_TOMBSTONE_KEY` is either one value (version 1, as Render generates it) or a list `2:<new>,1:<old>`. To rotate: add the new version first in the list and keep every old one; new hashes use the first, matching tries all. Never remove a version while tombstones made with it are kept. If the key is lost: turn the switch off and tell the DPO.

## 19. Turning it off

Admin: Abandon any active run, then **Turn off** (one confirm step); imports are refused from then on. Operator: remove `ORACLE_IMPORT_ENABLED` on `cv-screening` and save. At the next start every active run becomes cancelled (`switched_off`), its open files are closed, its raw Oracle numbers are blanked, one audit row per run. Imported CVs, tombstones and the key stay.

## 20. Before an image rollback or a database restore

Switch off first (section 19). Never run `npm run db:rollback` to or past 0041 on production: the 0041 down file refuses while a tombstone exists. A database restore to an earlier time loses tombstones and erasures made since: after any restore the switch stays off until the DPO decides.

## 21. Reminders

A vacancy not refreshed for 30 days shows a reminder in its Oracle strip; applicants gone from Oracle are flagged on Refresh (or erased, section 26). Retention must stay on: an import is refused while it is off. "Only use an AI company that processes in the EU" is on by default (section 25).

## 22. What is logged and what never is

Logged: run ID, state, counts, the Oracle resource name, HTTP status and duration. Never: a file name, an Oracle application or attachment number, an address, a query, a link, a password or an answer body.

## 23. Contacts

The Oracle contact and hours: ______. The DPO: ______. The programme owner: ______. Oracle's weekly maintenance window: ______. (Filled in before go-live.)

## 24. Advanced: "A team lead approves each link" (`linkPolicy`, `admin.adv.link_policy`)

On: a recruiter's first import for a vacancy is held ("The link must be approved by a team lead.") until a team lead approves the link. Off: any recruiter who can edit the vacancy links it at once. Default: **off**, the owner's decision for open linking. An administrator changes it under Advanced with that section's own **Save** (no new Activate); tell the owner first. One audit row with the old and the new value.

## 25. Advanced: "Only use an AI company that processes in the EU" (`requireEuAi`, `admin.adv.require_eu_ai`)

On: an import or a Refresh is refused with `AI_NOT_EU` (`refusal.ai_not_eu`) while the AI company in use does not process in the EU; nothing is asked of Oracle and nothing is copied. Default: **on**. An administrator may switch it off only after the DPO's written, dated decision in section 6.3 of `docs/dpia-fria-draft.md`; without it, leave it on and choose an AI model that processes in the EU (today: OpenAI with a European data-residency project). One audit row with the old and the new value.

## 26. Advanced: "When an applicant is gone from Oracle" (`goneInSource`, `admin.adv.gone`)

**Flag for review** (default) or **Erase the CV here**. On Refresh, the CV of an applicant no longer active in Oracle is flagged for a person, or erased (cause `source_removed`, with a tombstone). Erase never runs when Oracle returned 0 applications, because lost access looks the same as "all gone". Choose erase only when the DPO chose it in section 6.3 of `docs/dpia-fria-draft.md`. One audit row with the old and the new value.

---

**Failure modes:** Oracle down → the run waits up to 2 hours, then fails, no attempt lost · password refused → one shared stop for lookup, import and test until an admin replaces the password or activates again · disk nearly full → the import stops before copying · daily call budget spent → runs wait until the next day; new lookups, imports and tests are refused · switched off → active runs are cancelled and nothing else changes.
