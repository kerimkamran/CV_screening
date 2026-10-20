# parallax by Azerconnect Group: development plan for UAT round 1

| | |
|---|---|
| **Date** | 8 October 2026 |
| **Audience** | Developers, QA, product owner |
| **Scope** | The changes UAT asked for in round 1: Vacancy pool, Candidate pool with side-by-side report, active AI assistant |
| **Source documents** | `parallax-design-spec.md` v2.3 (what to build and why), `parallax-uat-log.md` (comments, test data, acceptance criteria, retest steps) |
| **Status** | Designed and reviewed by three independent reviewers (94 findings, applied to the spec and the log). **Not built. Nothing has been tested against the build.** |
| **Not in this plan** | Dates and effort in days. The team has not been consulted, so sizes below are relative (S, M, L), not estimates. |

## 1. What UAT asked for

| ID | Comment | Result |
|---|---|---|
| UAT-01 | A **Vacancy pool**: the recruiter adds a vacancy link, the JD and information | A main section; the old two-card home screen becomes the body of a vacancy |
| UAT-02 | A **Candidate pool** of analyzed candidates with decision and score; open the score report and the resume **side by side** at any time | A main section; a two-pane report with an anonymised resume viewer; decision marks move into release 1 |
| UAT-03 | **Activate the AI assistant** to find the right candidate without searching, and to ask for more description and evaluation in each report | Elon moves into release 1: the Ask bar answers "find the right candidate for X position" by finding X in the Vacancy pool, then using candidates **already analyzed**; a composer inside each report |

Design rule from the owner: **easy to use, compact and simple**. The spec turns it into four checks (spec section 1, need 8).

## 2. Rules that apply to every work package

1. **A human decides.** Nothing rejects, hides or re-ranks a candidate. A missing must-have lowers the match only. Decision marks never change the AI band or score.
2. **Names are hidden by default.** Pseudonyms everywhere; real names and original resumes only through a logged reveal.
3. **Protected attributes never reach scoring or the assistant.** Redaction happens on the server, not in the browser and not in a prompt.
4. **The server owns the numbers.** Counts, bands, scores, order and statuses come from the same query the pool uses. The model writes only wording.
5. **Every claim is checkable.** Evidence is anchored in the resume; quotes must exist in the anonymised text.
6. **English and Azerbaijani from the first screen.** All text from a message catalogue; case folding and search treat İ, I, ı, i correctly.
7. **One primary button per screen.** Compact rows (44 px), progressive disclosure, Undo instead of confirmation.

## 3. Dependencies and critical path

```
Phase 0  Prerequisites (parallel)
   │
Phase 1  Vacancy pool  (UAT-01) ──────────────┐
   │                                          │
Phase 2  Analysis belongs to a vacancy ───────┤
   │                                          │
Phase 3  Candidate pool and report (UAT-02) ──┤
   │                                          │
Phase 4  Assistant (UAT-03) ◀── needs Phase 3 and the blocking decisions in section 6
   │
Phase 5  Hardening and UAT retest
```

**Critical path:** Vacancy entity (1.2) → analysis for a vacancy (2.3) → pool row identity (3.1) → resume viewer and redaction (3.5) → pool search and answers (4.4) → release gates (4.8).

**Can run in parallel:** the navigation shell and message catalogue (0.2, 1.1), test data and the test provider (0.1), the admin console and provider layer (4.1), the design tokens (0.3).

## 4. Phases and work packages

Size: **S** small, **M** medium, **L** large (relative to each other). "Spec" lists the sections to read. "Criteria" are the acceptance criteria in the UAT log.

### Phase 0. Prerequisites

| WP | Work | Spec | Size | Done when |
|---|---|---|---|---|
| 0.1 | **UAT environment and test data:** four accounts, the vacancy and resume files, the 10-resume redaction fixture pack, the volume sets, and a **test provider** that records every request | UAT log "test data" | M | All items in the log's data section exist and are loadable by one command |
| 0.2 | **Message catalogue** (English, Azerbaijani) and locale-neutral text folding | 13 | S | No hard-coded UI text; folding passes the test words in the log |
| 0.3 | **Design tokens** for the new components, dark theme first | 4.5 | S | Tokens named and contrast values met |
| 0.4 | **Baseline list**: which spec 2.1 features the build already has | UAT log "Baseline" | S | Every row marked In build or Not in build |
| 0.5 | **Decisions** (section 6) that affect Phase 1 to 3 | 14 | S | Items 23, 25, 26, 28, 29 answered or the proposed defaults accepted |

### Phase 1. Vacancy pool (UAT-01)

