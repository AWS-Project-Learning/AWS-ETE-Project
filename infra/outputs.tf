# ── Outputs ───────────────────────────────────────────────────────────────────
# Printed after `terraform apply`. Also readable by CI:
#   terraform output -raw alb_dns_name
#
# NOTE: Per-service outputs (ECS service names, Cloud Map service ARNs) are no
# longer here — those resources are owned by the deploy pipeline, not Terraform.
# The pipeline reads infra references from SSM, not from Terraform outputs.

# ── Frontend ──────────────────────────────────────────────────────────────────

output "frontend_bucket_name" {
  description = "S3 bucket name for frontend static files"
  value       = aws_s3_bucket.frontend.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — used for cache invalidation after deploy"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain" {
  description = "Public URL of the frontend"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

# ── IAM ───────────────────────────────────────────────────────────────────────

output "ecs_execution_role_arn" {
  description = "Shared ECS task execution role ARN — also written to SSM for the deploy pipeline"
  value       = aws_iam_role.ecs_execution.arn
}

# ── VPC ───────────────────────────────────────────────────────────────────────

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "subnet_public_ids" {
  description = "Public subnet IDs (ALB + EC2)"
  value       = [aws_subnet.public.id, aws_subnet.public_b.id]
}

output "subnet_private_db_ids" {
  description = "Private DB subnet IDs (RDS)"
  value       = [aws_subnet.private_db_a.id, aws_subnet.private_db_b.id]
}

# ── ECS Cluster ───────────────────────────────────────────────────────────────

output "ecs_cluster_name" {
  description = "ECS cluster name — also written to SSM: /orderflow/{env}/infra/cluster-name"
  value       = aws_ecs_cluster.main.name
}

# ── Cloud Map ─────────────────────────────────────────────────────────────────

output "service_namespace" {
  description = "Cloud Map private DNS namespace — also written to SSM for deploy pipeline"
  value       = aws_service_discovery_private_dns_namespace.main.name
}

# ── ALB ───────────────────────────────────────────────────────────────────────

output "alb_dns_name" {
  description = "ALB public DNS — use to test before CloudFront is wired"
  value       = aws_lb.main.dns_name
}

output "target_group_arns" {
  description = "ALB target group ARNs — also written to SSM: /orderflow/{env}/infra/tg-{service}-arn"
  value       = { for svc, tg in aws_lb_target_group.services : svc => tg.arn }
}

# ── RDS ───────────────────────────────────────────────────────────────────────

output "rds_endpoint" {
  description = "RDS MySQL endpoint"
  value       = aws_db_instance.main.endpoint
}

# ── ECR ───────────────────────────────────────────────────────────────────────

output "ecr_registry" {
  description = "ECR registry URL prefix"
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "ecr_repository_urls" {
  description = "Full ECR repository URL per service"
  value       = { for svc, repo in aws_ecr_repository.services : svc => repo.repository_url }
}

# ── SSM Handoff Params ────────────────────────────────────────────────────────
# These SSM paths are read by the deploy pipeline — listed here for reference.

output "ssm_handoff_paths" {
  description = "SSM paths the deploy pipeline reads to wire up services"
  value = {
    cluster_name          = aws_ssm_parameter.cluster_name.name
    cloudmap_namespace_id = aws_ssm_parameter.cloudmap_namespace_id.name
    execution_role_arn    = aws_ssm_parameter.execution_role_arn.name
    tg_arns               = { for svc, p in aws_ssm_parameter.tg_arn : svc => p.name }
  }
}
