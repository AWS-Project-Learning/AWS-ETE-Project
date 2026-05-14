# ── ECS Account Settings ──────────────────────────────────────────────────────
# These are account-level (not region/env specific) settings that apply once
# across the whole AWS account.

# Enable ENI trunking so awsvpc-mode tasks can run on smaller EC2 instances.
#
# Without this: t3.micro supports 2 ENIs total (1 for the host, 1 spare)
#               → only 1 awsvpc task can run on the instance at a time.
#
# With this:    ECS attaches a single "trunk" ENI to the instance and creates
#               branch ENIs for each task over that trunk.
#               → t3.micro can host all 3 services (bff, order-service, invoice-service)
#               → no ENI limit bottleneck for small dev instances.
#
# This unblocks us from using awsvpc network mode, which is the prerequisite
# for Cloud Map Type A records and proper DNS-based service discovery.
resource "aws_ecs_account_setting_default" "awsvpc_trunking" {
  name  = "awsvpcTrunking"
  value = "enabled"
}

# ── SSM Handoff — awsvpc network configuration ────────────────────────────────
# render.py needs the private app subnet ID and ECS security group ID
# to populate the networkConfiguration block in each ECS service definition.
# Terraform writes them here; render.py reads them at deploy time.
#
# Pattern matches all other infra handoff params:
#   /orderflow/{env}/infra/{resource}

resource "aws_ssm_parameter" "private_app_subnet" {
  name  = "/orderflow/${var.environment}/infra/private-app-subnet-id"
  type  = "String"
  value = aws_subnet.private_app.id

  tags = { Name = "infra-private-app-subnet-id-${var.environment}" }
}

resource "aws_ssm_parameter" "ecs_security_group" {
  name  = "/orderflow/${var.environment}/infra/ecs-sg-id"
  type  = "String"
  value = aws_security_group.ecs.id

  tags = { Name = "infra-ecs-sg-id-${var.environment}" }
}
