# ── ECR Repositories — Docker Image Storage ───────────────────────────────────
#
# What is ECR?
#   ECR (Elastic Container Registry) is AWS's private Docker Hub.
#   When GitHub Actions builds a Docker image, it pushes it here.
#   When ECS starts a container, it pulls the image from here.
#
# Real world: Think of ECR as a private warehouse for your Docker images.
#             GitHub Actions is the supplier that stocks the warehouse.
#             ECS is the factory that picks images from the warehouse to run.
#
# We create one repository per service.
# ECR repositories are global (not per environment) — the environment
# is tracked by the image tag (e.g. order-service:dev-a3f9c12)

locals {
  # List of all backend services that need an ECR repository
  services = ["order-service", "invoice-service", "bff"]
}

resource "aws_ecr_repository" "services" {
  # for_each creates one ECR repo for each service in the list above.
  # Result:
  #   aws_ecr_repository.services["order-service"]
  #   aws_ecr_repository.services["invoice-service"]
  #   aws_ecr_repository.services["bff"]
  for_each = toset(local.services)

  name                 = "${var.project}/${each.key}" # e.g. orderflow/order-service
  image_tag_mutability = "MUTABLE"                    # allows overwriting tags like "latest"

  # Scan images for known OS/library vulnerabilities on every push.
  # Results appear in the ECR console — free basic scanning.
  image_scanning_configuration {
    scan_on_push = true
  }

  # Encrypt images at rest using AWS-managed keys (free, no config needed)
  encryption_configuration {
    encryption_type = "AES256"
  }
}

# ── Lifecycle Policy ──────────────────────────────────────────────────────────
# ECR stores every image version you push. Without a policy, old images
# pile up and you pay for storage indefinitely.
#
# This policy keeps only the 10 most recent images per repo.
# Older ones are automatically deleted.
#
# Real world: Like a wardrobe rule — keep the 10 newest shirts, donate the rest.

resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = toset(local.services)
  repository = aws_ecr_repository.services[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
