# ── EC2 Compute for ECS ───────────────────────────────────────────────────────
# Provisions the EC2 instance that ECS containers run on.
# We use a t2.micro (Free Tier) with the ECS-optimized Amazon Linux 2 AMI.
# The instance joins the ECS cluster via user_data on first boot.
#
# Real-world analogy:
#   EC2 is the physical warehouse. The ECS cluster is the warehouse management
#   system. This file sets up the building — cluster.tf sets up the management system.

# ── IAM — EC2 Instance Role ───────────────────────────────────────────────────
# This role is for the EC2 HOST — not for the containers running on it.
# It allows the EC2 machine to:
#   - Register itself with the ECS cluster
#   - Pull task metadata and report container health
#   - Write logs to CloudWatch
#
# Note: This is DIFFERENT from the ECS task roles in iam.tf.
#   EC2 instance role  → used by the machine itself (ECS agent)
#   ECS task role      → used by your application code inside the container

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_instance" {
  name               = "ecs-instance-role-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json

  tags = {
    Name = "ecs-instance-role-${var.environment}"
  }
}

# AWS-managed policy that gives EC2 everything it needs to work with ECS:
# register/deregister with cluster, pull task info, report container health.
resource "aws_iam_role_policy_attachment" "ecs_instance" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

# Instance profile wraps the IAM role so it can be attached to an EC2 instance.
# EC2 cannot use an IAM role directly — it must go through an instance profile.
resource "aws_iam_instance_profile" "ecs_instance" {
  name = "ecs-instance-profile-${var.environment}"
  role = aws_iam_role.ecs_instance.name
}

# ── ECS-Optimized AMI ─────────────────────────────────────────────────────────
# AWS publishes the latest ECS-optimized Amazon Linux 2 AMI ID in SSM.
# This AMI has Docker and the ECS agent pre-installed and pre-configured.
# Reading it from SSM means we always get the latest patched version automatically.

data "aws_ssm_parameter" "ecs_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2/recommended/image_id"
}

# ── Launch Template ───────────────────────────────────────────────────────────
# Defines what every EC2 instance looks like when the Auto Scaling Group creates one.
# Think of it as the "blueprint" for the EC2 instances.

resource "aws_launch_template" "ecs" {
  name_prefix   = "${var.project}-ecs-${var.environment}-"
  image_id      = data.aws_ssm_parameter.ecs_ami.value
  instance_type = "t2.micro" # Free Tier: 750 hours/month for 12 months

  iam_instance_profile {
    name = aws_iam_instance_profile.ecs_instance.name
  }

  # ECS security group: inbound from ALB only, all outbound allowed
  vpc_security_group_ids = [aws_security_group.ecs.id]

  # user_data runs once on first boot.
  # Tells the ECS agent which cluster this instance belongs to.
  # Without this the instance boots normally but ECS never picks it up.
  user_data = base64encode(<<-EOF
    #!/bin/bash
    echo ECS_CLUSTER=${aws_ecs_cluster.main.name} >> /etc/ecs/ecs.config
    echo ECS_ENABLE_TASK_IAM_ROLE=true >> /etc/ecs/ecs.config
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name        = "${var.project}-ecs-host-${var.environment}"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ── Auto Scaling Group ────────────────────────────────────────────────────────
# Manages the pool of EC2 instances for ECS.
# For dev: min=max=desired=1 — always exactly one t2.micro instance.
# For production: increase max to allow horizontal scaling during traffic spikes.
#
# Placed in the public subnet so the EC2 instance can reach:
#   - ECS control plane (to register and receive task assignments)
#   - ECR (to pull Docker images) — also covered by VPC endpoints as backup

resource "aws_autoscaling_group" "ecs" {
  name                = "${var.project}-ecs-asg-${var.environment}"
  min_size            = 1
  max_size            = 1
  desired_capacity    = 1
  vpc_zone_identifier = [aws_subnet.public.id]

  launch_template {
    id      = aws_launch_template.ecs.id
    version = "$Latest"
  }

  # AmazonECSManaged tag is REQUIRED for the ECS capacity provider to manage this ASG.
  # Without it, ECS cannot scale the ASG or track instance availability.
  tag {
    key                 = "AmazonECSManaged"
    value               = ""
    propagate_at_launch = true
  }

  lifecycle {
    create_before_destroy = true
  }
}
