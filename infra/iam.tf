# ── IAM Roles for ECS ─────────────────────────────────────────────────────────
#
# Two types of roles:
#
# 1. Execution Role (shared) — used by ECS BEFORE container starts
#    Pulls Docker image from ECR, fetches secrets from Parameter Store,
#    creates log streams in CloudWatch. Your code never uses this role.
#
# 2. Task Role (per service) — used by YOUR CODE while container runs
#    Grants the running app permission to call AWS APIs (S3, SQS etc).
#    Currently minimal — extended per service as features are added.

# ── Trust Policy — allows ECS to assume these roles ───────────────────────────
# Both role types need this trust policy.
# It tells AWS: "ECS tasks are allowed to assume this role."
data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ═══════════════════════════════════════════════════════════════════════════════
# EXECUTION ROLE — shared by all services
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "ecs_execution" {
  name               = "ecs-task-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json

  tags = {
    Name = "ecs-task-execution-role"
  }
}

# AWS provides a managed policy with all permissions needed for ECS startup:
# ECR pull, CloudWatch log creation, SSM basic read.
resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Additional policy — allows ECS to read our specific Parameter Store paths
# at container startup to inject secrets as environment variables.
# The managed policy above only covers basic SSM — we need explicit path access.
resource "aws_iam_policy" "ecs_execution_ssm" {
  name        = "ecs-execution-ssm-${var.environment}"
  description = "Allow ECS execution role to read Parameter Store secrets for ${var.environment}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        # Scoped to only our project's parameters — not the entire account
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/orderflow/${var.environment}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        # Needed if any Parameter Store values are encrypted with KMS
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_ssm" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.ecs_execution_ssm.arn
}

# ═══════════════════════════════════════════════════════════════════════════════
# TASK ROLES — one per service
# ═══════════════════════════════════════════════════════════════════════════════

locals {
  services = ["order-service", "invoice-service", "bff"]
}

resource "aws_iam_role" "ecs_task" {
  for_each = toset(local.services)

  name               = "ecs-task-role-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json

  tags = {
    Name    = "ecs-task-role-${each.key}"
    Service = each.key
  }
}

# ── order-service task policy ──────────────────────────────────────────────────
# Currently no AWS API calls from application code.
# MySQL and Redis are accessed over TCP (Security Groups handle this).
# Extend this when order-service needs to call AWS APIs directly.
resource "aws_iam_role_policy" "task_order_service" {
  name = "order-service-policy-${var.environment}"
  role = aws_iam_role.ecs_task["order-service"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/orderflow/${var.environment}/order-service/*"
      }
    ]
  })
}

# ── invoice-service task policy ───────────────────────────────────────────────
# Placeholder for S3 access when invoice PDF storage is implemented.
resource "aws_iam_role_policy" "task_invoice_service" {
  name = "invoice-service-policy-${var.environment}"
  role = aws_iam_role.ecs_task["invoice-service"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/orderflow/${var.environment}/invoice-service/*"
      }
      # Future: add s3:PutObject for invoice PDF uploads
      # {
      #   Effect   = "Allow"
      #   Action   = ["s3:PutObject", "s3:GetObject"]
      #   Resource = "arn:aws:s3:::orderflow-invoices-${var.environment}/*"
      # }
    ]
  })
}

# ── bff task policy ───────────────────────────────────────────────────────────
# BFF only calls order-service and invoice-service over HTTP (internal DNS).
# No direct AWS API calls needed currently.
resource "aws_iam_role_policy" "task_bff" {
  name = "bff-policy-${var.environment}"
  role = aws_iam_role.ecs_task["bff"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/orderflow/${var.environment}/bff/*"
      }
    ]
  })
}
