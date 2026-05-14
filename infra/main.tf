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

# ── Platform Service Registry ─────────────────────────────────────────────────
# Terraform is the PLATFORM layer. It knows the minimum needed to wire up
# infrastructure — not how services behave, what they talk to, or their config.
#
# Everything about a service (port, cpu, memory, env vars, secrets, IAM policies,
# health check) lives in deploy/{service}/service.yaml — owned by the dev team.
# The deploy pipeline reads service.yaml and creates all per-service AWS resources.
#
# Terraform only needs to know three things:
#   ecr_services  — which ECR repos to create (one per service)
#   db_services   — which services have a database (Terraform creates the SSM secret
#                   because it knows the RDS endpoint + password)
#   alb_routing   — which services get ALB rules (port needed for target group creation)
#
# Adding a new INTERNAL service:
#   → Add service name to ecr_services
#   → Add db_services entry if it has a database
#   → Write deploy/{service}/service.yaml — zero infra PR needed
#
# Adding a new PUBLIC (ALB) service:
#   → Also add to alb_routing with port + path pattern

locals {
  # ── ECR repos ─────────────────────────────────────────────────────────────
  # One private Docker registry per service. Image tags track versions.
  # Add a new service name here when onboarding it.
  ecr_services = toset(["bff", "order-service", "invoice-service"])

  # ── Database-backed services ───────────────────────────────────────────────
  # Terraform creates the SSM SecureString db-url param for these services
  # because only Terraform knows the RDS endpoint and master password.
  # The deploy pipeline references the SSM path via service.yaml env_secrets.
  db_services = toset(["order-service", "invoice-service"])

  # ── ALB routing ───────────────────────────────────────────────────────────
  # Only public-facing services appear here. Internal services are invisible
  # to the ALB — they register via Cloud Map DNS in the deploy pipeline.
  # port = must match container.port in deploy/{service}/service.yaml
  alb_routing = {
    "bff" = {
      port          = 8000
      path_patterns = ["/api/*"]
      priority      = 10
    }
  }
}
