# Bias review (design spec 6.6 and plan sections on fairness)

Status: first review, 6 October 2026, by the build team. It is a technical review of the product, not a
statistical fairness study and not legal advice. The DPO and Legal own the conclusions.

## What the product does to reduce bias risk

1. **Names hidden by default.** Candidates appear as "Candidate NN" in upload order. Revealing a name is an audited, per-person action; the revealed name is never fed back to the assistant.
2. **The score is a formula over job evidence only.** `computeScore` takes requirement text, class, weight and status. It has no field for name, age, gender, family, nationality or photo. The same evidence always gives the same score (test: `bias.integration.spec.ts`).
3. **Six different people with identical job evidence** (Azerbaijani, English, Russian names; female, male; age, marital, nationality, religion and pregnancy details in the text) get identical scores, bands and ranks through the whole pipeline (same test). Ties break by upload order, not by anything about the person.
4. **No reject band and no automatic rejection.** The bands are labelled as sorting aids; every decision is a named person with a written reason.
5. **The AI is told not to use protected characteristics** when it writes the summary, and the summary is shown with the evidence behind each skill. "Not found" never becomes "does not have".
6. **The assistant is built to refuse.** Protected-attribute questions, requests to reject or rank, and attempts to change its rules are answered by the server without calling a model. Passages that carry a protected signal (age, gender, family, nationality, religion, health, photo) are removed from what the model sees, together with names, e-mails, phones, links and years. Counterfactual tests (names, patronymics, years) show identical packages (`assistant-rules.spec.ts`).
7. **Edits to requirements are logged** with who and when, and can be reset in one click, so nobody can quietly tune the ranking toward a favourite.

## Gaps (honest list)

1. **The scoring step still sends the full CV text, including the name, to the AI provider.** Only the assistant gets a redacted package. The model could in principle react to a name or other signals when it judges requirements. The instructions tell it not to, but this is not enforced by code and has not been measured.
   - Why it is not changed in this release: the assessments must quote the CV literally and the quote is checked against the original text. Sending a redacted copy would break the quote check and the highlighting unless the check is moved to the redacted text and mapped back. That is a design change with its own tests.
   - Recommended next step: redact name, e-mail, phone, photo references and the lines the protected-signal detector in `assistant-rules.ts` flags, before scoring; verify quotes against the redacted text; keep the original for the recruiter's view. Then re-run the evaluation below.
2. **No measurement on real model behaviour.** The tests prove our code is neutral. They do not prove the model is. A labelled evaluation (plan EVAL-01) with paired CVs, identical except for name, gender signals, age signals and nationality, must be run for each model before relying on its output. Acceptable difference to agree up front (suggestion: no band changes in more than 2 percent of pairs, and no systematic direction).
3. **No adverse-impact monitoring.** The system holds no demographic data, by design, so the four-fifths rule cannot be computed from it. Options: HR runs a periodic sample review with a separate, consented data set; or an aggregated, opt-in self-declaration kept apart from screening. Needs a decision from HR and the DPO.
4. **Name-based heuristics.** The detector of protected signals works on words and phrases in English, Azerbaijani and Russian. It will miss signals written in other ways (for example a graduation year used as an age proxy is masked, but "digital native" is not). Expect misses; it reduces risk, it does not remove it.
5. **Career gaps and employer prestige** are not modelled, but the AI may treat them as evidence when a requirement mentions "experience". Review a sample of "Not found" results by hand.
6. **Language.** Azerbaijani and Russian CVs depend on the chosen model's quality in those languages. Compare band distributions by CV language during the trial.
7. **Excel export** still contains real names and file names. It is meant for the recruiter's own use; do not share it beyond the hiring group.

## How to use the product fairly during the trial

- Read the evidence for every "Not now"; never reject on the band alone.
- Use the ranking to decide what to read first, not whom to skip.
- Keep names hidden until the shortlist stage; use "Focus on skills" to hide file names and e-mails too.
- Record any case where a result looks wrong or unfair; these feed the evaluation.

## Tests that keep this honest

- `apps/api/src/pipeline/bias.integration.spec.ts`: score formula purity; six-person swap; tie-break by upload order; protected details do not change which requirements are met.
- `apps/api/src/assistant/assistant-rules.spec.ts`: package counterfactuals (names, patronymic, year), protected signals removed, red-team questions, pushback.
- `apps/api/src/assistant/assistant.integration.spec.ts`: end-to-end, names never reach the model, identical packages for swapped names and years, assistant cannot change a score, band, rank or decision.
