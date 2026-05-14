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

resource "aws_ecr_repository" "services" {
  # ecr_services = toset([...]) — one ECR repo per service name.
  # Add a new service name to ecr_services in main.tf to get a new repo.
  for_each = local.ecr_services

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
  for_each   = local.ecr_services
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
