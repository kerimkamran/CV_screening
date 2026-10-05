# EVAL-01 kickoff — golden evaluation set

**This is the schedule-critical path item (Plan §9.4, §21 risk 1).** It needs ~140 senior-recruiter
hours that engineering cannot substitute. Start in Sprint 0; track burn-down weekly.

## Target (Plan §16.1)

25–30 real vacancies (both profiles) · 300–500 CVs · ~40% AZ, ~30% RU, ~20% EN, ~10% TR ·
text PDF, scanned PDF, DOCX, and at least one genuinely awful CV per vacancy · entry→specialist seniority ·
deliberate ambiguous, negative and near-miss cases.

## Labelling protocol

1. Two senior recruiters label each CV **independently and blind**, per requirement (six-state status)
   and overall (shortlist yes/no, rank within vacancy). Use `labelling-sheet.csv`.
2. A third recruiter adjudicates disagreements. Record who adjudicated and why.
3. Compute and **publish inter-rater agreement** (Cohen's κ per language × profile). It is the ceiling
   for every AI accuracy claim: if two recruiters agree on 6–7 of 10, an AI at 8/10 is near the limit.
4. Do **not** target 9/10 or 10/10 — beyond ~8.5 the metric measures conformity to one recruiter.

## Data handling

The set is a long-lived personal-data asset. Use real CVs only under documented consent
(`consent-record.csv`) or pseudonymise them. Store outside the repo; the repo holds only schemas and
fixtures. It has its own retention and access rules (Plan §18.5). **Never commit CVs here.**

## Files

- `vacancy-intake.csv` — one row per vacancy (profile, language, seniority, requirements source)
- `labelling-sheet.csv` — one row per (CV, requirement) per labeller
- `consent-record.csv` — consent / pseudonymisation evidence per CV
- `recruiter-hours.csv` — hours committed vs spent (the burn-down)
