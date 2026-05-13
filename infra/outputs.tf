# ── Outputs ───────────────────────────────────────────────────────────────────
# These values are printed after `terraform apply` completes.
# They're also readable by other scripts or CI pipelines via:
#   terraform output -raw frontend_bucket_name

output "frontend_bucket_name" {
  description = "S3 bucket name for frontend static files"
  value       = aws_s3_bucket.frontend.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — used for cache invalidation after deploy"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain" {
  description = "Public URL of the frontend (e.g. d1abc123.cloudfront.net)"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

# ── VPC Outputs ───────────────────────────────────────────────────────────────

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "subnet_public_id" {
  description = "Public subnet ID (ALB)"
  value       = aws_subnet.public.id
}

output "subnet_private_app_id" {
  description = "Private app subnet ID (ECS)"
  value       = aws_subnet.private_app.id
}

output "subnet_private_db_ids" {
  description = "Private DB subnet IDs (RDS)"
  value       = [aws_subnet.private_db_a.id, aws_subnet.private_db_b.id]
}

output "sg_alb_id" {
  description = "ALB security group ID"
  value       = aws_security_group.alb.id
}

output "sg_ecs_id" {
  description = "ECS security group ID"
  value       = aws_security_group.ecs.id
}

output "sg_rds_id" {
  description = "RDS security group ID"
  value       = aws_security_group.rds.id
}

# ── ECR Outputs ───────────────────────────────────────────────────────────────

output "ecr_registry" {
  description = "ECR registry URL (account + region prefix, no repo name)"
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "ecr_repository_urls" {
  description = "Full ECR repository URL per service"
  value       = { for svc, repo in aws_ecr_repository.services : svc => repo.repository_url }
}
