# ── Custom Domain — orderflow.gleeze.com ─────────────────────────────────────
#
# DNS is managed outside AWS (Dynu free DNS) so Terraform cannot auto-validate
# the ACM cert. Instead:
#
#   Step 1 — Apply this file: ACM issues a pending cert + outputs a CNAME record.
#   Step 2 — You add that CNAME to Dynu (DNS validation).
#   Step 3 — ACM goes from PENDING_VALIDATION → ISSUED (~5 min).
#   Step 4 — Apply again (or wait: CloudFront waits on cert ARN).
#   Step 5 — Add final CNAME in Dynu: orderflow.gleeze.com → CloudFront domain.
#
# ACM certs for CloudFront MUST be in us-east-1.
# We use an aliased provider to enforce this even when var.aws_region != us-east-1.
# ─────────────────────────────────────────────────────────────────────────────

variable "custom_domain" {
  description = <<-EOT
    Custom domain for the frontend (e.g. orderflow.gleeze.com).
    Set to empty string to disable custom domain (uses CloudFront default URL).
  EOT
  type        = string
  default     = "orderflow.gleeze.com"
}

# ACM certs used by CloudFront must live in us-east-1 regardless of the
# region where all other resources are deployed.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# ── ACM Certificate ───────────────────────────────────────────────────────────
# DNS validation is chosen over email validation because it doesn't expire and
# can be re-validated automatically if the cert is ever renewed.
resource "aws_acm_certificate" "frontend" {
  count    = var.custom_domain != "" ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.custom_domain
  validation_method = "DNS"

  # Ensure a new cert is created before the old one is destroyed
  # so there is no gap in HTTPS coverage during updates.
  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${var.project}-frontend-cert-${var.environment}" }
}

# ── Outputs — paste these into Dynu to validate the cert ─────────────────────
# After applying, copy the CNAME name+value shown here into Dynu's DNS panel:
#   Type:     CNAME
#   Hostname: <acm_validation_cname_name>   (the part before your domain)
#   Value:    <acm_validation_cname_value>

output "acm_validation_cname_name" {
  description = "Step 2: Add this as a CNAME record NAME in Dynu to validate the SSL cert"
  value = (
    var.custom_domain != "" && length(aws_acm_certificate.frontend) > 0
    ? tolist(aws_acm_certificate.frontend[0].domain_validation_options)[0].resource_record_name
    : "custom_domain not set"
  )
}

output "acm_validation_cname_value" {
  description = "Step 2: Add this as the CNAME record VALUE in Dynu"
  value = (
    var.custom_domain != "" && length(aws_acm_certificate.frontend) > 0
    ? tolist(aws_acm_certificate.frontend[0].domain_validation_options)[0].resource_record_value
    : "custom_domain not set"
  )
}

output "custom_domain_url" {
  description = "Your app URL once everything is set up"
  value       = var.custom_domain != "" ? "https://${var.custom_domain}" : "not configured"
}

output "cloudfront_cname_target" {
  description = "Step 5: Point orderflow.gleeze.com CNAME at this value in Dynu"
  value       = aws_cloudfront_distribution.frontend.domain_name
}
