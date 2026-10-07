terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name               = var.name_prefix
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 2)
  app_url            = "https://${var.app_domain}"

  app_secret_values = {
    DATABASE_URL             = "postgresql://app:${random_password.database.result}@${aws_db_instance.database.address}:5432/ai_project_management?schema=public&sslmode=require"
    REDIS_URL                = "rediss://:${random_password.redis.result}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
    JWT_ACCESS_TOKEN_SECRET  = var.runtime_secrets.jwt_access_token_secret
    JWT_REFRESH_TOKEN_SECRET = var.runtime_secrets.jwt_refresh_token_secret
    COOKIE_SECRET            = var.runtime_secrets.cookie_secret
    GOOGLE_CLIENT_ID         = var.runtime_secrets.google_client_id
    GOOGLE_CLIENT_SECRET     = var.runtime_secrets.google_client_secret
    EMAIL_HOST               = var.runtime_secrets.email_host
    EMAIL_USERNAME           = var.runtime_secrets.email_username
    EMAIL_PASSWORD           = var.runtime_secrets.email_password
    EMAIL_FROM               = var.runtime_secrets.email_from
    STRIPE_SECRET_KEY        = var.runtime_secrets.stripe_secret_key
    STRIPE_WEBHOOK_SECRET    = var.runtime_secrets.stripe_webhook_secret
    STRIPE_PRICE_PRO         = var.runtime_secrets.stripe_price_pro
    STRIPE_PRICE_PREMIUM     = var.runtime_secrets.stripe_price_premium
    SENTRY_DSN               = var.runtime_secrets.sentry_dsn
    GLM_API_KEY              = var.runtime_secrets.glm_api_key
  }

  api_secrets = [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_ACCESS_TOKEN_SECRET",
    "JWT_REFRESH_TOKEN_SECRET",
    "COOKIE_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "EMAIL_HOST",
    "EMAIL_USERNAME",
    "EMAIL_PASSWORD",
    "EMAIL_FROM",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_PREMIUM",
    "SENTRY_DSN",
    "GLM_API_KEY",
  ]

  worker_secrets = [
    "DATABASE_URL",
    "REDIS_URL",
    "EMAIL_HOST",
    "EMAIL_USERNAME",
    "EMAIL_PASSWORD",
    "EMAIL_FROM",
    "GLM_API_KEY",
  ]
}

resource "aws_vpc" "app" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id

  tags = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.app.id
  availability_zone       = local.availability_zones[count.index]
  cidr_block              = "10.40.${count.index}.0/24"
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public-${count.index + 1}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.app.id
  availability_zone = local.availability_zones[count.index]
  cidr_block        = "10.40.${count.index + 10}.0/24"

  tags = { Name = "${local.name}-private-${count.index + 1}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.app.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = { Name = "${local.name}-nat" }
}

resource "aws_nat_gateway" "app" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  depends_on = [aws_internet_gateway.app]
  tags       = { Name = "${local.name}-nat" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.app.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.app.id
  }

  tags = { Name = "${local.name}-private" }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "load_balancer" {
  name        = "${local.name}-alb"
  description = "Public HTTP redirect and HTTPS ingress to the application load balancer"
  vpc_id      = aws_vpc.app.id

  ingress {
    description = "Redirect HTTP clients to HTTPS"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS application traffic"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "application" {
  name        = "${local.name}-app"
  description = "Application tasks accept traffic only from the load balancer"
  vpc_id      = aws_vpc.app.id

  ingress {
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.load_balancer.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "database" {
  name        = "${local.name}-postgres"
  description = "PostgreSQL is reachable only from application tasks"
  vpc_id      = aws_vpc.app.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.application.id]
  }
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "Redis is reachable only from application tasks"
  vpc_id      = aws_vpc.app.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.application.id]
  }
}

