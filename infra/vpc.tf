# ── VPC ───────────────────────────────────────────────────────────────────────
# Network for the Fargate-based platform.
#
# Subnet layout:
#   public_a, public_b        ALB + Fargate tasks
#                             Tasks get a public IP (assignPublicIp = ENABLED)
#                             so they can reach ECR, CloudWatch, SSM via the IGW
#                             without paying for interface VPC endpoints (~$21/mo)
#                             or a NAT Gateway (~$32/mo).
#                             Tasks remain unreachable from the internet because
#                             the ECS security group only accepts inbound from
#                             the ALB security group.
#
#   private_db_a, private_db_b RDS (subnet group requires 2 AZs even for Single-AZ)
#
# Security model:
#   Internet → ALB SG (80/443) → ECS SG (any port) → Task containers
#   Task → RDS SG (3306)
#   No public ingress to tasks or RDS — only the ALB has public ingress rules.

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true # required for Cloud Map private DNS resolution
  enable_dns_support   = true

  tags = {
    Name = "${var.project}-vpc-${var.environment}"
  }
}

# ── Internet Gateway ──────────────────────────────────────────────────────────
# Provides outbound internet for the ALB (return traffic) and for Fargate tasks
# pulling images from ECR / writing logs to CloudWatch.
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project}-igw-${var.environment}"
  }
}

# ── Public Subnets ────────────────────────────────────────────────────────────
# Two public subnets in different AZs:
#   - Required by the ALB (it must live in at least 2 AZs)
#   - Fargate tasks are placed in subnet_a only (single-task, no HA per user spec)

# Rename history: this used to be `aws_subnet.public`. The `moved` block tells
# Terraform that the resource was renamed, not destroyed and recreated. Without
# this, a fresh apply against existing AWS state would try to create a new
# subnet with the same CIDR (10.0.1.0/24) before destroying the old one and
# fail with InvalidSubnet.Conflict. The `moved` block is honoured during plan
# and rewrites the state reference automatically.
moved {
  from = aws_subnet.public
  to   = aws_subnet.public_a
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project}-subnet-public-a-${var.environment}"
  }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.5.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project}-subnet-public-b-${var.environment}"
  }
}

# ── Private DB Subnets ────────────────────────────────────────────────────────
# RDS subnet groups require subnets in at least 2 AZs even for Single-AZ
# deployments, so a future Multi-AZ upgrade is non-disruptive.
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
  availability_zone = "${var.aws_region}b"

  tags = {
    Name = "${var.project}-subnet-private-db-b-${var.environment}"
  }
}

# ── Route Tables ──────────────────────────────────────────────────────────────

# Public route table — sends all non-VPC traffic out through the IGW.
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

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

# Private route table — no internet route. DB subnets only talk to ECS via the
# RDS security group rules.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project}-rt-private-${var.environment}"
  }
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

# ALB — public-facing, accepts HTTP/HTTPS from anywhere on the internet.
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

# ECS — security group attached to every Fargate task ENI (awsvpc mode).
#
# Ingress rules are managed via separate `aws_security_group_rule` resources
# instead of inline blocks. Inline blocks are treated as authoritative by
# Terraform — mixing them with external rule resources for the same SG causes
# oscillating drift on every plan/apply.
#
# Description is intentionally generic and stable. AWS treats SG descriptions
# as immutable, so changing it forces recreation of the SG and a cascade
# through every dependent resource.
resource "aws_security_group" "ecs" {
  name        = "${var.project}-sg-ecs-${var.environment}"
  description = "ECS containers - inbound from ALB only"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "All outbound (RDS + ECR + CloudWatch)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project}-sg-ecs-${var.environment}"
  }
}

# Inbound from ALB — required for the ALB to reach Fargate task ENIs.
resource "aws_security_group_rule" "ecs_from_alb" {
  type                     = "ingress"
  description              = "From ALB"
  from_port                = 0
  to_port                  = 65535
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  security_group_id        = aws_security_group.ecs.id
}

# Inbound from sibling tasks — required for BFF → order/invoice calls via
# Cloud Map DNS. Each task has its own ENI with this SG attached, so without
# this rule DNS resolves correctly but the connection is dropped at the
# destination task ENI.
resource "aws_security_group_rule" "ecs_from_self" {
  type                     = "ingress"
  description              = "From sibling tasks (Cloud Map service-to-service)"
  from_port                = 0
  to_port                  = 65535
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs.id
  security_group_id        = aws_security_group.ecs.id
}

# RDS — only accepts MySQL connections from Fargate tasks.
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
