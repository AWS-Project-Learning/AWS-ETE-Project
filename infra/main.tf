# ── Terraform Settings ────────────────────────────────────────────────────────
# Declares required Terraform version, provider plugins, and remote state backend.

terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — stores terraform.tfstate in S3 instead of your laptop.
  # This means the team shares one source of truth for what exists in AWS.
  # The DynamoDB table prevents two people from running apply at the same time.
  #
  # NOTE: This bucket must exist BEFORE running terraform init (bootstrap step).
  backend "s3" {
    bucket         = "orderflow-tfstate-109653023631"
    key            = "orderflow/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "orderflow-terraform-locks"
    encrypt        = true
  }
}

# ── Shared locals ─────────────────────────────────────────────────────────────
# Defined here so all .tf files in this module can reference them without
# duplication. Add new services here when the project grows.
locals {
  services = ["order-service", "invoice-service", "bff"]
}
