# ── RDS MySQL ─────────────────────────────────────────────────────────────────
# The shared database for the orderflow platform.
# Both order-service and invoice-service connect to this MySQL instance.
# Each service uses its own database schema inside the same RDS instance.
#
# Real-world analogy:
#   RDS is like a managed database server in a locked back room.
#   ECS containers (the "staff") can open the door (port 3306), but only
#   because the security group explicitly allows it. Nothing from the internet
#   can reach it — it has no public IP and sits in a private subnet.

# ── DB Subnet Group ───────────────────────────────────────────────────────────
# Tells RDS which subnets it is allowed to place the database in.
# AWS requires at least 2 subnets in different Availability Zones — even for
# a single-AZ instance — so that it CAN do a failover if you enable Multi-AZ later.

resource "aws_db_subnet_group" "main" {
  name        = "${var.project}-db-subnet-group-${var.environment}"
  description = "Private DB subnets for ${var.project} ${var.environment}"
  subnet_ids  = [aws_subnet.private_db_a.id, aws_subnet.private_db_b.id]

  tags = {
    Name = "${var.project}-db-subnet-group-${var.environment}"
  }
}

# ── DB Parameter Group ────────────────────────────────────────────────────────
# A parameter group is a configuration file for MySQL.
# We use utf8mb4 so the database supports all Unicode characters (including emojis).
# This is the modern default — avoids charset issues with international text.

resource "aws_db_parameter_group" "main" {
  name        = "${var.project}-mysql8-${var.environment}"
  family      = "mysql8.0"
  description = "MySQL 8.0 parameter group for ${var.project} ${var.environment}"

  parameter {
    name  = "character_set_server"
    value = "utf8mb4"
  }

  parameter {
    name  = "collation_server"
    value = "utf8mb4_unicode_ci"
  }

  # Slow query log — helps spot poorly performing queries during dev/sit testing
  parameter {
    name  = "slow_query_log"
    value = "1"
  }

  parameter {
    name  = "long_query_time"
    value = "2" # log queries taking more than 2 seconds
  }

  tags = {
    Name = "${var.project}-mysql8-${var.environment}"
  }
}

# ── RDS MySQL Instance ─────────────────────────────────────────────────────────
# The actual database server.
#
# Free Tier: db.t3.micro gives 750 hours/month free for the first 12 months,
# plus 20 GB of gp2 storage.
#
# We run Single-AZ (no standby replica) to stay within Free Tier limits.
# Multi-AZ can be enabled later for production by setting multi_az = true.

resource "aws_db_instance" "main" {
  identifier = "${var.project}-mysql-${var.environment}"

  # Engine
  engine         = "mysql"
  engine_version = "8.0"

  # Instance size — db.t3.micro is Free Tier eligible
  instance_class = "db.t3.micro"

  # Storage — 20 GB is the Free Tier maximum; gp2 is standard SSD storage
  allocated_storage     = 20
  max_allocated_storage = 20 # disables auto-scaling so we stay within Free Tier
  storage_type          = "gp2"
  storage_encrypted     = true # encrypt at rest — good practice even in dev

  # Database credentials
  # Password comes from a sensitive Terraform variable, passed via GitHub secret
  db_name  = replace(var.project, "-", "_") # "orderflow" — the default schema created on first boot
  username = "admin"
  password = var.db_password

  # Networking
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false # never expose the DB to the internet

  # Configuration
  parameter_group_name = aws_db_parameter_group.main.name
  multi_az             = false # Single-AZ for Free Tier; set true for production

  # Backups — 1-day retention for dev/sit (Free Tier includes backup storage equal to DB size)
  backup_retention_period = 1
  backup_window           = "03:00-04:00" # UTC — low-traffic window

  # Maintenance
  maintenance_window         = "Mon:04:00-Mon:05:00" # UTC — just after backup window
  auto_minor_version_upgrade = true                  # automatically apply minor patches

  # Deletion settings
  # skip_final_snapshot = true means Terraform won't wait for a backup before destroying
  # This is fine for dev/sit — set to false and add final_snapshot_identifier for prod
  skip_final_snapshot      = true
  deletion_protection      = false
  delete_automated_backups = true

  tags = {
    Name = "${var.project}-mysql-${var.environment}"
  }
}
