output "api_url" {
  description = "Public HTTPS endpoint for the API; configure DNS to point app_domain at the load balancer."
  value       = "https://${var.app_domain}"
}

output "load_balancer_dns_name" {
  description = "ALB DNS name; create a DNS alias/CNAME from app_domain to this hostname."
  value       = aws_lb.app.dns_name
}

output "ecr_repository_url" {
  description = "ECR repository for the shared API and worker image."
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.app.name
}

output "migration_task_definition" {
  value = aws_ecs_task_definition.migration.family
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "application_security_group_id" {
  value = aws_security_group.application.id
}
