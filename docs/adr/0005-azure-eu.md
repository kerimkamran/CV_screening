# 0005 — Azure, EU regions only (D5)

Status: Accepted — cloud confirmed by project owner 2026-10-02

Hosting is Azure in westeurope or northeurope. Residency is enforced three ways: a validation block on var.location, a static HCL scan in CI, and a scan of the resolved plan in the deploy pipeline (scripts/check-residency.mjs, infra/residency-allowlist.json). ZRS storage and in-region Postgres backups keep replicas inside the boundary. The model provider sits behind a swappable gateway (AISEC-11/ADMIN-06); the provider choice is open (decision 7).
