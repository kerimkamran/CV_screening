# Real-candidate trial: what the MVP covers and what it does not

The Programme Plan says no live CV should enter the system before the R1a gates close. The programme owner chose to run an
internal trial with real candidates anyway. This note makes the gap explicit so the trial is run knowingly. It is a project
document, not legal advice; the DPO and Legal own the conclusions.

## Built into the product

- A per-vacancy **candidate notice**: the recruiter must attest that candidates were told AI assists screening (and how to ask for human review) before uploads are enabled. Suggested wording is shown in the app.
- **Human decision only**: scores and bands are labelled as recommendations; no automatic rejection; every shortlist/hold/reject is a named person with a written reason; rejection needs an evidence-reviewed attestation.
- **Explainability**: per-criterion status with verified quotes highlighted in the CV, plus the arithmetic behind the score.
- **Erasure**: a recruiter can erase a candidate's file, text and AI-extracted details; the decision record remains.
- **Audit**: tamper-evident trail of uploads, model use (provider and model per CV), decisions, exports, access changes.
- **Data minimisation in prompts**: the model is told not to infer or mention protected characteristics; only CV text is sent.

## Still required before or during the trial (owners in brackets)

1. DPIA and, for the plan's high-risk classification, the FRIA and EU AI Act documentation (DPO / Legal).
2. Data-processing agreements and transfer assessments with the chosen model provider(s) and Render (DPO / Legal / IT). Until then, do not use CVs of EU data subjects with a provider whose processing location is not covered.
3. Review against Azerbaijani personal-data law, including any localisation or registration duties (Legal).
4. Retention schedule and a purge routine; today deletion is manual per candidate (HR / DPO).
5. A process to answer a candidate's request for human review, access, or deletion within the statutory time (HR).
6. Accuracy evidence: the golden-set evaluation (EVAL-01, ~140 recruiter hours) has not been done, so there is no measured accuracy. Treat output as a sorting aid and read the CV.
7. Bias monitoring: no adverse-impact report exists. Do not use the score to filter candidates out without reading them.
8. MFA / SSO and a security review before more than a handful of users.

## Operating rules for the trial

- Use the ranking to decide _what to read first_, never _whom to skip_.
- Read the evidence for every rejection. Sort "Needs review" first: it holds knockout matches, suspicious CV text, and unreadable files.
- Keep the trial small and time-boxed, and record every issue found.
