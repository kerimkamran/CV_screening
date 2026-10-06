# 0010 — MVP for an internal trial (Render, built-in accounts, admin-managed AI keys)

Status: Accepted for the internal trial only. Supersedes parts of 0005 (hosting) and 0009 (authentication) **for the MVP**;
the OIDC path and the Azure IaC remain in the repository and are selected with `AUTH_MODE=oidc`.

## Decided by the programme owner

- AI models: an administrator chooses from a fixed list of AI companies (Google, OpenAI, Anthropic, Z.ai, Sakana Fugu, NVIDIA), adds ONE API key per company, chooses models from the company's own list, and decides which one model is active. Endpoints are fixed in the server (no administrator-typed addresses). Qwen was considered and dropped by the programme owner. The active model can be switched at any time and every assessment records the company and model that produced it.
- Data: real candidates, internal trial.
- Hosting: Render.
- Sign-in: an administrator creates recruiter accounts; the system emails credentials and a one-time invitation link, or (when email is unavailable) the admin copies that link and sends it. Opening the link lets the user choose their own password (single use, 72 h, only a SHA-256 hash stored, token kept in the URL fragment so it is not sent to the server on page load).

## What this changes, and why it is acceptable only for a trial

| Area            | Plan / earlier ADR                  | MVP                                                                                                                                       | Consequence                                                                                                                                                                   |
| --------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting         | Azure West/North Europe (0005)      | Render, Frankfurt (EU)                                                                                                                    | New processor (Render) to cover in the DPA/DPIA. Terraform stays unused and unvalidated.                                                                                      |
| Sign-in         | Corporate OIDC (0009)               | Built-in email + password, scrypt, 5-failure lockout, forced change at first login, 30-min idle sign-out, sessions end on password change | Credentials are emailed in clear text by design (temporary, single-use in effect). No MFA. Acceptable for a small trial; replace with OIDC before wider use.                  |
| Provider keys   | Vault, service principal (AISEC-01) | Stored AES-256-GCM encrypted in Postgres; master key `SETTINGS_ENCRYPTION_KEY` in the host's secret env                                   | Anyone with both the database and the Render environment can read the keys. Keys are never returned by any endpoint, logged or audited.                                       |
| Model data path | EU-resident provider endpoints      | Provider default endpoints (Google, OpenAI, Anthropic, Z.ai, Sakana, NVIDIA); OpenAI optional EU data-residency host                      | CV text leaves the EU for the active provider unless the provider account is configured for EU processing. Needs a transfer assessment and DPAs **before** real CVs are used. |
| Database role   | `cv_api` least privilege            | Created at boot if Render allows `CREATE ROLE`; otherwise the API runs as the owner (loud warning in the log)                             | Append-only audit and decision tables are still trigger-enforced either way.                                                                                                  |
| Files           | Immutable object storage            | Original CVs as `bytea` in Postgres                                                                                                       | Fine at trial volume; erasure is a real delete. Move to object storage if volume grows.                                                                                       |
| Queue           | BullMQ / Valkey (ASYNC-01)          | In-process worker over Postgres (`FOR UPDATE SKIP LOCKED`)                                                                                | Survives restarts; single instance only.                                                                                                                                      |
| PDF text        | Document-AI vendor                  | Poppler `pdftotext`                                                                                                                       | Scanned PDFs have no text (no OCR): flagged for manual reading.                                                                                                               |

## Invariants that still hold (and are tested)

Knockout is deterministic (no model call) and only routes to review; `not_found` is never turned into `not_met`;
a score never leaves the API without its breakdown; a quoted evidence span must exist verbatim in the stored CV text or it is discarded
(and a "met" claim with no verifiable evidence becomes "unclear"); CV text is delimited as data and obvious instruction-injection
routes the CV to review; decisions are append-only, human-only, with a mandatory reason, and a rejection needs an explicit
"I reviewed the evidence" attestation; every state change is written to the hash-chained audit trail without CV content.

## Not built (needed before this is more than a trial)

OCR, Oracle HCM integration, golden-set evaluation and accuracy reporting, bias/adverse-impact reporting, retention schedule with automatic purge,
SSO/MFA, per-vacancy recruiter assignment UI (recruiting leads grant access through the API), governance console, candidate-facing portal.
