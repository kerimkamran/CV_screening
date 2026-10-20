# parallax by Azerconnect Group: UAT round 1 plan

| | |
|---|---|
| **Date** | 8 October 2026 |
| **Build under test** | Working build made by the developers from the design spec v2.1 |
| **Documents** | `parallax-design-spec.md` (v2.3), `parallax-uat-log.md` (comments, test data, acceptance criteria, retest steps) |
| **Owner** | [Name to be added] |
| **Status** | Designed and independently reviewed (94 findings, applied). Waiting for development. Nothing has been built or tested against the developers' build yet. |

## 1. What UAT asked for

| ID | Comment from UAT |
|---|---|
| UAT-01 | Add a **Vacancy pool**. The recruiter adds the vacancy link, the JD and other information there. |
| UAT-02 | Add a **Candidate pool** with only analyzed candidates, each with a status (decision) and a score. At any time the recruiter can open the score report and the resume **side by side**. |
| UAT-03 | **Activate the AI assistant** to support the recruiter's decision: ask a question to find the right candidate without searching by hand, and in each candidate report ask for more description and evaluation. |

Follow-up from the owner on UAT-03: when a recruiter writes "find the right candidate for X position", the assistant must **find the position in the Vacancy pool**, read its information, and **find candidates in the Candidate pool that are already analyzed**.

More comments will arrive. Each one is added to the UAT log as the next ID (UAT-04, 05, …) with a decision, acceptance criteria and retest steps.

## 2. Decisions already made

| Question | Answer |
|---|---|
| What are UAT testers using? | A working build by developers. The design prototype is not changed. |
| What does a pool show? | **Score and decision.** One row is one analyzed candidate in one vacancy (to confirm). |
| What is "status (decision)"? | Decision marks only: **New, Shortlist, Maybe, Not now**. Interview and offer stay in other tools. |
| Where can the assistant search? | The whole candidate pool, with a vacancy filter. Answers do not change the pool's filters. |
| Design direction | Easy to use, compact and simple. |

## 3. Design approach (UX and UI)

- **Two main sections, one rail.** A slim left rail with *Vacancies* and *Candidates*, and a top bar with the Ask bar. On phones, a bottom bar. One primary button per screen.
- **Compact lists.** 44 px rows, filter chips, one search box, sticky headers, remembered filters and scroll position. Details are collapsed until needed ("More details", "Show more").
- **Fewer clicks.** Decisions are set in one click in the row, with Undo instead of confirmation. Bulk decision for selected rows.
- **Side by side.** Score report on the left, resume on the right. Clicking a proof chip scrolls the resume to the passage. Draggable divider; a Report / Resume switch on narrow screens.
- **Privacy kept.** Names stay hidden. The resume opens anonymised; showing the original counts as a logged reveal.
- **The assistant where the work is.** One Ask bar for finding candidates; a composer inside each report for more description and evaluation. No floating chat bubble.

## 4. Work plan for the developers

Order matters: each step needs the one before it.

| Step | Work | Spec | Depends on |
|---|---|---|---|
| 1 | **UAT-01.** Navigation rail and top bar. `Vacancy` entity and Vacancy pool. Vacancy form: title, paste / Word file / link, must-have and nice-to-have chips, collapsed "More details". Vacancy page (Role and Resumes cards, Candidates and Report tabs). Archive, duplicate. | 5, 6.1, 6.7, 10 | none |
| 2 | **Analysis for a vacancy.** Resumes belong to a vacancy. Screening, bands, evidence, hidden names with reveal. | 6.1.4, 6.2 | step 1 |
| 3 | **UAT-02.** Decision marks. Candidate pool table, filters, search, paging, bulk decision. Candidate report with the anonymised resume viewer and evidence highlighting. | 6.2.4, 6.8, 6.9 | step 2 |
| 4 | **UAT-03.** Admin console minimum (provider, model, region, limits, switches). Redacted evidence package. Search over analyzed candidates. Assistant: resolve a position from the Vacancy pool, answer from analyzed candidates, ask more inside a report. Release gate tests. | 6.6.4 to 6.6.10 | step 3 and the blocking items below |
| 5 | Accessibility check, bias and red-team tests, retest by UAT. | 9, 6.6.4, UAT log | steps 1 to 4 |

Release 2 (later): edit requirements on the results screen, Focus on skills switch, report share links, shortlist export.

## 5. How the assistant finds the right candidate

