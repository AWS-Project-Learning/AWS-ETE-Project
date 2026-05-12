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

  # Origin — where CloudFront fetches files from (the private S3 bucket)
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Cache behaviour — applies to all requests
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

  # Free CloudFront SSL certificate — URL will be https://d1abc123.cloudfront.net
  # Later: swap for ACM certificate + custom domain (e.g. app.orderflow.com)
  viewer_certificate {
    cloudfront_default_certificate = true
  }
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
