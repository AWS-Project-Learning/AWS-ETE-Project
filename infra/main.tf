# ── Terraform Settings ────────────────────────────────────────────────────────
# This block tells Terraform:
#   - Which version of Terraform is required
#   - Which provider plugins to download (aws = the AWS SDK for Terraform)

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
  # NOTE: This bucket must exist BEFORE running terraform init.
  #       We will create it manually once (bootstrap step) — documented below.
  backend "s3" {
    bucket         = "orderflow-tfstate-109653023631"
    key            = "orderflow/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "orderflow-terraform-locks"
    encrypt        = true
  }
}

# ── AWS Provider ──────────────────────────────────────────────────────────────
# Tells the AWS provider which region to create resources in.
# The credentials themselves come from environment variables:
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# (set in GitHub Actions secrets, or ~/.aws/credentials locally)

# Looks up the AWS account ID of whoever is running Terraform.
# Used in outputs and ARN construction — avoids hardcoding the account ID.
data "aws_caller_identity" "current" {}

provider "aws" {
  region = var.aws_region

  # Every resource created by Terraform will automatically get these tags.
  # This makes cost tracking and resource identification easy in the AWS console.
  default_tags {
    tags = {
      Project     = "orderflow"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
