# Decisions to freeze before Sprint 1 (Plan §24.1)

Status as of the initial scaffold. "Open" means no one has recorded an answer in this repo.

|   # | Decision                                                                                                 | Plan default                                                 | Owner               | Status                       |
| --: | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- | ---------------------------- |
|   1 | Run the 3-week, ~$5k vendor bake-off? Buy if a vendor reaches ≥8/10 top-10 overlap on **both** AZ and RU | Yes                                                          | Sponsor             | Open                         |
|   2 | Are EU AI Act obligations statutory or voluntary for Azerconnect?                                        | Voluntary-but-adopted (D3); confirm scope                    | Legal               | Open                         |
|   3 | Team size and composition                                                                                | 3 eng + 1 PM + fractional design/QA/gov                      | Sponsor             | Open                         |
|   4 | Accept ~19 months to R1b / ~22 to full programme, or pull a lever                                        | Accept, or add engineers                                     | Sponsor             | Open                         |
|   5 | ~140 recruiter hours for the golden set, protected, from Sprint 0                                        | Committed                                                    | TA Lead             | **Open — schedule-critical** |
|   6 | 2-week baseline incl. recruiter-to-recruiter agreement                                                   | Run before Sprint 1                                          | PM                  | Open                         |
|   7 | Model provider and region                                                                                | One hosted provider, EU, DPA, zero-retention, behind gateway | Procurement + Legal | Open                         |
|   8 | Document-AI vendor (Azure Document Intelligence vs Google Document AI on Azerbaijani script)             | Bake off                                                     | Eng lead            | Open                         |

Recorded in this repo: cloud = **Azure, westeurope/northeurope** (ADR 0005).

# UAT round 1: decisions (Development Plan section 6)

Taken by the product owner on 7 and 8 October 2026 while building the plan. "Where" says what enforces it.

| Topic                         | Decision                                                                                                                      | Where                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Assistant name                | **SenAI**, slogan "Sən istə, Senai tapsın" (Ask bar hint and panel greeting). The name stays editable in Admin                | migration 0024, `assistant.ts` `SLOGAN`                                    |
| Assistant language            | Answers in the language of the question (English, Azerbaijani, Russian)                                                       | `assistant-az.ts`, pool assistant                                          |
| Assistant chats               | Private to the person; admin and compliance can review turns and the payload log, not read other people's chats               | migration 0025, `/admin/assistant/audit`                                   |
| Candidate names               | **Shown** on every screen (not hidden). Switch: `CANDIDATE_NAMES=hidden` brings back "Candidate NN" and per-person reveal     | `env.ts`, `candidate-view.service.ts`                                      |
| Original resume               | Shown side by side with the result as HTML, with the places where a skill was found highlighted. No download of the original  | `CandidateReport.tsx`, `GET /candidates/:id/resume`                        |
| Everyone is listed            | "Not now" candidates stay in the list                                                                                         | `pool.service.ts`                                                          |
| Closed and archived vacancies | Closed vacancies stay in the pool and decisions still work; Archived is read-only                                             | `vacancy-scope.service.ts`                                                 |
| Similar vacancy               | Creating a vacancy with the same or a similar title asks "use the one already in the system"                                  | `GET /vacancies/similar`, `RoleCard.tsx`                                   |
| Who sees which vacancy        | All recruiters see all vacancies; the owner or a team lead edits. `VACANCY_VISIBILITY=granted` limits it                      | `env.ts`                                                                   |
| Decision control              | A compact dropdown pill on every row and in the report                                                                        | `MarkSelect.tsx`                                                           |
| Star map                      | Stays, as a tab of the vacancy page                                                                                           | `VacancyPage.tsx`                                                          |
| What a save needs             | Only the title; a run needs at least one skill                                                                                | `vacancy.service.ts`                                                       |
| Extra features                | Excel export of the pool; Shortlist summary for the hiring manager (copy or e-mail; nothing is sent from the server)          | `CandidatePool.tsx`, `/candidates/export`, `/candidates/shortlist-summary` |
| Not built                     | Analyzing one resume against several vacancies at once (plan item 27)                                                         | -                                                                          |
| Wording                       | Plain words; no official-sounding jargon in screens or documents                                                              | `i18n/az.pool.ts`                                                          |
| Usage day for caps            | Asia/Baku day and month                                                                                                       | `assistant.service.ts` `usage()`                                           |
| Usage caps                    | Counted in answers, not US dollars: no price list is held for the providers. Convert with the provider's current price        | `assistant_setting.daily_cap`, `monthly_cap`                               |
| Model or prompt change        | Blocked until the release gates pass: `npm run gates:assistant:lock`; the lock test fails if a prompt changed without a rerun | `release-lock.spec.ts`                                                     |
