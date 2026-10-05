locals {
  suffix = "${var.name_prefix}-${var.environment}"
  # Storage account names: 3-24 chars, lowercase alphanumeric, globally unique.
  storage_name = substr("${var.name_prefix}${var.environment}${random_string.unique.result}", 0, 24)
  tags = merge(var.tags, {
    system      = "cv-screening"
    environment = var.environment
    # D3: this system is an Annex III high-risk AI system. Tag so inventory and audit can find it.
    ai-risk-class = "high-risk-annex-iii"
  })
}

resource "random_string" "unique" {
  length  = 6
  upper   = false
  special = false
}

data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.suffix}"
  location = var.location
  tags     = local.tags
}

# PLAT-10 / PLAT-06: central log + metric sink.
resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.suffix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 90
  tags                = local.tags
}

# PLAT-05 / AISEC-01: the secrets vault. RBAC-only (no access policies) so access is auditable
# through IAM. The provider API key is readable ONLY by the AI gateway's service principal;
# that role assignment is added with the gateway (S3), not here.
resource "azurerm_key_vault" "main" {
  name                          = substr("kv-${local.suffix}-${random_string.unique.result}", 0, 24)
  location                      = azurerm_resource_group.main.location
  resource_group_name           = azurerm_resource_group.main.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  public_network_access_enabled = true # tightened to private endpoints with the network layer (S2+)
  tags                          = local.tags
}

# DOC-01 / GOV-09: document and audit-archive storage.
#  - versioning + soft delete so overwritten/deleted blobs are recoverable
#  - immutability policy gives write-once-read-many for the audit archive (object-lock equivalent)
#  - ZRS keeps replicas inside the region (no geo-replication across the residency boundary)
resource "azurerm_storage_account" "main" {
  name                            = local.storage_name
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  account_tier                    = "Standard"
  account_replication_type        = "ZRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  https_traffic_only_enabled      = true
  shared_access_key_enabled       = false # Entra ID / RBAC only; no account keys to leak
  tags                            = local.tags

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
  }

  # Version-level WORM. Starts Unlocked so it can be tuned during R1a; GOV-09 locks it before R1b.
  immutability_policy {
    allow_protected_append_writes = false
    state                         = "Unlocked"
    period_since_creation_in_days = var.audit_retention_days
  }
}

resource "azurerm_storage_container" "documents" {
  name                  = "documents"
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "audit_archive" {
  name                  = "audit-archive"
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}

resource "random_password" "postgres_admin" {
  length  = 32
  special = false
}

# PLAT-02: managed Postgres. Version 17; pgvector is allow-listed and created by a migration
# when retrieval lands (S13), so no infrastructure change is needed then.
resource "azurerm_postgresql_flexible_server" "main" {
  name                          = "psql-${local.suffix}-${random_string.unique.result}"
  location                      = azurerm_resource_group.main.location
  resource_group_name           = azurerm_resource_group.main.name
  version                       = "17"
  sku_name                      = var.postgres_sku
  storage_mb                    = var.postgres_storage_mb
  administrator_login           = var.postgres_admin_login
  administrator_password        = random_password.postgres_admin.result
  backup_retention_days         = 14
  geo_redundant_backup_enabled  = false # backups stay in-region (PLAT-09)
  public_network_access_enabled = true  # tightened to VNet integration with the network layer (S2+)
  tags                          = local.tags

  lifecycle {
    ignore_changes = [zone]
  }
}

resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "VECTOR,PGCRYPTO"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = "cv_screening"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Admin credential lives in the vault, not in outputs or CI variables.
resource "azurerm_key_vault_secret" "postgres_admin" {
  name         = "postgres-admin-password"
  value        = random_password.postgres_admin.result
  key_vault_id = azurerm_key_vault.main.id
  content_type = "text/plain"

  depends_on = [azurerm_role_assignment.deployer_secrets]
}

# The identity running Terraform needs write access to seed secrets.
resource "azurerm_role_assignment" "deployer_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_monitor_diagnostic_setting" "key_vault" {
  name                       = "to-log-analytics"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category_group = "audit"
  }
}