| WP | Work | Spec | Size | Criteria |
|---|---|---|---|---|
| 1.1 | **Navigation shell:** left rail (Vacancies, Candidates), top bar with the Ask bar slot and account menu; phone bottom bar | 5 | M | UAT-01 1, 16 |
| 1.2 | **`Vacancy` entity and API:** fields, `requirementsVersion`, `VacancyVersion`, `version` for concurrent edits, archive, restore, duplicate, history, runs list | 10.1, 10.3 | L | 3, 11, 12, 15 |
| 1.3 | **Vacancy list:** columns and formats, chips (All, Draft, Open, On hold, Closed, Archived), search, sort in Azerbaijani order, empty state | 6.7 | M | 2, 9, 10 |
| 1.4 | **Role card as the form:** title, the requirements box (paste, Word file, link), extraction call, must-have and nice-to-have chips, experience chips, "More details", Save, browser draft, leave guard | 6.1.3, 6.7 | L | 3 to 8, 13 |
| 1.5 | **Link reading:** server-side fetch with the security rules and limits (private addresses refused after every redirect, 10 s, 2 MB, 3 redirects), Read again, unchanged and changed behaviour | 6.1.3, 10.7 | M | 7, 12 |
| 1.6 | **Vacancy page:** header, Role and Resumes cards, tabs Candidates, Report, Runs, "Last run" line, History link | 6.7 | M | 14 |

**Phase 1 demo:** create a vacancy from paste, Word and link; edit requirements; archive and restore; see versions.

### Phase 2. Analysis belongs to a vacancy

| WP | Work | Spec | Size | Criteria |
|---|---|---|---|---|
| 2.1 | **Resume intake into a vacancy:** upload to `/vacancies/{id}/resumes`, folders and ZIP with safe unpacking, summary line, file problems (locked, scan, damaged, wrong type, too large) | 6.1.4, 10.7 | L | UAT-02 1 |
| 2.2 | **Parsing and language:** Azerbaijani, English, mixed, Russian best effort; text and page structure kept for anchors | 13 | L | |
| 2.3 | **Screening run for a vacancy:** frozen requirements snapshot and version, asynchronous status, cancel, rows enter the pool as scored | 6.3, 10.1 | L | UAT-02 24 |
| 2.4 | **Scoring and evidence:** score 0 to 100, band, matched, partly found and missing as evidence states, **evidence anchors** (page, block, start, end), one-sentence reason | 6.2.2, 6.2.3, 10.2 | L | UAT-02 2, 16 |
| 2.5 | **Pseudonyms and reveal rules** at candidate-in-vacancy level | 6.2.6, 6.8 | M | UAT-02 3, 15 |
| 2.6 | **Results and the in-app evaluation report** (existing 2.1 features: confirm against the baseline) | 6.2, 6.5 | M | |

**Phase 2 demo:** add 30 resumes to a vacancy, analyze, see bands, proof and hidden names.

### Phase 3. Candidate pool and report (UAT-02)

| WP | Work | Spec | Size | Criteria |
|---|---|---|---|---|
| 3.1 | **Row identity:** `VacancyCandidate`, one current match per candidate and vacancy, decision carried over on re-analysis, `isCurrent` | 6.8, 10.1 | M | 10, 11 |
| 3.2 | **Decision marks:** New, Shortlist, Maybe, Not now; inline control; Undo (10 s); optional reason; history; **concurrency** (`expectedVersion`, 409 with who changed it); **bulk** up to 100 with a result per row | 6.2.4, 6.8, 10.3 | L | 7, 8, 9, 10 |
| 3.3 | **Candidate pool list:** columns, filters (Vacancy, Band, Decision, Out of date), search, sort, paging (50, "Show 50 more", cursor expiry), remembered state, empty and error states | 6.8 | L | 1 to 6, 20, 25 |
| 3.4 | **Out-of-date scores:** version on each match, badge, filter, vacancy list counter, report banner, Re-analyze that keeps decisions | 6.7, 6.8 | M | 12 |
| 3.5 | **Candidate report and resume viewer:** two panes, divider rules, previous and next from the origin list, Back restores state, phone switch; **server-side anonymisation** with the redaction list; two separate reveals; evidence highlight; DOCX shown through a PDF rendering | 6.9, 4.5 | L | 13 to 19, 21 |
| 3.6 | **Roles and access:** recruiter, admin, compliance; 403 and 404 messages; counts only of visible rows | 6.10 | M | 23 |
| 3.7 | **Performance** against the targets and volume sets | 10.6 | M | 22 |

**Phase 3 demo:** the pool of 300 rows, filter and decide, open a report, check redaction on the fixture pack.

### Phase 4. Assistant (UAT-03)

Starts when Phase 3 is demonstrable and the blocking decisions in section 6 are closed (test data may be used before that).

