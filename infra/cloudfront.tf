# ── CloudFront — Frontend CDN ─────────────────────────────────────────────────
# CloudFront is AWS's CDN (Content Delivery Network).
# It caches the React app at edge locations worldwide so users get fast load times
# regardless of where they are — a user in Sydney is served from the Sydney edge,
# not from us-east-1 directly.
#
# It also provides HTTPS and acts as the only entry point to the private S3 bucket.

# ── Origin Access Control ─────────────────────────────────────────────────────
# OAC is CloudFront's signed identity when fetching files from S3.
# Every request CloudFront makes to S3 is signed with SigV4.
# S3 only accepts requests that match the bucket policy — effectively meaning
# only this CloudFront distribution can read from the bucket.
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project}-frontend-oac-${var.environment}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront Distribution ───────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "${var.project} frontend — ${var.environment}"

  # Origin 1 — S3 for static frontend files
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Origin 2 — ALB for API requests (/api/*)
  # CloudFront forwards /api/* to the BFF via HTTP on port 80.
  # This keeps the UI on HTTPS (no mixed content) and avoids CORS entirely —
  # the browser sees one domain (CloudFront) for both UI and API calls.
  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb-bff"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Security API behaviours — only explicit API endpoints go to ALB → Lambda.
  # This avoids hijacking frontend SPA routes like /security and /security/dashboard.
  dynamic "ordered_cache_behavior" {
    for_each = toset([
      "/security/scan",
      "/security/reason",
      "/security/patch",
      "/security/patch-status",
      "/security/approve",
      "/security/status",
      "/security/results",
      "/security/health",
      "/security/probe",
      "/security/explain",
      "/security/chat",
    ])
    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = "alb-bff" # same ALB, listener rule routes to Lambda
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      forwarded_values {
        query_string = true
        headers      = ["Authorization", "Content-Type", "Accept", "Origin"]
        cookies {
          forward = "none"
        }
      }

      min_ttl     = 0
      default_ttl = 0 # never cache security API responses
      max_ttl     = 0
    }
  }

  # API cache behaviour — /api/* routed to ALB, never cached
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "alb-bff"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type", "Accept", "Origin"]
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 0 # never cache API responses
    max_ttl     = 0
  }

  # Static file cache behaviour — applies to all non-API requests
  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https" # HTTP → HTTPS automatically
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true # gzip/brotli = faster loads

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600 # cache for 1 hour; invalidate after each deploy
    max_ttl     = 86400
  }

  # SPA fallback — React Router handles routing client-side.
  # Without this, visiting /orders/123 directly returns 403/404 from S3
  # because that file doesn't exist. CloudFront intercepts and returns index.html
  # so React Router can take over.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Custom domain alias — only set when var.custom_domain is non-empty and the
  # ACM cert has been issued. Leaving this empty falls back to the default
  # CloudFront URL (d7v98dznpwca9.cloudfront.net) which still works fine.
  aliases = var.custom_domain != "" ? [var.custom_domain] : []

  # Use the ACM cert when a custom domain is configured, otherwise use the
  # free default CloudFront certificate.
  viewer_certificate {
    cloudfront_default_certificate = var.custom_domain == ""
    acm_certificate_arn            = var.custom_domain != "" && length(aws_acm_certificate_validation.frontend) > 0 ? aws_acm_certificate_validation.frontend[0].certificate_arn : null
    ssl_support_method             = var.custom_domain != "" ? "sni-only" : null
    minimum_protocol_version       = var.custom_domain != "" ? "TLSv1.2_2021" : null
  }
}

# ── SSM Handoff — read by build-ui.yml pipeline ───────────────────────────────
# Avoids hardcoding IDs in the pipeline. Pattern matches other infra handoff params.

resource "aws_ssm_parameter" "cloudfront_id" {
  name  = "/orderflow/${var.environment}/infra/cloudfront-id"
  type  = "String"
  value = aws_cloudfront_distribution.frontend.id

  tags = { Name = "infra-cloudfront-id-${var.environment}" }
}

resource "aws_ssm_parameter" "frontend_bucket" {
  name  = "/orderflow/${var.environment}/infra/frontend-bucket"
  type  = "String"
  value = aws_s3_bucket.frontend.bucket

  tags = { Name = "infra-frontend-bucket-${var.environment}" }
}

# ── Bucket Policy Document ────────────────────────────────────────────────────
# Kept here (not in s3.tf) because it references the CloudFront distribution ARN.
# Grants s3:GetObject only to this specific CloudFront distribution.
data "aws_iam_policy_document" "frontend_bucket" {
  statement {
    sid    = "AllowCloudFrontRead"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}
