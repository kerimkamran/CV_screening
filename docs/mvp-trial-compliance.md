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

## Oracle import (Stage 3, planned, not switched on)

The exception described at the top of this note covers CVs that recruiters upload. It does not cover a pull of live applicants from Oracle Recruiting: that is a new flow, and it needs its own written extension from the programme owner and the DPO's sign-off. Nothing below is built yet. The design is in `docs/stage-3/development-plan.md` and ADR 0011 (proposed, not accepted). The 21 R1a gates are not listed anywhere in this repository, so this note cannot show them as closed.

### Built into the design

- **Same rules as an upload**: every imported CV goes through the same intake as an uploaded one, so the candidate notice, the frozen criteria, the duplicate check, the 500-CV limit and the audit all apply. The recruiter who clicked is the named person on each file, and their right to edit the vacancy is checked again for every file.
- **Read-only and on demand**: the product reads from Oracle only when a recruiter clicks Import or Refresh. There is no scheduled reading. Nothing is written back to Oracle, and an Oracle state never becomes a decision.
- **Least data**: active applications only (confirmed, not withdrawn, not disqualified). No names, e-mail addresses or profile rows are requested; identity comes from the CV text, as for uploads. Applications that are left out are kept as counts only.
- **Identifiers**: Oracle's numbers for applications and attachments are kept only while an import runs. Afterwards only keyed hashes remain (application, attachment and person). The Oracle vacancy number stays on the vacancy and in the audit trail.
- **Erasure holds**: erasing a candidate adds a hash to a suppression list, so a later Refresh does not bring the candidate back. File names are scrubbed on erase and on the retention purge.
- **Withdrawals**: every Refresh re-checks which imported applications have gone from Oracle and flags them. A reminder shows after 30 days without a Refresh. Retention must be on for a linked vacancy, and the clock starts at the earlier of the upload date and the Oracle application date.
- **Notice for people who applied through Oracle**: a required tick-box on the Activate form, with who ticked it, when, and the date the notice took effect. Applications from before that date are skipped.
- **One confirmation before AI is used**: the recruiter sees the Oracle title and Oracle's estimate and confirms once. The import pauses again only if the exact count is higher or does not fit in the vacancy. Both numbers go to the audit trail.
- **Simple, guarded set-up**: an administrator pastes the Oracle API address, user name and password into one form and clicks Activate. Only an `https` address ending in `.oraclecloud.com` that resolves to a public address is accepted. The password is stored encrypted and never shown, logged or audited. Nothing about Oracle is in the browser bundle.
- **Production only**: the form works only where the deploy switch `ORACLE_IMPORT_ENABLED` is set. A lower environment cannot connect to Oracle; tests use a fake Oracle.
- **Linking is audited, not approved**: any recruiter who can edit a vacancy may link it to an Oracle vacancy (owner decision; the security review rated the risk critical). Every lookup, link, unlink and import is on the audit trail with the Oracle vacancy number, lookups are rate-limited, and team-lead approval can be switched on by a setting.

### Still required before it is switched on (owners in brackets)

1. Accept ADR 0011. Until then no Oracle schema or product code (Phases 2 to 6 of the plan) merges. The Phase 0 probe script in item 10 is not held by this gate (programme owner).
2. OPEN: a written extension of the trial exception to the Oracle flow on Render Frankfurt, as a signed row in `docs/decisions.md` (programme owner).
3. OPEN: sign-off on section 6 of `docs/dpia-fria-draft.md`, including purpose, lawful basis and transfer assessment (DPO / Legal).
4. Written confirmation that the Oracle integration account is limited to the recruiting organisations in scope and cannot see confidential vacancies (Oracle team).
5. The notice on the Oracle career site: its wording and the date it took effect (DPO / HR).
6. The Oracle section of `docs/dpa-checklist.md` complete, including where Oracle is hosted and Azerbaijani law on moving this data (DPO / Legal).
7. Retention period decided and the purge turned on (item 4 of "Still required before or during the trial"). An import is refused while the purge is off (HR / DPO).
8. Decisions on applicants gone from Oracle (flag or erase), person-level suppression, how long the suppression list is kept, and whether an import needs an AI company that processes in the EU (DPO).
9. The antivirus decision recorded: no file is scanned today, on any path (DPO).
10. A probe on the Oracle test environment, one synthetic vacancy, counts only, after the DPO's consent (dev / Oracle team / DPO).
11. Network access from Render to Oracle confirmed. `render.yaml` sets no fixed outbound address, which matters if Oracle allows only listed caller addresses (Oracle team / programme owner).
12. Capacity measured on the current Render plans (gates G-11 memory and G-12 disk). On the current plan a 500-CV import may be refused for disk room; if G-12 fails the owner decides (dev / programme owner).
13. Only then: set the deploy switch on the production service, activate, and run the first import on one agreed vacancy as a pilot (programme owner).
