# ── AWS Provider ──────────────────────────────────────────────────────────────
# Configures the AWS provider — region, credentials source, and default tags.
# Credentials come from OIDC (GitHub Actions) or ~/.aws/credentials (local).

provider "aws" {
  region = var.aws_region

  # Forces the regional S3 endpoint to avoid region signing mismatch
  # when the account's home region differs from the target region.
  endpoints {
    s3 = "https://s3.us-east-1.amazonaws.com"
  }

  # All resources created by Terraform automatically get these tags.
  # Makes cost tracking and resource identification easy in the AWS console.
  default_tags {
    tags = {
      Project     = "orderflow"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Looks up the AWS account ID at runtime — avoids hardcoding it anywhere.
data "aws_caller_identity" "current" {}
