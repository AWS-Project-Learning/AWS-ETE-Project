# ── AI Vulnerability Agent Infrastructure ─────────────────────────────────────
#
# Ownership boundary (same model as ECS services):
#
#   Terraform owns:
#     - DynamoDB table          (data store, changes rarely)
#     - Lambda function shell   (IAM role, timeout, memory, EventBridge wiring)
#     - IAM role + policies     (DynamoDB, SSM, Bedrock access)
#     - EventBridge cron rule   (fires daily scan)
#     - SSM parameters          (platform values the deploy script reads)
#     - OIDC role Lambda perms  (lets GitHub Actions update the function code)
#
#   Deploy pipeline owns (deploy/lambda_deploy.py via vulnerability-agent.yml):
#     - Lambda function CODE    (zip of agents/vulnerability-agent/*.py)
#     - Lambda environment vars (from deploy/vulnerability-agent/values-dev.yaml)
#
# Why this split?
#   Changing scanner.py should NOT require an infra apply — it's just a
#   code deploy, same philosophy as ECS image updates being separate from
#   cluster/task-role Terraform.
#
# First-time sequence:
#   1. terraform apply  → creates Lambda with stub handler (lifecycle.ignore_changes
#                         prevents Terraform from ever reverting real code)
#   2. vulnerability-agent.yml deploy job → pushes real code
#
# Cost: $0/month (Lambda, DynamoDB, EventBridge all within free tier for 1 scan/day)
# ─────────────────────────────────────────────────────────────────────────────


# ── GitHub PAT — SSM SecureString ────────────────────────────────────────────
# You created this manually in the AWS Console — Terraform reads it as a
# data source instead of managing it. This avoids the ParameterAlreadyExists
# error and never risks overwriting your real token.
#
# If the parameter doesn't exist yet, create it first:
#   AWS Console → Systems Manager → Parameter Store → Create parameter
#   Name: /orderflow/dev/agents/github-pat  |  Type: SecureString
data "aws_ssm_parameter" "github_pat" {
  name = "/orderflow/${var.environment}/agents/github-pat"
}


# ── SSM — Lambda function name (read by lambda_deploy.py) ────────────────────
# The deploy script looks this up so it knows which function to update.
# Follows the same pattern as cluster_name, execution_role_arn etc.
resource "aws_ssm_parameter" "agent_function_name" {
  name  = "/orderflow/${var.environment}/agents/lambda-function-name"
  type  = "String"
  value = "${var.project}-vulnerability-agent-${var.environment}"

  tags = { Name = "agents-lambda-function-name-${var.environment}" }
}


# ── DynamoDB — vulnerability scan results ─────────────────────────────────────
# Separate from the Terraform state lock table (orderflow-terraform-locks).
# That table is a mutex; this one is your application database.
#
# Free tier: 25 GB + 25 WCU + 25 RCU forever — daily scans use <0.1% of that.
resource "aws_dynamodb_table" "vuln_scans" {
  name         = "${var.project}-vulnerability-scans-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "scan_id"
  range_key = "record_id"

  attribute {
    name = "scan_id"
    type = "S"
  }
  attribute {
    name = "record_id"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }
  attribute {
    name = "detected_at"
    type = "S"
  }

  # GSI: query "all DETECTED vulnerabilities" without a full table scan
  global_secondary_index {
    name            = "status-detected-index"
    hash_key        = "status"
    range_key       = "detected_at"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = { Name = "${var.project}-vuln-scans-${var.environment}" }
}


# ── Lambda — placeholder zip (first-time bootstrap only) ─────────────────────
# Terraform needs a valid zip to CREATE the function on first apply.
# The real code is deployed by lambda_deploy.py (vulnerability-agent.yml).
# lifecycle.ignore_changes on the Lambda resource ensures Terraform never
# overwrites the real code with this stub on subsequent applies.
data "archive_file" "agent_lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/agent-placeholder.zip"

  source {
    filename = "handler.py"
    content  = "def handler(event, context): return {'status': 'pending - run vulnerability-agent deploy workflow'}"
  }
}


# ── IAM role — assumed by the Lambda at runtime ───────────────────────────────
resource "aws_iam_role" "lambda_agent" {
  name = "lambda-vulnerability-agent-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Name = "lambda-vulnerability-agent-${var.environment}" }
}

