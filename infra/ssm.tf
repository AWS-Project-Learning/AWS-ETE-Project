# ── SSM Parameter Store ───────────────────────────────────────────────────────
# Terraform owns two categories of SSM parameters:
#
# 1. DB URL secrets (SecureString)
#    Terraform creates these because ONLY Terraform knows the RDS endpoint
#    and master password. The deploy pipeline never touches these — services
#    reference them in deploy/{service}/service.yaml under env_secrets.
#
# 2. Infra handoff params (String) — see cluster.tf and alb.tf
#    Written by Terraform after creating platform resources.
#    Read by deploy.py to wire up ECS services without hardcoding ARNs.

# ── Database URL secrets ───────────────────────────────────────────────────────
# One SecureString per database-backed service.
# Path: /orderflow/{env}/{service}/db-url
# Referenced in service.yaml:
#   env_secrets:
#     DATABASE_URL:
#       ssm_path: /orderflow/dev/order-service/db-url

resource "aws_ssm_parameter" "db_url" {
  for_each = local.db_services

  name  = "/orderflow/${var.environment}/${each.key}/db-url"
  type  = "SecureString"
  value = "mysql+pymysql://admin:${var.db_password}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/orderflow"

  tags = {
    Name    = "${each.key}-db-url-${var.environment}"
    Service = each.key
  }
}
