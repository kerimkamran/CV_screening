# Working agreement for this repo

Source of truth: `Azerconnect_AI_CV_Screener_Programme_Plan_v1.0` (Claude Project "CV_screening").
Story IDs (PLAT-02, KNOCK-03 …) appear in code comments and commit messages; keep that traceability.

## Hard sequencing rules (Plan §12.2) — do not reorder

1. PLAT-01/02/03 before anything else merges. 2. IAM-01/03 before any decision record is written.
2. AISEC-01 before the first provider call from **any** environment. 4. PARSE-06 before MATCH-03.
3. KNOCK-03 before MATCH-01. 6. EVAL-01/03/06 before any prompt/model reaches a shared environment.
4. No live candidate data before all 21 R1a gates close (D3).

## Invariants the code must not weaken

- Knockout is deterministic code with zero model calls; it never auto-rejects (KNOCK-01/05).
- `not_found` is never coerced to `not_met` (MATCH-04). A score never serialises without its breakdown (SCORE-03).
- No provider key, SDK or endpoint in the browser bundle (AISEC-01); `npm run guard:bundle` must pass.
- No resource outside westeurope/northeurope (PLAT-09). No production candidate data in lower environments.
- Audit and decision tables are append-only; the app role has no UPDATE/DELETE on them.

## Commands

`npm run build | typecheck | lint | test`, `npm run db:migrate | db:rollback | db:roundtrip`,
`npm run guard:bundle | guard:residency`. Local deps: `docker compose up -d`, then `db/dev/app-login.sql`.
