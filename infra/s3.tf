# ── S3 Bucket — Frontend Static Hosting ──────────────────────────────────────
# Stores the compiled React app (HTML, CSS, JS).
# The bucket is private — files are served only through CloudFront (see cloudfront.tf).

resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project}-frontend-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

# Block all public access — users reach files only via CloudFront, never directly.
resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning — keeps previous file versions for rollback if a bad deploy goes out.
resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Encryption at rest — free, zero performance impact, security best practice.
resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Bucket policy — grants CloudFront read access to serve files.
# The policy document is defined in cloudfront.tf alongside the distribution.
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.frontend]
}
