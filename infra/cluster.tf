# ── ECS Cluster — Platform Layer ──────────────────────────────────────────────
# Cluster-level platform resources only.
# Per-service resources (task definitions, ECS services, log groups,
# Cloud Map service entries, IAM task roles) are created by the deploy
# pipeline reading deploy/{service}/service.yaml.
#
# Launch type: Fargate (serverless ECS).
#   No EC2 instances, no Auto Scaling Group, no Launch Template, no ECS agent
#   to manage. AWS provisions a managed micro-VM per task, charges per second
#   only while the task runs.
#
# Terraform → Pipeline handoff via SSM:
#   /orderflow/{env}/infra/cluster-name           apply.py uses to create/update ECS services
#   /orderflow/{env}/infra/cloudmap-namespace-id  apply.py uses to register Cloud Map entries
#   /orderflow/{env}/infra/execution-role-arn     apply.py injects into task definitions
#   /orderflow/{env}/infra/task-subnet-id         apply.py uses for awsvpc networkConfiguration
#   /orderflow/{env}/infra/ecs-sg-id              apply.py uses for awsvpc networkConfiguration

# ── ECS Cluster ───────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${var.project}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.project}-${var.environment}"
  }
}

# ── Fargate Capacity Providers ────────────────────────────────────────────────
# FARGATE        — on-demand serverless ECS (used here).
# FARGATE_SPOT   — up to 70% cheaper, but tasks can be interrupted with 2-min
#                  notice. Acceptable for stateless web services in dev/sit;
#                  not enabled by default. To opt in: add "FARGATE_SPOT" to
#                  capacity_providers and define a strategy with a non-zero
#                  weight.
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# ── Cloud Map — Private DNS Namespace ─────────────────────────────────────────
# Platform resource — created once, shared by all services.
# Namespace: orderflow-{env}.local
#
# Services register themselves under this namespace via the deploy pipeline.
# apply.py reads the namespace ID from SSM and creates the Cloud Map service
# entry (order-service.orderflow-dev.local) during each service deploy.

resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${var.project}-${var.environment}.local"
  vpc  = aws_vpc.main.id

  tags = {
    Name = "${var.project}-${var.environment}.local"
  }
}

# ── SSM Handoff Parameters ────────────────────────────────────────────────────
# Terraform writes these after creating platform resources.
# The deploy pipeline reads them — no hardcoded values in pipeline scripts.

resource "aws_ssm_parameter" "cluster_name" {
  name  = "/orderflow/${var.environment}/infra/cluster-name"
  type  = "String"
  value = aws_ecs_cluster.main.name

  tags = { Name = "infra-cluster-name-${var.environment}" }
}

resource "aws_ssm_parameter" "cloudmap_namespace_id" {
  name  = "/orderflow/${var.environment}/infra/cloudmap-namespace-id"
  type  = "String"
  value = aws_service_discovery_private_dns_namespace.main.id

  tags = { Name = "infra-cloudmap-namespace-id-${var.environment}" }
}

resource "aws_ssm_parameter" "execution_role_arn" {
  name  = "/orderflow/${var.environment}/infra/execution-role-arn"
  type  = "String"
  value = aws_iam_role.ecs_execution.arn

  tags = { Name = "infra-execution-role-arn-${var.environment}" }
}

# Fargate task placement: public subnet + public IP so tasks reach ECR /
# CloudWatch / SSM via the IGW (no VPC endpoints, no NAT, ~$0 networking cost).
# The ECS security group only allows inbound from the ALB SG, so tasks remain
# unreachable from the public internet despite having a public IP.
resource "aws_ssm_parameter" "task_subnet_id" {
  name  = "/orderflow/${var.environment}/infra/task-subnet-id"
  type  = "String"
  value = aws_subnet.public_a.id

  tags = { Name = "infra-task-subnet-id-${var.environment}" }
}

resource "aws_ssm_parameter" "ecs_security_group" {
  name  = "/orderflow/${var.environment}/infra/ecs-sg-id"
  type  = "String"
  value = aws_security_group.ecs.id

  tags = { Name = "infra-ecs-sg-id-${var.environment}" }
}