resource "aws_iam_role_policy_attachment" "lambda_agent_logs" {
  role       = aws_iam_role.lambda_agent.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_agent_permissions" {
  name = "vulnerability-agent-permissions"
  role = aws_iam_role.lambda_agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDB"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchWriteItem",
        ]
        Resource = [
          aws_dynamodb_table.vuln_scans.arn,
          "${aws_dynamodb_table.vuln_scans.arn}/index/*",
        ]
      },
      {
        Sid      = "SSMReadGitHubPAT"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = data.aws_ssm_parameter.github_pat.arn
      },
      {
        # Phase 2: Bedrock model inference for AI reasoning (Claude 3.5 Haiku)
        Sid    = "BedrockInference"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
      },
    ]
  })
}


# ── Lambda function ───────────────────────────────────────────────────────────
# Terraform owns: IAM role, timeout, memory, environment variables.
# Deploy pipeline owns: the code (filename + source_code_hash).
#
# lifecycle.ignore_changes = [filename, source_code_hash] is the key:
#   - First apply: Lambda is created with the placeholder stub
#   - lambda_deploy.py runs: pushes real code → function is live
#   - Subsequent terraform apply: Terraform sees the real code hash differs
#     from placeholder, but IGNORES it → never reverts the real code
resource "aws_lambda_function" "vulnerability_agent" {
  function_name    = "${var.project}-vulnerability-agent-${var.environment}"
  role             = aws_iam_role.lambda_agent.arn
  handler          = "handler.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.agent_lambda_placeholder.output_path
  source_code_hash = data.archive_file.agent_lambda_placeholder.output_base64sha256

  # 5-minute timeout: scan + OSV batch query + PyPI lookups take ~30-60 sec.
  # Giving 5 min of headroom for cold starts and slow external APIs.
  timeout     = 300
  memory_size = 256

  environment {
    variables = {
      DYNAMODB_TABLE        = aws_dynamodb_table.vuln_scans.name
      SSM_GITHUB_TOKEN_PATH = data.aws_ssm_parameter.github_pat.name
      LOG_LEVEL             = "INFO"
      # NOTE: Do NOT set AWS_REGION here — Lambda reserves that env var.
      # The runtime already exposes AWS_REGION automatically.
    }
  }

  lifecycle {
    # Terraform owns the shell; the deploy pipeline owns the code.
    # Without this, every `terraform apply` would revert the real code
    # back to the placeholder stub.
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Name = "${var.project}-vulnerability-agent-${var.environment}" }
}

resource "aws_cloudwatch_log_group" "agent_lambda" {
  name              = "/aws/lambda/${aws_lambda_function.vulnerability_agent.function_name}"
  retention_in_days = 14

  tags = { Name = "agent-lambda-logs-${var.environment}" }
}



# ── EventBridge — daily scheduled scan ────────────────────────────────────────
# Fires at 02:00 UTC every day. The Lambda wakes up, scans all services,
# writes findings to DynamoDB, and goes back to sleep.
# Cost: 30 invocations/month — well within the 1M/month free tier.
resource "aws_cloudwatch_event_rule" "daily_scan" {
  name                = "${var.project}-daily-vuln-scan-${var.environment}"
  description         = "Daily vulnerability scan trigger for the AI security agent"
  schedule_expression = "cron(0 2 * * ? *)"

  tags = { Name = "${var.project}-daily-vuln-scan-${var.environment}" }
}

resource "aws_cloudwatch_event_target" "daily_scan_target" {
  rule      = aws_cloudwatch_event_rule.daily_scan.name
  target_id = "vulnerability-agent"
  arn       = aws_lambda_function.vulnerability_agent.arn
  input     = jsonencode({ action = "scan" })
}

resource "aws_lambda_permission" "eventbridge_invoke" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.vulnerability_agent.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_scan.arn
}


# ── Outputs ───────────────────────────────────────────────────────────────────

output "agent_lambda_name" {
  description = "Lambda function name — used by vulnerability-agent.yml to invoke scans"
  value       = aws_lambda_function.vulnerability_agent.function_name
}

output "agent_lambda_log_group" {
  description = "CloudWatch log group for the vulnerability agent"
  value       = aws_cloudwatch_log_group.agent_lambda.name
}

output "vuln_scans_table_name" {
  description = "DynamoDB table — stores all CVE scan results"
  value       = aws_dynamodb_table.vuln_scans.name
}

output "github_pat_ssm_path" {
  description = "SSM path for the GitHub PAT (set manually, never committed)"
  value       = data.aws_ssm_parameter.github_pat.name
}
