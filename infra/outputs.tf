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

# ── ECR Outputs ───────────────────────────────────────────────────────────────

output "ecr_registry" {
  description = "ECR registry URL (account + region prefix, no repo name)"
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "ecr_repository_urls" {
  description = "Full ECR repository URL per service"
  value       = { for svc, repo in aws_ecr_repository.services : svc => repo.repository_url }
}
