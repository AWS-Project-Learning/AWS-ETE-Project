# ── ECS Cluster — Platform Layer ──────────────────────────────────────────────
# This file contains cluster-level platform resources only.
# Per-service resources (task definitions, ECS services, log groups,
# Cloud Map service entries, IAM task roles) are created by the deploy pipeline
# reading deploy/{service}/service.yaml — not by Terraform.
#
# Terraform → Pipeline handoff via SSM:
#   /orderflow/{env}/infra/cluster-name          → pipeline uses to create/update ECS services
#   /orderflow/{env}/infra/cloudmap-namespace-id → pipeline uses to register Cloud Map entries
#   /orderflow/{env}/infra/execution-role-arn    → pipeline injects into task definitions

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

# ── Capacity Provider ─────────────────────────────────────────────────────────

resource "aws_ecs_capacity_provider" "main" {
  name = "${var.project}-cap-${var.environment}"

  auto_scaling_group_provider {
    auto_scaling_group_arn = aws_autoscaling_group.ecs.arn

    managed_scaling {
      status          = "ENABLED"
      target_capacity = 80
    }
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = [aws_ecs_capacity_provider.main.name]

  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.main.name
    weight            = 1
  }
}

# ── Cloud Map — Private DNS Namespace ─────────────────────────────────────────
# Platform resource — created once, shared by all services.
# Namespace: orderflow-dev.local
#
# Services register themselves under this namespace via the deploy pipeline.
# deploy.py reads the namespace ID from SSM and creates the Cloud Map
# service entry (order-service.orderflow-dev.local) during each service deploy.

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
#
# Pattern: /orderflow/{env}/infra/{resource}

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
