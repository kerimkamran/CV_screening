# Infrastructure (PLAT-01, PLAT-09)

Azure, EU regions only (`westeurope`, `northeurope`) — Programme Plan D5.

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # edit subscription_id
terraform init -backend-config=backend.hcl
terraform plan -out tfplan
terraform show -json tfplan > plan.json
node ../../scripts/check-residency.mjs --plan plan.json   # must pass before apply
terraform apply tfplan
```

## What this creates

| Resource | Plan story | Notes |
|---|---|---|
| Resource group, Log Analytics | PLAT-01, PLAT-10 | |
| Key Vault (RBAC, purge-protected) | PLAT-05, AISEC-01 | Provider key readable only by the AI gateway principal (added S3) |
| Storage (ZRS, versioned, immutability policy) | DOC-01, GOV-09 | `documents` and `audit-archive` containers; account keys disabled |
| PostgreSQL Flexible Server 17 | PLAT-02 | Backups in-region; `VECTOR` allow-listed for S13 |

## Not yet here (by sprint)

Container Apps / zero-downtime deploy (PLAT-04, S1), private networking (S2), Valkey (ASYNC-01, S4),
the AI gateway and its vault role assignment (AISEC-01, S3), OIDC app registration (IAM-01, S1).

## Residency guard

Two layers, both required:

1. `variable "location"` has a `validation` block — `terraform plan` refuses other regions.
2. `scripts/check-residency.mjs` — CI scans the HCL statically (no cloud credentials needed) and the
   deploy pipeline scans the resolved plan JSON. A literal region in any resource is a failure.

Changing the allowed regions is a governance decision (DPO + Legal): edit
`infra/residency-allowlist.json` **and** the `validation` list together.

> Status: written against azurerm `~> 4.0` but **not yet validated with `terraform validate`**
> (no Terraform binary was available in the authoring environment). CI runs `fmt`/`validate`.
