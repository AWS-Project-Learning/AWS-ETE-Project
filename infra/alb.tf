# ── Application Load Balancer ─────────────────────────────────────────────────
# Platform resource — Terraform creates the ALB, target groups, and listener.
# Only ALB-facing services appear here (currently just BFF).
#
# After creating each target group, Terraform writes its ARN to SSM.
# The deploy pipeline reads the ARN from SSM and wires the ECS service to it.
# This is the clean handoff point — Terraform and the deploy pipeline
# never directly depend on each other.
#
# Path written to SSM: /orderflow/{env}/infra/tg-{service}-arn
# Referenced in service.yaml:
#   load_balancer:
#     target_group_ssm: /orderflow/dev/infra/tg-bff-arn

# ── ALB ───────────────────────────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "${var.project}-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public.id, aws_subnet.public_b.id]

  enable_deletion_protection = false

  tags = {
    Name = "${var.project}-alb-${var.environment}"
  }
}

# ── Target Groups ─────────────────────────────────────────────────────────────
# Created per entry in local.alb_routing (only BFF currently).
# target_type = "ip" because tasks run in awsvpc mode — each task has its own
# ENI/IP, so ALB targets the task IP directly on the container port instead of
# the EC2 instance + dynamic host port (which would require target_type=instance).
#
# A name_prefix + create_before_destroy is used so changing the name (or any
# immutable attribute like target_type) does a smooth rotation: new TG is
# created → SSM param flips → listener rule swaps → old TG is removed.

resource "aws_lb_target_group" "services" {
  for_each = local.alb_routing

  name_prefix = substr("${each.key}-", 0, 6)
  port        = each.value.port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name    = "${var.project}-${each.key}-${var.environment}"
    Service = each.key
  }
}

# ── SSM Handoff — Target Group ARNs ──────────────────────────────────────────
# deploy.py reads these to wire ECS services to the correct target group.
# The service.yaml declares: load_balancer.target_group_ssm = /orderflow/dev/infra/tg-bff-arn
# deploy.py fetches the ARN from SSM and passes it to ecs create-service.

resource "aws_ssm_parameter" "tg_arn" {
  for_each = local.alb_routing

  name  = "/orderflow/${var.environment}/infra/tg-${each.key}-arn"
  type  = "String"
  value = aws_lb_target_group.services[each.key].arn

  tags = { Name = "infra-tg-${each.key}-arn-${var.environment}" }
}

# ── Listener ──────────────────────────────────────────────────────────────────

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.services["bff"].arn
  }
}

# ── Listener Rules ────────────────────────────────────────────────────────────

resource "aws_lb_listener_rule" "services" {
  for_each = local.alb_routing

  listener_arn = aws_lb_listener.http.arn
  priority     = each.value.priority

  condition {
    path_pattern {
      values = each.value.path_patterns
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.services[each.key].arn
  }
}