resource "aws_db_subnet_group" "app" {
  name       = "${local.name}-postgres"
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "database" {
  length  = 40
  special = false
}

resource "random_id" "final_snapshot" {
  byte_length = 4
}

resource "aws_db_instance" "database" {
  identifier                   = "${local.name}-postgres"
  engine                       = "postgres"
  instance_class               = var.postgres_instance_class
  allocated_storage            = 20
  max_allocated_storage        = 100
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "ai_project_management"
  username                     = "app"
  password                     = random_password.database.result
  port                         = 5432
  db_subnet_group_name         = aws_db_subnet_group.app.name
  vpc_security_group_ids       = [aws_security_group.database.id]
  backup_retention_period      = 7
  auto_minor_version_upgrade   = true
  deletion_protection          = var.database_deletion_protection
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${local.name}-final-${random_id.final_snapshot.hex}"
  publicly_accessible          = false
  performance_insights_enabled = false
}

resource "aws_elasticache_subnet_group" "app" {
  name       = "${local.name}-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "redis" {
  length  = 40
  special = false
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${local.name}-redis"
  description                = "BullMQ and application Redis"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 1
  port                       = 6379
  parameter_group_name       = "default.redis7"
  subnet_group_name          = aws_elasticache_subnet_group.app.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result
  automatic_failover_enabled = false
  multi_az_enabled           = false
}

resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${local.name}/runtime"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "runtime" {
  secret_id     = aws_secretsmanager_secret.runtime.id
  secret_string = jsonencode(local.app_secret_values)
}

resource "aws_ecr_repository" "app" {
  name                 = local.name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "app" {
  name = local.name
}

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "read_runtime_secrets" {
  name = "${local.name}-read-runtime-secrets"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.runtime.arn
    }]
  })
}

resource "aws_lb" "app" {
  name               = substr("${local.name}-alb", 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.load_balancer.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "app" {
  name        = substr("${local.name}-api", 0, 32)
  port        = 4000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.app.id

  health_check {
    enabled             = true
    path                = "/health"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.acm_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn

  depends_on = [aws_secretsmanager_secret_version.runtime]

  container_definitions = jsonencode([{
    name      = "api"
    image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
    essential = true
    portMappings = [{
      containerPort = 4000
      hostPort      = 4000
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "4000" },
      { name = "APP_URL", value = local.app_url },
      { name = "FRONTEND_URL", value = var.frontend_url },
      { name = "CORS_ORIGIN", value = var.cors_origin },
      { name = "GOOGLE_CALLBACK_URI", value = var.google_callback_uri != "" ? var.google_callback_uri : "${local.app_url}/auth/google/callback" },
      { name = "EMAIL_PORT", value = "587" },
      { name = "JWT_ACCESS_TOKEN_EXPIRATION", value = "15m" },
      { name = "JWT_REFRESH_TOKEN_EXPIRATION", value = "7d" },
      { name = "GLM_MODEL", value = "gemini-2.5-flash" },
      { name = "LOG_LEVEL", value = "info" },
    ]
    secrets = [
      for key in local.api_secrets : {
        name      = key
        valueFrom = "${aws_secretsmanager_secret.runtime.arn}:${key}::"
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn

  depends_on = [aws_secretsmanager_secret_version.runtime]

  container_definitions = jsonencode([{
    name      = "worker"
    image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
    essential = true
    command   = ["node", "dist/src/jobs/worker.js"]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "APP_URL", value = local.app_url },
      { name = "FRONTEND_URL", value = var.frontend_url },
      { name = "EMAIL_PORT", value = "587" },
      { name = "GLM_MODEL", value = "gemini-2.5-flash" },
      { name = "LOG_LEVEL", value = "info" },
    ]
    secrets = [
      for key in local.worker_secrets : {
        name      = key
        valueFrom = "${aws_secretsmanager_secret.runtime.arn}:${key}::"
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "worker"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "migration" {
  family                   = "${local.name}-migration"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn

  depends_on = [aws_secretsmanager_secret_version.runtime]

  container_definitions = jsonencode([{
    name      = "migration"
    image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
    essential = true
    command   = ["npx", "prisma", "migrate", "deploy"]
    secrets = [{
      name      = "DATABASE_URL"
      valueFrom = "${aws_secretsmanager_secret.runtime.arn}:DATABASE_URL::"
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "migration"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.deploy_services ? var.api_desired_count : 0
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.application.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "api"
    container_port   = 4000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [
    aws_iam_role_policy_attachment.execution,
    aws_iam_role_policy.read_runtime_secrets,
    aws_lb_listener.http,
    aws_lb_listener.https,
  ]
}

resource "aws_ecs_service" "worker" {
  name            = "${local.name}-worker"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.deploy_services ? var.worker_desired_count : 0
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.application.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [
    aws_iam_role_policy_attachment.execution,
    aws_iam_role_policy.read_runtime_secrets,
  ]
}
