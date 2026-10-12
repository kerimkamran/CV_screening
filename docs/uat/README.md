# UAT round 1: environment, test data and baseline (Development Plan Phase 0)

## 0.1 The UAT environment and test data

| What                                       | Where                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four test accounts                         | `node scripts/uat-seed.mjs accounts` (recruiter, team lead, compliance, report viewer); the administrator already exists                                                                                                            |
| One vacancy, English and Azerbaijani text  | `docs/uat/vacancy-en.txt`, `docs/uat/vacancy-az.txt`                                                                                                                                                                                |
| Ten invented resumes (EN, AZ, RU)          | `docs/uat/resumes/*.txt`, with `manifest.json` listing what must never reach a model                                                                                                                                                |
| Load the vacancy and resumes               | `node scripts/uat-seed.mjs data` (signs in as the UAT recruiter, extracts the skills, uploads the resumes, starts the analysis)                                                                                                     |
| Redaction check on the ten                 | `apps/api/src/assistant/redaction-fixtures.spec.ts` (runs with `npm test`)                                                                                                                                                          |
| Volume sets of 300 and 5,000               | `npm run load:pool` (see `docs/performance-run.md`)                                                                                                                                                                                 |
| A test provider that records every request | The API test harness (`apps/api/src/testing/app-harness.ts`) answers model calls with a scripted model and keeps each request in `modelCalls`; the payload log (`GET /admin/assistant/payloads`) records the same for the live site |
| One load command                           | `npm run load:pool`                                                                                                                                                                                                                 |

Settings for the seed command are read from the environment (`UAT_BASE_URL`, `UAT_ADMIN_EMAIL`, `UAT_ADMIN_PASSWORD`, `UAT_PASSWORD`); nothing is typed on the command line, and passwords are never printed. Run it only against the UAT site. All people in the fixtures are invented.

## 0.4 Baseline list

What the build is measured against at the retest. Counts are from the repository on 8 October 2026.

| Item                                    | Baseline                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Migrations                              | 0001 to 0026, each reversible (`npm run db:roundtrip`)                                                                       |
| Release gates for SenAI                 | 57 tests in `release-gates.spec.ts`, prompt lock `docs/eval/assistant-release-lock.json`                                     |
| Web tests                               | 256 (vitest), including the screens of the plan                                                                              |
| Pool at 5,000 resumes (p95, in process) | list 454 ms, next page 438 ms, mark 22 ms, 100 marks 431 ms, report 228 ms, Excel 671 ms                                     |
| Web bundle                              | 511 kB before gzip; `npm run guard:bundle` clean                                                                             |
| Screen contrast                         | 128 pairs pass on four backgrounds                                                                                           |
| Open items                              | UAT log not available to the build team; trademark check for "parallax"; Azerbaijani wording not reviewed by a native editor |

## 0.5 Decisions taken for UAT round 1

Recorded in `docs/decisions.md` (section "UAT round 1").
