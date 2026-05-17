# ── Email Receipt Service ─────────────────────────────────────────────────────
#
# Architecture:
#   order-service ──publish──▶ SNS topic ──notify──▶ Lambda ──▶ SES ──📧──▶ customer
#
# Why this shape:
#   - SNS in the middle decouples order-service from email logic. Adding SMS,
#     audit log, or analytics later means subscribing a new Lambda — no change
#     to order-service.
#   - Lambda only runs when there's an order. $0 idle cost.
#   - All three services have generous free tiers covering this workload:
#       SNS    : 1M publishes + 100K Lambda deliveries / month forever free
#       Lambda : 1M invocations + 400K GB-seconds  / month forever free
#       SES    : 62K emails (from Lambda)          / month forever free
#
# Manual prerequisite (one-time, ~30 sec):
#   After `terraform apply` finishes, AWS will email a verification link to
#   the address in `var.email_sender`. The owner of that mailbox MUST click
#   the link before SES will accept any SendEmail call. Until verified,
#   send_email returns "Email address is not verified" and the receipt is
#   silently dropped (the order itself still succeeds).
#
#   While SES is in "sandbox" mode (default for new accounts), you can ONLY
#   email VERIFIED recipients. To email anyone, request "production access"
#   in the SES console — usually approved within a day.
# ─────────────────────────────────────────────────────────────────────────────

# ── Variables ─────────────────────────────────────────────────────────────────

variable "email_sender" {
  description = <<-EOT
    Verified SES sender address. Order receipts are sent FROM this email.
    AWS sends a confirmation link here on first apply — must be clicked before
    any email can be sent.
  EOT
  type        = string
  default     = "kannanks.smart@gmail.com"
}


# ── SES — verify the sender identity ─────────────────────────────────────────
# Creates a verification request. The actual click-to-confirm step happens
# outside Terraform (in the user's inbox).
resource "aws_ses_email_identity" "sender" {
  email = var.email_sender
}


# ── SNS — order-created topic ─────────────────────────────────────────────────
# order-service publishes here after an order is committed to MySQL.
# Lambda is the only subscriber today; add more by creating extra
# `aws_sns_topic_subscription` resources.
resource "aws_sns_topic" "order_created" {
  name = "${var.project}-${var.environment}-order-created"

  tags = {
    Name = "${var.project}-order-created-${var.environment}"
  }
}

# Expose the topic ARN to order-service via SSM. Read by deploy.py and
# injected into the container as the ORDER_CREATED_TOPIC_ARN env var
# (see deploy/order-service/values-dev.yaml env_secrets).
resource "aws_ssm_parameter" "order_created_topic_arn" {
  name  = "/orderflow/${var.environment}/infra/order-created-topic-arn"
  type  = "String"
  value = aws_sns_topic.order_created.arn

  tags = { Name = "infra-order-created-topic-arn-${var.environment}" }
}

# ── SNS — order-status-updated topic ──────────────────────────────────────────
# Published whenever a status changes (Pending → Processing → Shipped → ...).
# Kept on its OWN topic so future consumers can subscribe to "shipping events"
# without also receiving every "order created" event.
#
# The Lambda subscribes to BOTH topics and uses the SNS Subject (which carries
# the channel name like "order.status_updated") to decide which template to
# render — and to drop noisy intermediate statuses (Pending, Processing).
resource "aws_sns_topic" "order_status_updated" {
  name = "${var.project}-${var.environment}-order-status-updated"

  tags = {
    Name = "${var.project}-order-status-updated-${var.environment}"
  }
}

resource "aws_ssm_parameter" "order_status_updated_topic_arn" {
  name  = "/orderflow/${var.environment}/infra/order-status-updated-topic-arn"
  type  = "String"
  value = aws_sns_topic.order_status_updated.arn

  tags = { Name = "infra-order-status-updated-topic-arn-${var.environment}" }
}