| WP | Work | Spec | Size | Criteria |
|---|---|---|---|---|
| 4.1 | **Admin console minimum and provider layer:** provider, model, region, retention terms and attestation, write-only credential reference, caps in USD with the Asia/Baku day, warning percentage, unavailable message, ability switches | 6.6.5 | M | UAT-03 19 |
| 4.2 | **Redacted evidence package and vacancy package;** payload whitelist; the test provider records every request | 6.6.4, 6.6.5 | M | 15 |
| 4.3 | **Vacancy resolution by title:** position phrase, folding, three match tiers, ordering, "ask which one", no match, archived excluded, optional synonym list | 6.6.9 | M | 2, 3, 4 |
| 4.4 | **Pool search and answers:** the server selects, orders and counts with the pool's query; header counts; Top 5 and Show all; no-position questions grouped by vacancy; unanalyzed, running, out-of-date and nothing-analyzed cases; scope precedence; "As of" | 6.6.9 | L | 5 to 12 |
| 4.5 | **Ask bar and panel; report composer:** docked, side sheet and bottom sheet; suggestions; chips exactly as listed; Deeper evaluation sections; Compare limited to the same vacancy | 6.6.2, 6.6.10, 6.6.11 | L | 1, 13, 14 |
| 4.6 | **Guardrails:** citation validation (quotes exist in the anonymised text), refusals, no verdicts, hold-or-update rule including the "possible missed evidence" flag, hidden instructions in vacancy fields treated as data | 6.6.4 | L | 15 to 18 |
| 4.7 | **Threads and audit:** candidate and pool threads, reopen and delete, notice in the panel, append-only audit with pseudonyms shown, access for admin and compliance | 6.6.6 | M | 20, 21 |
| 4.8 | **Release gates:** swap suite (name, gender markers, patronymic, age, marital status, nationality, photo, in both languages), red-team set, pushback suite, quote accuracy, consistency; a model or prompt change is blocked on failure | 6.6.4 | L | 22, 23 |

**Phase 4 demo:** "Find the right candidate for Backend Engineer" end to end; the answer equals the pool; a protected-attribute question is declined; the payload log shows only allowed fields.

### Phase 5. Hardening and retest

| WP | Work | Done when |
|---|---|---|
| 5.1 | Accessibility check of the new screens (tables, split view, Ask bar, live announcements, keyboard) | Spec section 9 items 1 to 13 pass |
| 5.2 | Bias review on Azerbaijani and English resumes and the release-gate report | Report accepted by the owner and legal |
| 5.3 | Performance run on the volume sets | Targets of 10.6 met at the 95th percentile |
| 5.4 | **UAT retest** by the steps in `parallax-uat-log.md`, on the build made from spec 2.3 | Every criterion marked pass, or a defect logged |

## 5. Definition of done (every work package)

- Behaviour matches the spec section named, in English and Azerbaijani.
- The acceptance criteria listed for it pass on the test data.
- Keyboard use and a screen reader announcement work for the new controls.
- No real names, contact details or protected attributes appear in any response, log or page title where the spec says they must not.
- The audit and history entries the spec requires are written.

## 6. Decisions that block or shape the work

| # | Decision | Blocks | Proposed default (used if the owner does not change it) |
|---|---|---|---|
| 17 | Final assistant name ("Elon" is a working name; research advises against it) | Phase 4 with real data | Keep the name configurable; original face-free avatar |
| 18 to 21 | Provider data terms; consent and cross-border transfer; audit-log access; retention | Phase 4 with real data | Use test data until closed |
| 24 | Resume viewer: anonymised by default, original as a logged reveal, no download | Phase 3 with real data | As stated |
| 25 | Who sees which vacancies, candidates and decisions | Phases 3 and 4 with real data | Spec 6.10 default |
| 23 | A pool row is one candidate in one vacancy | Phase 3 | As stated |
| 26 | Title-matching and out-of-date rules | Phase 4 | Spec 6.6.9 and 6.8 |
| 27 | May recruiters analyze pool candidates for another vacancy from an answer | Phase 4 | Not built unless approved |
| 28 | Vacancy "More details" required fields; may a run start without requirements | Phase 1 | Only the title is required; a run may start |
| 29, 5 | Performance targets; UAT limits | Phases 1 to 3 | Spec 10.6 and 10.7 |

## 7. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Release 1 grew: decision marks and the assistant moved up | Later delivery of the pools | The order in section 3 lets UAT test the vacancy pool and the candidate pool before the assistant is ready |
| Anonymising a resume completely | A name left in free text, a text box or the file name | Redaction on the server on extracted text; the 10-resume fixture pack with zero allowed misses; described to users as "hidden on screen", not a guarantee |
| The assistant sounds more certain than the evidence | Over-reliance, unfair outcomes | Server-written numbers, validated citations, hold-or-update rule, release gates before any real data |
| Candidate data leaves the group | Legal and trust risk | Only the redacted evidence package and vacancy package are sent; the provider, region and retention are set by an admin and recorded; real data waits for items 18 to 21 |
| Scores shown after the requirements changed | Wrong shortlist | Version on every match; "Out of date" badge; the assistant lists current matches only |
| Large pools and 100-resume batches | Slow screens, failed UAT | Server-side paging and search; targets in 10.6 tested on the volume sets in Phase 3 |

## 8. How new UAT comments are handled

Each new comment is added to `parallax-uat-log.md` as the next ID with a decision, acceptance criteria and retest steps, and is placed into this plan as a work package in the phase it depends on. Comments that change a decision in section 6 are raised with the owner first.

*This plan was written from the design spec and an independent review. It has not been checked with the development team, and nothing in it has been tested against the build.*
