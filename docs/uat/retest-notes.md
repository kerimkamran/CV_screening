# UAT retest notes (Development Plan WP 5.4)

The UAT log (`parallax-uat-log.md`) was not available to the build team, so the plan and design spec v2.3 were used as the checklist. When the log is shared, map each finding to a row below.

## How to retest

1. `npm run uat:seed -- accounts`, open each link, choose passwords.
2. `npm run uat:seed -- data`.
3. Walk the checklist, in English and in Azerbaijani, on a laptop and on a phone-width window.

## Checklist

| Area           | Check                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame          | Left rail (Vacancies, Candidates), Ask bar with the slogan, account menu, bottom bar on a phone; `/` focuses the Ask bar                                                                 |
| Vacancy pool   | Chips, search, sort, row menu, archive and Undo for 10 seconds, empty state                                                                                                              |
| Role card      | Only the title is required; the similar-title prompt; Word file; link read and "read again"; skills as chips; unsaved-changes warning; a second editor gets a plain "changed by" message |
| Resumes card   | Drop, skipped files with reasons, candidate notice once, "Find the best fit", "Re-analyze", the list of what is missing                                                                  |
| Vacancy page   | Tabs Candidates, Star map, Report, Runs, Skills; "Last run" line; History                                                                                                                |
| Candidate pool | Names shown; filters; bulk marks up to 100 with Undo; "Show 50 more"; list expiry message; Excel; Shortlist summary                                                                      |
| Report         | Match and resume side by side; "Show in resume"; divider by keyboard; Previous and Next (J and K); out-of-date banner; note                                                              |
| SenAI          | Answers in the language of the question; refuses age, gender, family, nationality, photo and decisions; chats private; delete a chat                                                     |
| Admin          | Provider, model, region, data terms and attestation; caps; unavailable message; switches; payload log; compliance review                                                                 |

## Open after this build

UAT log mapping; trademark check for "parallax"; native-speaker review of the Azerbaijani wording; a screen-reader walk-through (NVDA, VoiceOver); a live-model run of the paired-CV test and twenty SenAI answers checked by hand; usage caps in US dollars (answers are counted instead).
