# ── S3 Bucket — Frontend Static Hosting ──────────────────────────────────────
#
# What this does:
#   Creates an S3 bucket that holds the compiled React app (HTML, CSS, JS).
#   CloudFront sits in front and serves these files to users worldwide.
#   The bucket itself is private — users access files only through CloudFront.
#
# Real world: Think of S3 as a hard drive in the cloud.
#             CloudFront is the delivery truck that gets files to users fast.

# ── The bucket ────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "frontend" {
  # Bucket names must be globally unique across all AWS accounts worldwide.
  # We include project + environment to keep them distinct (dev vs sit).
  bucket = "${var.project}-frontend-${var.environment}"
}

# ── Block all public access ───────────────────────────────────────────────────
# S3 buckets default to private, but this setting makes it explicit and
# prevents any accidental "make public" actions in future.
# Users will access files through CloudFront — not directly from S3.
resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Enable versioning ─────────────────────────────────────────────────────────
# Keeps old versions of files. If a bad deploy goes out, you can roll back
# to the previous version without redeploying — like git history for files.
resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

# ── Server-side encryption ────────────────────────────────────────────────────
# Encrypts all files at rest in S3 using AWS-managed keys.
# Free — no performance impact — just a security best practice.
resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── Bucket policy — allow CloudFront to read files ────────────────────────────
# Even though the bucket is private, CloudFront needs read access.
# This policy grants GetObject (read files) to CloudFront only.
# The OAC (Origin Access Control) identity is what CloudFront uses to sign requests.
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json

  # The public access block must exist first, otherwise the policy might
  # conflict with the block settings during creation.
  depends_on = [aws_s3_bucket_public_access_block.frontend]
}

# ── Policy document ───────────────────────────────────────────────────────────
# This is Terraform's way of writing IAM policies — cleaner than raw JSON.
# It generates the JSON automatically.
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

# ── CloudFront Origin Access Control ──────────────────────────────────────────
# OAC is how CloudFront proves its identity when reading from the private bucket.
# It signs every request with AWS SigV4 — S3 only accepts signed requests.
# Think of it as CloudFront showing its badge to S3 before fetching files.
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project}-frontend-oac-${var.environment}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront Distribution ───────────────────────────────────────────────────
# CloudFront is AWS's CDN (Content Delivery Network).
# It caches your React files at edge locations worldwide.
# A user in Sydney gets files from the Sydney edge — not from us-east-1 directly.
#
# For a React SPA, we need a custom error response:
#   If S3 returns 403 (file not found — e.g. /orders/123),
#   CloudFront returns index.html with 200 so React Router handles the route.
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "${var.project} frontend — ${var.environment}"

  # Where CloudFront fetches files from (our S3 bucket)
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Default cache behaviour — applies to all requests (/*  )
  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https" # HTTP → HTTPS automatically
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true # gzip/brotli compression = faster loads

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    # Cache TTL (time-to-live) in seconds
    # 1 hour default — after deploy, CloudFront invalidation clears the cache
    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # SPA fallback — React Router routes return index.html
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
      restriction_type = "none" # No country blocking
    }
  }

  # Use CloudFront's default SSL certificate (free)
  # Later: replace with ACM certificate + custom domain
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
