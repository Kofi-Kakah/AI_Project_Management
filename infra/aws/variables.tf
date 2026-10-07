variable "aws_region" {
  description = "AWS region for the application and managed data services."
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Lowercase prefix used in AWS resource names."
  type        = string
  default     = "ai-project-management"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,31}$", var.name_prefix))
    error_message = "name_prefix must be 3-32 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "frontend_url" {
  description = "Public frontend URL used in application configuration."
  type        = string
}

variable "cors_origin" {
  description = "Allowed browser origin for the frontend."
  type        = string
}

variable "google_callback_uri" {
  description = "Optional Google OAuth callback URL. Defaults to the generated API URL."
  type        = string
  default     = ""
}

variable "runtime_secrets" {
  description = "Application secrets stored in AWS Secrets Manager."
  type = object({
    jwt_access_token_secret  = string
    jwt_refresh_token_secret = string
    cookie_secret            = string
    google_client_id         = optional(string, "")
    google_client_secret     = optional(string, "")
    email_host               = optional(string, "")
    email_username           = optional(string, "")
    email_password           = optional(string, "")
    email_from               = optional(string, "")
    stripe_secret_key        = optional(string, "")
    stripe_webhook_secret    = optional(string, "")
    stripe_price_pro         = optional(string, "")
    stripe_price_premium     = optional(string, "")
    sentry_dsn               = optional(string, "")
    anthropic_api_key        = optional(string, "")
    gemini_api_key           = optional(string, "")
  })
  sensitive = true

  validation {
    condition = alltrue([
      length(var.runtime_secrets.jwt_access_token_secret) >= 32,
      length(var.runtime_secrets.jwt_refresh_token_secret) >= 32,
      length(var.runtime_secrets.cookie_secret) >= 32,
    ])
    error_message = "JWT and cookie secrets must each contain at least 32 characters."
  }
}

variable "postgres_instance_class" {
  description = "RDS PostgreSQL instance size."
  type        = string
  default     = "db.t4g.micro"
}

variable "redis_node_type" {
  description = "ElastiCache Redis node size."
  type        = string
  default     = "cache.t4g.micro"
}

variable "task_cpu" {
  description = "Fargate task CPU units for both API and worker."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB for both API and worker."
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Number of API tasks after deploy_services is enabled."
  type        = number
  default     = 1
}

variable "worker_desired_count" {
  description = "Number of background worker tasks after deploy_services is enabled."
  type        = number
  default     = 1
}

variable "deploy_services" {
  description = "Start API and worker tasks after the image is pushed and migrations are applied."
  type        = bool
  default     = false
}

variable "image_tag" {
  description = "ECR image tag used by the API, worker, and migration task definitions."
  type        = string
  default     = "latest"
}

variable "database_deletion_protection" {
  description = "Protect the RDS instance from accidental deletion."
  type        = bool
  default     = true
}
