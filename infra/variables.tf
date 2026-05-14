# ── Input Variables ───────────────────────────────────────────────────────────
# These are the "parameters" of your Terraform configuration.
# Actual values come from terraform.tfvars or -var flags at runtime.

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (dev | sit)"
  type        = string

  validation {
    condition     = contains(["dev", "sit"], var.environment)
    error_message = "environment must be 'dev' or 'sit'."
  }
}

variable "project" {
  description = "Project name — used in resource names and tags"
  type        = string
  default     = "orderflow"
}

variable "db_password" {
  description = "Master password for the RDS MySQL instance — passed via GitHub secret TF_VAR_db_password"
  type        = string
  sensitive   = true # Terraform will never print this value in plan/apply output
}

variable "db_snapshot_identifier" {
  description = <<-EOT
    RDS snapshot to restore from during startup.
    Set by the infra-lifecycle workflow when recovering from a previous teardown.
    null (default) = create a fresh empty database.
    Pass via -var="db_snapshot_identifier=<id>" — never commit a real value here.
  EOT
  type        = string
  default     = null
}
