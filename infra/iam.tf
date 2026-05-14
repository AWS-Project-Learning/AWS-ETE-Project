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
# TASK ROLES — owned by the deploy pipeline, NOT Terraform
# ═══════════════════════════════════════════════════════════════════════════════
#
# Each service declares its own IAM permissions in deploy/{service}/service.yaml:
#
#   iam:
#     policies:
#       - sid: SSMRead
#         actions: ["ssm:GetParameter"]
#         resources: ["arn:aws:ssm:{{region}}:{{account_id}}:parameter/orderflow/{{env}}/bff/*"]
#       - sid: S3Write
#         actions: ["s3:PutObject"]
#         resources: ["arn:aws:s3:::orderflow-invoices-*"]
#
# deploy.py reads this block and calls:
#   iam create-role   → ecs-task-role-{service}  (if not exists)
#   iam put-role-policy → inline policy built from the policies list (always updated)
#
# Benefits:
#   - Dev team controls their own permissions — no infra PR needed
#   - Each service is least-privilege by default
#   - Adding a new service = write service.yaml, push, done
#   - Removing permissions = edit service.yaml, redeploy