1. The recruiter writes, for example, "Find the right candidate for Backend Engineer."
2. The assistant finds the vacancy by title in the **Vacancy pool** (spelling and Azerbaijani letters tolerated) and reads its title, location, requirements and job description. If several vacancies match it asks which one, Open first, and never picks silently between equals. If none matches, it offers close titles and a Create vacancy button. It never invents a vacancy. Archived vacancies are not used.
3. It answers with candidates from the **Candidate pool**, already analyzed for that vacancy, in the **same order as the pool** (a candidate marked Not now keeps their place and is labelled). The server selects and counts; the assistant writes only the wording. It does not re-read resumes or re-run the analysis.
4. Each result shows the band and score, a one-line reason against this vacancy's requirements, proof chips, the decision status and an **Open report** button.
5. Pool candidates not analyzed for this vacancy are only counted; a button to analyze them exists only if the owner approves it. Scores made against earlier requirements are marked **Out of date**, and the assistant says so. The assistant never starts an analysis on its own.
6. It never makes the decision. It does not reject anyone, change a score, or use age, gender, marital status or similar.

## 6. How UAT will check it

Each comment in the UAT log has numbered **acceptance criteria** (pass or fail) and **retest steps**. A short summary of what UAT will check:

- **Vacancy pool:** create a vacancy from pasted text, a Word file and a link; failure messages; archive and undo; "More details"; resumes belong to the vacancy.
- **Candidate pool:** only analyzed candidates appear; filters and scroll survive opening a report; one-click decision with Undo; bulk decision; the resume opens anonymised; showing the original is recorded; proof chips highlight the resume.
- **Assistant:** the right vacancy is found from the pool; candidates agree exactly with the pool; every claim has proof; protected-attribute questions are declined; pushback without new evidence does not change the answer; a hidden instruction in a vacancy text is ignored; an outage or spend cap does not break the results.

## 7. Blockers and open questions

| # | Item | Blocks |
|---|---|---|
| 1 | Final assistant name. "Elon" is a working name that may be read as a public figure; the assistant has an original, face-free avatar. | Assistant UAT with real candidates |
| 2 | Provider data terms (region, retention, no training on candidate data), consent and cross-border transfer rules, legal review. | Assistant UAT with real candidates |
| 3 | Who may read the assistant's audit log; retention period. | Assistant UAT with real candidates |
| 4 | Resume viewer: anonymised by default; may the original be downloaded? Which viewer technology? | Candidate report |
| 5 | Who can see which vacancies, candidates and decisions. A default is proposed in the spec (6.10): recruiters see all in the HR group and edit only their own vacancies; admins have no access to chats; compliance reads the audit. | All three; blocks real data |
| 6 | Confirm: a pool row is one analyzed candidate in one vacancy. | Candidate pool |
| 7 | May recruiters analyze pool candidates for another vacancy from the assistant's answer? | Assistant |
| 8 | Which vacancy "More details" fields are required? | Vacancy pool |
| 9 | A quick usability test of the Ask bar and the report composer with real recruiters. | Assistant |

Until items 1 to 5 above are closed, UAT of the assistant and the resume viewer uses **test data**, not real candidate data. The test data, accounts and a test provider that records every request are defined in `parallax-uat-log.md`.

## 8. Defaults chosen by the design team

These are proposals the owner can change.

- Not now keeps its place in the order and is labelled; no decision re-ranks anyone.
- A pseudonym is unique within a vacancy; lists that mix vacancies show it with the vacancy name.
- The resume viewer is anonymised by default; the original is a logged "Show original"; no download.
- Requirements are changed in the Role card in release 1; earlier scores show "Out of date" and are re-analyzed on request.
- A pool row keeps one current match per candidate and vacancy; a re-analysis keeps the decision.
- Admin caps are in USD, the day starts at 00:00 Asia/Baku, a cap of 0 blocks the assistant; Elon is on with every ability in the UAT build.

## 9. Risks

- **Release 1 grows.** Decision marks and the assistant moved from release 2 to release 1. Mitigation: the build order above, so the pools can be tested before the assistant is ready.
- **Assistant reliability.** A fluent assistant can sound more certain than the evidence. Mitigation: grounded answers with validated citations, a hold-or-update rule, and the swap and red-team tests as a release gate.
- **Privacy.** Candidate data reaches an admin-chosen provider. Mitigation: only a redacted evidence package is sent; names, photos and contact details never leave.
- **Stale scores.** Requirements can change after an analysis. Mitigation: scores show the requirements version they were made against, and the assistant says when they are out of date.

*Nothing in this plan has been tested against the developers' build. Statements marked as open or to confirm are not decisions.*
