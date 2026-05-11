# Local dev defaults — override per environment in CI with -var flags
# or a separate tfvars file (terraform.dev.tfvars, terraform.sit.tfvars)

aws_region  = "us-east-1"
environment = "dev"
project     = "orderflow"
