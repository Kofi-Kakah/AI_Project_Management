# Deployment

`Dockerfile` builds one production image for both the API and the BullMQ worker.
The default `compose.yaml` is for local development and starts local PostgreSQL
and Redis containers. For environments with managed PostgreSQL and Redis, use
`compose.managed.yaml`; set `MANAGED_DATABASE_URL` and `MANAGED_REDIS_URL` to
provider-issued connection strings, along with the required application
secrets and public URLs.

The managed compose file runs `prisma migrate deploy` before starting the API
and worker. It does not provision database or Redis resources: create those in
your cloud provider first, enable TLS and network access restrictions, then set
their connection strings through a secret manager or deployment environment.

Build and start with:

```sh
docker compose -f compose.managed.yaml build
docker compose -f compose.managed.yaml up -d
```

The API exposes Prometheus metrics at `/metrics` and a dependency readiness
check at `/health`. The worker shares the API image but runs
`dist/src/jobs/worker.js` instead of the HTTP server.

## AWS ECS/Fargate

`infra/aws` defines an AWS deployment in `us-east-1`: ECS/Fargate for the API
and worker, an internet-facing Application Load Balancer with HTTPS termination
and HTTP-to-HTTPS redirects, and private RDS PostgreSQL and ElastiCache Redis
resources. Database and Redis
credentials are generated and kept in Secrets Manager; application secrets
are supplied through the sensitive `runtime_secrets` Terraform variable. Set
`runtime_secrets.glm_api_key` to enable Gemini task summaries and subtask
generation; the ECS API and worker use `GLM_MODEL=gemini-2.5-flash`.

Before applying, provide a DNS hostname in `app_domain` and an issued ACM
certificate ARN in `acm_certificate_arn`. The certificate must cover the API
hostname and be in the same AWS region as the load balancer. After provisioning,
create a DNS alias/CNAME from `app_domain` to the Terraform output
`load_balancer_dns_name`. The HTTP listener only redirects to HTTPS; authenticated
API traffic is forwarded through TLS. In production mode, the refresh cookie is
also marked secure. The VPC includes a NAT Gateway, and the ALB, NAT Gateway,
RDS, ElastiCache, Fargate tasks, and logs incur AWS charges. Review the plan and
AWS pricing before applying. Use an encrypted remote Terraform state backend
with restricted access before storing real secrets in Terraform state.

From `infra/aws`, copy `terraform.tfvars.example` to `terraform.tfvars` and
replace the sample secrets with unique values. Do not commit the resulting
file or Terraform state; real secrets are present in state. Establish an
encrypted, access-controlled remote state backend before using real
credentials. Then:

1. Request and validate the ACM certificate for `app_domain`, create the
   required DNS validation records, then set `app_domain` and
   `acm_certificate_arn` in `terraform.tfvars`. Run `terraform init` and review
   `terraform plan`; apply only after checking the resources and estimated
   charges.
2. From the repository root, authenticate Docker to ECR and push the shared
   image:

   ```powershell
   $ecr = terraform -chdir=infra/aws output -raw ecr_repository_url
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ecr
   docker build -t "${ecr}:latest" .
   docker push "${ecr}:latest"
   ```

3. Run the `migration_task_definition` once in the ECS console as a Fargate
   task, using the output private subnets and application security group. The
   task definition runs `npx prisma migrate deploy`; wait for exit code 0.
4. Create the DNS alias/CNAME from `app_domain` to the Terraform output
   `load_balancer_dns_name`. Set `deploy_services = true` in `terraform.tfvars`,
   apply again, and check the API target health and worker logs in ECS. The API
   is available at the `api_url` Terraform output after DNS propagates.

Keep the database deletion protection enabled by default. To tear down a test
environment, first set `deploy_services = false`, apply, then deliberately
disable database deletion protection and review the final-snapshot behavior
before destroying the stack.
