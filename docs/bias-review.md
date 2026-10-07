# Bias review (design spec 6.6 and plan sections on fairness)

Status: second review, 7 October 2026 (first review 6 October), by the build team. It is a technical review of the product, not a
statistical fairness study and not legal advice. The DPO and Legal own the conclusions.

## What the product does to reduce bias risk

1. **Names hidden by default.** Candidates appear as "Candidate NN" in upload order. Revealing a name is an audited, per-person action; the revealed name is never fed back to the assistant.
2. **The score is a formula over job evidence only.** `computeScore` takes requirement text, class, weight and status. It has no field for name, age, gender, family, nationality or photo. The same evidence always gives the same score (test: `bias.integration.spec.ts`).
3. **Six different people with identical job evidence** (Azerbaijani, English, Russian names; female, male; age, marital, nationality, religion and pregnancy details in the text) get identical scores, bands and ranks through the whole pipeline (same test). Ties break by upload order, not by anything about the person.
4. **No reject band and no automatic rejection.** The bands are labelled as sorting aids; every decision is a named person with a written reason.
5. **The AI is told not to use protected characteristics** when it writes the summary, and the summary is shown with the evidence behind each skill. "Not found" never becomes "does not have".
6. **The assistant is built to refuse.** Protected-attribute questions, requests to reject or rank, and attempts to change its rules are answered by the server without calling a model. Passages that carry a protected signal (age, gender, family, nationality, religion, health, photo) are removed from what the model sees, together with names, e-mails, phones, links and years. Counterfactual tests (names, patronymics, years) show identical packages (`assistant-rules.spec.ts`).
7. **Edits to requirements are logged** with who and when, and can be reset in one click, so nobody can quietly tune the ranking toward a favourite.

## What changed on 7 October 2026

- **Scoring now sees a masked CV.** `pipeline/scoring-redaction.ts` replaces e-mail, phone, links, the candidate's own name and the value of labelled personal fields (date of birth, age, gender, marital or family status, nationality, religion, health, photo, address; English, Azerbaijani, Russian) with placeholders before the model is called. The name and e-mail shown to recruiters are read by code, not by the model. Quotations are located in the masked text and mapped back to the original; a quote that touches a masked place is dropped as evidence. Tests: `scoring-redaction.spec.ts`, `pipeline.integration.spec.ts`.
- **Paired-CV test built in** (Admin > Monitoring). Synthetic CVs that differ only in a name, a personal detail or a career-break line go through the real scoring path, with identity masking on (as the tool works) and off (for comparison). The result shows how many pairs moved by more than 5 points plus the model's own noise. Code: `monitoring/paired.ts`, `eval.service.ts`.
- **Outcome monitoring** (Admin > Monitoring, also for Governance). Aggregated by CV language, file format and length, with the four-fifths rule, minimum 20 scored files overall and groups under 5 files suppressed. No protected attribute is collected or inferred.
- **Excel export is pseudonymised** like the screen: "Candidate NN" and no file names unless the name was revealed by that recruiter or the person is shortlisted.

## Gaps (honest list)

1. **Real-model results do not exist yet.** The paired test runs only when an administrator starts it against the active model. Run it after the first deploy and for every model change; agree the acceptable difference up front (suggestion: no band changes in more than 2 percent of pairs and no systematic direction). A "Review" verdict is a prompt to look, not a finding.
2. **Names written inside sentences are not detected.** Masking covers the name found at the top of the CV or in a "Name:" line, wherever the full name repeats, and labelled personal fields. A name that appears only inside a sentence ("Reference from Elena Petrova"), a person's name in a referee list under another label, and free-text signals such as "digital native" or "recently married" remain visible to the model. The paired test includes a free-text maternity line so the residual effect is measured, not assumed.
3. **Adverse impact by protected group cannot be computed.** The system holds no demographic data, by design. The monitoring by language, format and length is a proxy for process problems, not a four-fifths test on sex, age or ethnicity. If HR wants the real test, it needs a separate, consented, aggregated self-declaration kept apart from screening. That is a decision for HR and the DPO.
4. **Detector limits.** Pattern-based, English/Azerbaijani/Russian. It will miss signals written in other ways. It reduces risk; it does not remove it.
5. **Career gaps and employer prestige** are not modelled, but the AI may treat them as evidence when a requirement mentions "experience". Review a sample of "Not found" results by hand.
6. **Language quality.** Azerbaijani and Russian CVs depend on the chosen model. Use the by-language table in Monitoring during the trial.
7. **Scanned CVs** without a text layer go to manual review; they are not scored, so they do not enter the statistics.

## How to use the product fairly during the trial

- Read the evidence for every "Not now"; never reject on the band alone.
- Use the ranking to decide what to read first, not whom to skip.
- Keep names hidden until the shortlist stage; use "Focus on skills" to hide file names and e-mails too.
- Record any case where a result looks wrong or unfair; these feed the evaluation.

## Tests that keep this honest

- `apps/api/src/pipeline/bias.integration.spec.ts`: score formula purity; six-person swap; tie-break by upload order; protected details do not change which requirements are met.
- `apps/api/src/assistant/assistant-rules.spec.ts`: package counterfactuals (names, patronymic, year), protected signals removed, red-team questions, pushback.
- `apps/api/src/assistant/assistant.integration.spec.ts`: end-to-end, names never reach the model, identical packages for swapped names and years, assistant cannot change a score, band, rank or decision.
- `apps/api/src/pipeline/scoring-redaction.spec.ts`: identity and personal fields masked, professional text untouched, quotes map back, quotes touching masked text refused.
- `apps/api/src/monitoring/fairness.spec.ts`, `eval.integration.spec.ts`: four-fifths and suppression rules; the paired test finds a fair model consistent and catches a model whose score moves with a name.
