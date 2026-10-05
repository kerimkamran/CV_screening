variable "subscription_id" {
  description = "Azure subscription that hosts this environment."
  type        = string
}

variable "environment" {
  description = "dev | staging | prod. Environments are isolated: no shared data or credentials (PLAT-08)."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of dev, staging, prod."
  }
}

# PLAT-09 / D5: data residency. Candidate data may only live in these regions.
# scripts/check-residency.mjs enforces the same list in CI; keep infra/residency-allowlist.json in step.
variable "location" {
  description = "Azure region. Restricted to the approved EU regions."
  type        = string
  default     = "westeurope"

  validation {
    condition     = contains(["westeurope", "northeurope"], var.location)
    error_message = "location must be westeurope or northeurope (D5 / PLAT-09 data residency)."
  }
}

variable "name_prefix" {
  description = "Short prefix for resource names."
  type        = string
  default     = "cvscreen"

  validation {
    condition     = can(regex("^[a-z0-9]{3,12}$", var.name_prefix))
    error_message = "name_prefix must be 3-12 lowercase alphanumeric characters."
  }
}

variable "postgres_sku" {
  description = "Flexible server SKU. Burstable is enough for dev; use General Purpose in staging/prod."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_storage_mb" {
  type    = number
  default = 32768
}

variable "postgres_admin_login" {
  description = "Break-glass administrator login. The application never uses it (it connects as cv_app, migration 0003)."
  type        = string
  default     = "cvadmin"
}

variable "audit_retention_days" {
  description = "Immutable retention for audit archive blobs. Audit records outlive candidate data (§18.5: recommend 3 years)."
  type        = number
  default     = 1095
}

variable "tags" {
  type    = map(string)
  default = {}
}
