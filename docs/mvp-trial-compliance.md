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
- **Data minimisation in prompts**: name, e-mail, phone, links and labelled personal fields (date of birth, age, gender, family status, nationality, religion, health, address) are replaced by placeholders before the model sees the CV; the model is also told not to infer protected characteristics. Free text and names inside sentences are not caught (see `bias-review.md`).
- **Retention purge and legal hold** (Admin > Data retention): off until an administrator turns it on and sets the period (30 to 3650 days); erases files and everything derived from them on schedule, skips vacancies under legal hold, one audit entry per file and one deletion certificate per run.
- **Two-step sign-in** (authenticator app, optional per account) with recovery codes and an administrator reset; secrets stored encrypted.
- **Fairness tooling** (Admin > Monitoring): paired-CV test and outcome monitoring by CV language, format and length.
- **Azerbaijani interface** for recruiters and report viewers (the Admin console is in English).

## Still required before or during the trial (owners in brackets)

Drafts to start from are in `docs/dpia-fria-draft.md` and `docs/dpa-checklist.md`. They are drafts written by the build team from what the product does; they are not signed off and not legal advice.

1. DPIA and, for the plan's high-risk classification, the FRIA and EU AI Act documentation: complete, review and sign the drafts (DPO / Legal).
2. Data-processing agreements and transfer assessments with the chosen model provider(s) and Render (DPO / Legal / IT): use the checklist, one per company. Until then, do not use CVs of EU data subjects with a provider whose processing location is not covered. Google, OpenAI and Anthropic process in the US by default (OpenAI offers an EU-residency project option); Z.ai is a China-based provider; Sakana Fugu orchestrates several underlying models, so more than one party may handle the text; NVIDIA's free API catalog is for development only. Enable and activate only the companies whose DPA and transfer assessment are complete.
3. Review against Azerbaijani personal-data law, including any localisation or registration duties (Legal).
4. Decide the retention period and turn the purge on (HR / DPO). The routine exists; the period is a policy choice and is not set.
5. A process to answer a candidate's request for human review, access, or deletion within the statutory time (HR). The product can erase a candidate's data; the intake and the clock are an HR process.
6. Accuracy evidence: the golden-set evaluation (EVAL-01, ~140 recruiter hours) has not been done, so there is no measured accuracy. Treat output as a sorting aid and read the CV.
7. Run the paired-CV test against the active model and record the result; HR to decide whether a consented self-declaration is wanted for a real adverse-impact test.
8. MFA is available and optional; decide whether to make it mandatory for administrators and recruiters. SSO and an independent security review before more than a handful of users. Screen-reader and user testing of the interface.

## Operating rules for the trial

- Use the ranking to decide _what to read first_, never _whom to skip_.
- Read the evidence for every rejection. Sort "Needs review" first: it holds knockout matches, suspicious CV text, and unreadable files.
- Keep the trial small and time-boxed, and record every issue found.
