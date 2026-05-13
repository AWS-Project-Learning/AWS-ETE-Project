# ── Application Load Balancer ─────────────────────────────────────────────────
# The ALB is the single entry point for all API traffic.
# It sits in the public subnet, accepts requests from the internet (or CloudFront),
# and routes them to the correct ECS service based on the URL path.
#
# Real-world analogy:
#   The ALB is like the reception desk of a large office building.
#   Anyone can walk in through the front door (port 80).
#   The receptionist (listener) reads where you want to go and directs you:
#     - "Order department?" → points you to floor 1 (order-service)
#     - "Invoice department?" → points you to floor 2 (invoice-service)
#     - "Everything else?" → points you to the general desk (bff)
#   The individual offices (ECS containers) are in a back room — you can't
#   reach them directly, only through the receptionist.

# ── ALB ───────────────────────────────────────────────────────────────────────
# The load balancer itself.
# internal = false means it faces the public internet (sits in public subnet).

resource "aws_lb" "main" {
  name               = "${var.project}-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public.id, aws_subnet.public_b.id]
  # ALB requires subnets in at least 2 different Availability Zones.
  # public = AZ-a, public_b = AZ-b — satisfies the requirement.

  # Access logs disabled to stay within Free Tier (S3 costs apply per log)
  enable_deletion_protection = false

  tags = {
    Name = "${var.project}-alb-${var.environment}"
  }
}

# ── Target Groups ─────────────────────────────────────────────────────────────
# A target group is a list of destinations the ALB can send traffic to.
# Each service gets its own target group — the ALB registers ECS tasks into it
# automatically when ECS starts or replaces a container.
#
# target_type = "ip" is required for ECS with awsvpc networking.
# The ALB sends traffic directly to the container's private IP, not the EC2 host.

resource "aws_lb_target_group" "order_service" {
  name        = "${var.project}-tg-order-${var.environment}"
  port        = 8001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30 # check every 30 seconds
    timeout             = 5  # wait up to 5 seconds for a response
    healthy_threshold   = 2  # 2 successful checks = healthy
    unhealthy_threshold = 3  # 3 failed checks = unhealthy (stop sending traffic)
  }

  tags = {
    Name = "${var.project}-tg-order-${var.environment}"
  }
}

resource "aws_lb_target_group" "invoice_service" {
  name        = "${var.project}-tg-invoice-${var.environment}"
  port        = 8002
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

  tags = {
    Name = "${var.project}-tg-invoice-${var.environment}"
  }
}

resource "aws_lb_target_group" "bff" {
  name        = "${var.project}-tg-bff-${var.environment}"
  port        = 8000
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

  tags = {
    Name = "${var.project}-tg-bff-${var.environment}"
  }
}

# ── Listener ──────────────────────────────────────────────────────────────────
# The listener is the "front door" — it watches port 80 for incoming requests.
# The default action sends unmatched traffic to the BFF (catch-all).
# Specific path rules below override this default for order and invoice routes.
#
# HTTPS (port 443) would require an ACM certificate — we start with HTTP for dev.
# In production, you add an aws_lb_listener for 443 with ssl_certificate_arn.

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  # Default action — anything not matched by a rule below goes to BFF
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.bff.arn
  }
}

# ── Listener Rules — path-based routing ───────────────────────────────────────
# Rules are evaluated in priority order (lower number = checked first).
# The first rule that matches wins — the request is forwarded to that target group.

# Priority 10 — /api/orders/* → order-service
resource "aws_lb_listener_rule" "order_service" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/orders", "/api/orders/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.order_service.arn
  }
}

# Priority 20 — /api/invoices/* → invoice-service
resource "aws_lb_listener_rule" "invoice_service" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  condition {
    path_pattern {
      values = ["/api/invoices", "/api/invoices/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.invoice_service.arn
  }
}

# Priority 30 — /api/* → bff (catches all other /api/ traffic)
# This is a safety net — BFF also handles dashboard and aggregation endpoints.
resource "aws_lb_listener_rule" "bff" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 30

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.bff.arn
  }
}
