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

`infra/aws` defines a test-oriented AWS deployment in `us-east-1`: ECS/Fargate
for the API and worker, an internet-facing HTTP Application Load Balancer, and
private RDS PostgreSQL and ElastiCache Redis resources. Database and Redis
credentials are generated and kept in Secrets Manager; application secrets
are supplied through the sensitive `runtime_secrets` Terraform variable. Set
`runtime_secrets.glm_api_key` to enable Gemini task summaries and subtask
generation; the ECS API and worker use `GLM_MODEL=gemini-2.5-flash`.

This configuration intentionally uses HTTP because no custom domain or ACM
certificate was provided. Do not use the public endpoint for production until
HTTPS is configured; in production mode, the refresh cookie is marked secure
and therefore requires HTTPS. The VPC includes a NAT Gateway, and the ALB, NAT
Gateway, RDS, ElastiCache, Fargate tasks, and logs incur AWS charges. Review the
plan and AWS pricing before applying. Use an encrypted remote Terraform state
backend with restricted access before storing real secrets in Terraform state.

From `infra/aws`, copy `terraform.tfvars.example` to `terraform.tfvars` and
replace the sample secrets with unique values. Do not commit the resulting
file or Terraform state; real secrets are present in state. Establish an
encrypted, access-controlled remote state backend before using real
credentials. Then:

1. Run `terraform init` and review `terraform plan`; apply only after checking
   the resources and estimated charges.
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
4. Set `deploy_services = true` in `terraform.tfvars`, apply again, and check
   the API target health and worker logs in ECS.

Keep the database deletion protection enabled by default. To tear down a test
environment, first set `deploy_services = false`, apply, then deliberately
disable database deletion protection and review the final-snapshot behavior
before destroying the stack.