# ── Lambda — email-receipt function ───────────────────────────────────────────
# Code lives at backend-services/email-receipt-lambda/.
# Terraform zips it at apply time using the archive_file data source — no
# separate build pipeline needed. The output zip is gitignored.
data "archive_file" "email_receipt_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../backend-services/email-receipt-lambda"
  output_path = "${path.module}/email-receipt-lambda.zip"
}

# IAM role assumed by the Lambda at runtime.
resource "aws_iam_role" "lambda_email" {
  name = "lambda-email-receipt-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Name = "lambda-email-receipt-${var.environment}" }
}

# CloudWatch Logs — required for any Lambda to write logs.
resource "aws_iam_role_policy_attachment" "lambda_email_logs" {
  role       = aws_iam_role.lambda_email.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# SES SendEmail — resource is "*" because SES evaluates IAM against BOTH the
# sender identity AND the recipient identity. Scoping to only the sender ARN
# causes AccessDenied whenever the recipient hasn't been explicitly granted
# in the policy. The actual sending restriction (sandbox: verified recipients
# only) is enforced by SES independently of IAM — this IAM change is safe.
resource "aws_iam_role_policy" "lambda_email_ses" {
  name = "ses-send-email"
  role = aws_iam_role.lambda_email.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*"
    }]
  })
}

resource "aws_lambda_function" "email_receipt" {
  function_name = "${var.project}-email-receipt-${var.environment}"
  role          = aws_iam_role.lambda_email.arn

  handler = "handler.handler"
  runtime = "python3.12"

  filename         = data.archive_file.email_receipt_zip.output_path
  source_code_hash = data.archive_file.email_receipt_zip.output_base64sha256

  # SES typically responds in well under 1s; 10s gives ample headroom for
  # cold start + DNS + retry. memory_size = 128 MB is the smallest available
  # and plenty for this I/O-bound function.
  timeout     = 10
  memory_size = 128

  environment {
    variables = {
      SENDER_EMAIL = var.email_sender
      LOG_LEVEL    = "INFO"
    }
  }

  tags = { Name = "${var.project}-email-receipt-${var.environment}" }
}


# ── Wire SNS topics → Lambda ──────────────────────────────────────────────────
# For each topic we need TWO resources:
#   1. Subscription — tells SNS to push messages to this Lambda
#   2. Permission   — allows SNS to invoke the Lambda function
#
# Each lambda_permission must have a unique statement_id per topic (otherwise
# Terraform overwrites the policy statement instead of appending).

# ── order-created → Lambda ────────────────────────────────────────────────────
resource "aws_sns_topic_subscription" "email_receipt_order_created" {
  topic_arn = aws_sns_topic.order_created.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.email_receipt.arn
}

resource "aws_lambda_permission" "allow_sns_order_created" {
  statement_id  = "AllowExecutionFromSNSOrderCreated"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.email_receipt.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.order_created.arn
}

# ── order-status-updated → Lambda ─────────────────────────────────────────────
resource "aws_sns_topic_subscription" "email_receipt_status_updated" {
  topic_arn = aws_sns_topic.order_status_updated.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.email_receipt.arn
}

resource "aws_lambda_permission" "allow_sns_status_updated" {
  statement_id  = "AllowExecutionFromSNSStatusUpdated"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.email_receipt.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.order_status_updated.arn
}


# ── Outputs (handy for debugging) ─────────────────────────────────────────────

output "email_sns_topic_order_created_arn" {
  description = "SNS topic for order.created events"
  value       = aws_sns_topic.order_created.arn
}

output "email_sns_topic_order_status_updated_arn" {
  description = "SNS topic for order.status_updated events"
  value       = aws_sns_topic.order_status_updated.arn
}

output "email_lambda_name" {
  description = "Lambda function name — useful for `aws logs tail` commands"
  value       = aws_lambda_function.email_receipt.function_name
}

output "email_lambda_log_group" {
  description = "CloudWatch log group for the email-receipt Lambda"
  value       = "/aws/lambda/${aws_lambda_function.email_receipt.function_name}"
}
