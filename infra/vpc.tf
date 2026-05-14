# ── VPC ───────────────────────────────────────────────────────────────────────
# The private network that all our AWS resources live in.
# Nothing inside the VPC is reachable from the internet unless explicitly allowed.

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true # allows resources to get DNS names like ip.region.compute.internal
  enable_dns_support   = true # required for VPC endpoints to resolve service DNS names

  tags = {
    Name = "${var.project}-vpc-${var.environment}"
  }
}

# ── Internet Gateway ──────────────────────────────────────────────────────────
# The front door — connects the VPC to the public internet.
# Only the public subnet uses this. Private subnets have no route to it.

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project}-igw-${var.environment}"
  }
}

# ── Public Subnet ─────────────────────────────────────────────────────────────
# Where the Load Balancer lives. Faces the internet.
# Resources here get public IPs and are reachable from outside.

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true # resources launched here get a public IP automatically

  tags = {
    Name = "${var.project}-subnet-public-${var.environment}"
  }
}

# ── Public Subnet B ───────────────────────────────────────────────────────────
# Second public subnet in AZ-b — required by the ALB.
# ALB needs subnets in at least 2 different Availability Zones.

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.5.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project}-subnet-public-b-${var.environment}"
  }
}

# Associate second public subnet with the public route table
resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

# ── Private App Subnet ────────────────────────────────────────────────────────
# Where ECS containers run. No public IP, not reachable from internet.
# Outbound traffic goes via VPC Endpoints (ECR, S3) — no NAT Gateway needed.

resource "aws_subnet" "private_app" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.aws_region}a"

  tags = {
    Name = "${var.project}-subnet-private-app-${var.environment}"
  }
}

# ── Private DB Subnet ─────────────────────────────────────────────────────────
# Where RDS MySQL runs. Most restricted — only ECS can reach it.
# RDS requires subnets in at least 2 availability zones — we add a second one.

resource "aws_subnet" "private_db_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.3.0/24"
  availability_zone = "${var.aws_region}a"

  tags = {
    Name = "${var.project}-subnet-private-db-a-${var.environment}"
  }
}

resource "aws_subnet" "private_db_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.4.0/24"
  availability_zone = "${var.aws_region}b" # second AZ required by RDS subnet group

  tags = {
    Name = "${var.project}-subnet-private-db-b-${var.environment}"
  }
}

# ── Route Tables ──────────────────────────────────────────────────────────────
# A route table is like a GPS for network traffic — tells packets where to go.

# Public route table — sends internet-bound traffic through the Internet Gateway
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${var.project}-rt-public-${var.environment}"
  }
}

# Associate public route table with the public subnet
resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Private route table — no route to internet (traffic stays inside VPC)
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project}-rt-private-${var.environment}"
  }
}

# Associate private route table with app and db subnets
resource "aws_route_table_association" "private_app" {
  subnet_id      = aws_subnet.private_app.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_db_a" {
  subnet_id      = aws_subnet.private_db_a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_db_b" {
  subnet_id      = aws_subnet.private_db_b.id
  route_table_id = aws_route_table.private.id
}

# ── Security Groups ───────────────────────────────────────────────────────────

# ALB — accepts HTTP/HTTPS from anywhere on the internet
resource "aws_security_group" "alb" {
  name        = "${var.project}-sg-alb-${var.environment}"
  description = "Load balancer - inbound HTTP/HTTPS from internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project}-sg-alb-${var.environment}"
  }
}

# ECS — only accepts traffic from the ALB, not directly from internet.
# Description is intentionally unchanged from the original — AWS treats SG
# description as immutable, so editing it would force recreation of the SG
# and cascade-replace dependent resources (launch template, dependent SG
# ingress rules, etc.). Inline ALB ingress rule is kept in place so it
# is never briefly absent during apply.
resource "aws_security_group" "ecs" {
  name        = "${var.project}-sg-ecs-${var.environment}"
  description = "ECS containers - inbound from ALB only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From ALB"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound (VPC endpoints + RDS)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project}-sg-ecs-${var.environment}"
  }
}

# Self-reference rule — added separately to avoid recreating the SG.
# Required for awsvpc mode: each task has its own ENI with this SG attached,
# so BFF → order-service → invoice-service traffic must be allowed explicitly.
# Without this, Cloud Map resolves DNS correctly but the connection is dropped
# at the task ENI.
resource "aws_security_group_rule" "ecs_from_self" {
  type                     = "ingress"
  description              = "From sibling ECS tasks (awsvpc)"
  from_port                = 0
  to_port                  = 65535
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs.id
  security_group_id        = aws_security_group.ecs.id
}

# RDS — only accepts MySQL connections from ECS containers
resource "aws_security_group" "rds" {
  name        = "${var.project}-sg-rds-${var.environment}"
  description = "RDS MySQL - inbound from ECS only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "MySQL from ECS"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = {
    Name = "${var.project}-sg-rds-${var.environment}"
  }
}

# VPC Endpoints security group — allows ECS to reach AWS services without internet
resource "aws_security_group" "vpc_endpoints" {
  name        = "${var.project}-sg-vpce-${var.environment}"
  description = "VPC endpoints - inbound HTTPS from ECS"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTPS from ECS"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = {
    Name = "${var.project}-sg-vpce-${var.environment}"
  }
}

# ── VPC Endpoints ─────────────────────────────────────────────────────────────
# VPC Endpoints let ECS pull images from ECR and read/write S3
# entirely within the AWS network — no NAT Gateway, no internet, no cost per GB.
#
# Without these, ECS containers in a private subnet can't reach ECR to pull
# Docker images. You'd need a NAT Gateway ($32/month) instead.

# ECR API endpoint — for authentication and image manifest requests
resource "aws_vpc_endpoint" "ecr_api" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [aws_subnet.private_app.id]
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = {
    Name = "${var.project}-vpce-ecr-api-${var.environment}"
  }
}

# ECR DKR endpoint — for actual Docker image layer downloads
resource "aws_vpc_endpoint" "ecr_dkr" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [aws_subnet.private_app.id]
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = {
    Name = "${var.project}-vpce-ecr-dkr-${var.environment}"
  }
}

# S3 Gateway endpoint — for ECR image layers stored in S3 (free gateway type)
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = {
    Name = "${var.project}-vpce-s3-${var.environment}"
  }
}

# CloudWatch Logs endpoint — for ECS containers to send logs to CloudWatch
resource "aws_vpc_endpoint" "logs" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [aws_subnet.private_app.id]
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = {
    Name = "${var.project}-vpce-logs-${var.environment}"
  }
}
