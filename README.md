# Azerconnect CV Screening

AI recruitment screening platform, built from **Programme Plan v1.0** (backlog, WSJF prioritisation,
architecture, compliance). The product turns a job description into recruiter-owned criteria,
evaluates each criterion against a CV with a citable evidence span, and keeps a complete audit trail.
It is decision support — a human owns every adverse decision.

## MVP for an internal trial (this branch)

Runnable end to end: admin-created recruiter accounts (generated password emailed with the sign-in link), an admin-managed
AI gateway (any number of AI companies, one key each, models chosen from each company's list, one active, encrypted server-side), vacancy + job description → AI-proposed criteria that the
recruiter edits and freezes → bulk CV upload (PDF/DOCX/TXT, deduplicated) → deterministic knockout → per-criterion assessment with
verbatim evidence → deterministic score with breakdown → named-human decisions with reasons → Excel export, erasure and audit.

- Deploy on Render: [`docs/deploy-render.md`](docs/deploy-render.md) (`render.yaml` Blueprint).
- What the trial does and does not cover (read before using real candidates): [`docs/mvp-trial-compliance.md`](docs/mvp-trial-compliance.md).
- Decisions and deviations from the plan: [`docs/adr/0010-mvp-internal-trial.md`](docs/adr/0010-mvp-internal-trial.md).

Local run: `docker compose up -d`, copy `.env.example` to `.env`, `npm ci`, `npm run db:migrate`, `npm run dev:api`, `npm run dev:web`.
Needs `pdftotext` (poppler-utils) on the machine for PDF CVs.

## Status: Sprint 0 + S1 foundation (R1a.0, in progress)

| Story                                                     | State                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| PLAT-02 Postgres + reversible migrations                  | Done — `db/migrations`, round-trip test in CI                                 |
| PLAT-03 CI (lint, typecheck, test, migrate, SBOM, guards) | Written — first run on GitHub pending                                         |
| PLAT-07 health / readiness probes                         | Done — `/healthz`, `/readyz`                                                  |
| PLAT-06 correlation IDs in structured logs                | Done at the API edge; spans to queue/worker land with ASYNC-01                |
| PLAT-05 config validation, no secrets in repo             | Config validated at boot; vault wiring pending                                |
| PLAT-09 residency guard                                   | Static HCL scan + plan scan + `validation` block                              |
| PLAT-01 IaC (Azure, EU)                                   | Written, **not yet validated with `terraform validate`**                      |
| AISEC-01 bundle key scan                                  | Scan + tests done; the AI gateway itself arrives in S3                        |
| EVAL-01 kickoff                                           | Protocol and templates in `docs/eval/` — **recruiter time not yet committed** |
| IAM-01/02, PLAT-04, PLAT-08                               | Not started (rest of S1/S2)                                                   |

There is no AI anywhere in this repo yet. That is deliberate (Plan §11, walking skeleton).

## Layout

```
apps/api         NestJS 11 on Fastify — health, config, DB, correlation IDs
apps/web         React 19 + Vite + Tailwind 4 shell (talks only to /api)
packages/shared  ULIDs, closed vocabularies, document state machine
db/migrations    NNNN_name.up.sql / .down.sql (every migration is reversible)
infra/terraform  Azure, westeurope/northeurope only
scripts          migration runner, round-trip test, bundle key scan, residency check
docs/adr         Architecture decisions (D1–D6 and implementation choices)
docs/eval        EVAL-01 golden-set protocol and templates
```

## Run it

```bash
npm ci
docker compose up -d                                   # Postgres 17 + pgvector, Valkey
cp .env.example .env   # set OIDC_ISSUER / OIDC_AUDIENCE / OIDC_JWKS_URI (the API refuses to start without them)
export MIGRATION_DATABASE_URL=postgres://cv:cv@localhost:5432/cv_screening
npm run db:migrate   # then set MIGRATION_DATABASE_URL for the API test suite too
psql "$MIGRATION_DATABASE_URL" -f db/dev/app-login.sql  # least-privilege role the API uses
npm run build -w packages/shared
npm run dev:api        # :3000   curl localhost:3000/readyz
npm run dev:web        # :5173
```

Quality gates (all run in CI): `npm run lint && npm run typecheck && npm test && npm run db:roundtrip && npm run build && npm run guard:bundle && npm run guard:residency && npm run guard:isolation`.

## Before Sprint 1 (Plan §1, §24.1)

Open decisions that are not engineering's to make are tracked in
[`docs/decisions.md`](docs/decisions.md): the vendor bake-off, EU AI Act scope opinion, team size,
~140 recruiter hours for the golden set, baseline measurement, model provider, document-AI vendor.
