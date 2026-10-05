terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state in an EU-region storage account. Supply values with:
  #   terraform init -backend-config=backend.hcl      (see backend.hcl.example)
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    key_vault {
      # PLAT-05 / AISEC-06: a deleted vault must be recoverable, never silently purged.
      purge_soft_delete_on_destroy = false
    }
  }
  subscription_id = var.subscription_id
}
