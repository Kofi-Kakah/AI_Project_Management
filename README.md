<div align="center">

# AI Project Management API

**A multi-tenant project-management backend for organizations, teams, projects, tasks, collaboration, subscriptions, and asynchronous AI assistance.**

Built with **Node.js**, **TypeScript**, **Express 5**, **PostgreSQL**, and **Prisma ORM 7**.

[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socketdotio&logoColor=white)](https://socket.io/)
[![Docker](https://img.shields.io/badge/Docker-containerized-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![AWS](https://img.shields.io/badge/AWS-deployment-232F3E?logo=amazonwebservices&logoColor=white)](https://aws.amazon.com/)
[![Stripe](https://img.shields.io/badge/Stripe-billing-635BFF?logo=stripe&logoColor=white)](https://stripe.com/)
[![Redis](https://img.shields.io/badge/Redis-queue%20%26%20cache-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-background%20jobs-CB3837)](https://bullmq.io/)
[![Nodemailer](https://img.shields.io/badge/Nodemailer-email-22A7F0)](https://nodemailer.com/)
[![Sentry](https://img.shields.io/badge/Sentry-monitoring-362D59?logo=sentry&logoColor=white)](https://sentry.io/)
[![Zod](https://img.shields.io/badge/Zod-validation-3E67B1)](https://zod.dev/)

[Features](#features) · [Quick Start](#quick-start) · [API Reference](#api-reference) · [Architecture](#architecture) · [Deployment](#deployment)

</div>

## Table of Contents

- [Features](#features)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Data Model](#data-model)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Authentication and Authorization](#authentication-and-authorization)
- [Real-Time Events](#real-time-events)
- [Plans, Billing, and Usage](#plans-billing-and-usage)
- [Asynchronous AI Jobs](#asynchronous-ai-jobs)
- [Health, Metrics, and Logging](#health-metrics-and-logging)
- [Testing](#testing)
- [Docker](#docker)
- [Deployment](#deployment)
- [Security and Operations](#security-and-operations)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Multi-tenant organizations** with invitations, memberships, roles, and organization-scoped data access.
- **Teams and projects** with organization-bound associations, project dates, archiving, and pagination.
- **Task management** with statuses, priorities, assignees, due dates, parent/subtask hierarchies, comments, and activity history.
- **Tenant isolation** applied to organization resources and relational writes; cross-organization task access is tested to return `404`.
- **Authentication** using email/password, signed short-lived access tokens, rotating opaque refresh tokens in an HTTP-only cookie, email verification and password-reset flows, and optional Google OAuth.
- **Real-time collaboration** through Socket.IO, with organization/project rooms and Redis-backed fan-out.
- **Subscriptions and usage limits** for Free, Pro, and Premium plans using Stripe checkout, billing portal, signed webhooks, and recorded usage.
- **Asynchronous AI task assistance** for task summaries and subtask suggestions, processed by a BullMQ worker using Anthropic.
- **Platform administration** with `/admin/stats`, protected by the platform-admin user flag.
- **Operational endpoints** for dependency health (`/health`) and Prometheus metrics (`/metrics`).
- **Container support** with a multi-stage image shared by the API and worker.

## Technology Stack

| Area                   | Technology                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Runtime                | Node.js 22 (Docker image); TypeScript                                                    |
| HTTP API               | Express 5                                                                                |
| Database               | PostgreSQL                                                                               |
| ORM and migrations     | Prisma ORM 7, `@prisma/adapter-pg`                                                       |
| Queue and cache        | Redis, BullMQ, ioredis                                                                   |
| Real-time              | Socket.IO and `@socket.io/redis-adapter`                                                 |
| Authentication         | JWT access tokens, opaque refresh tokens, Argon2 password hashing, Passport Google OAuth |
| Payments               | Stripe                                                                                   |
| AI provider            | Anthropic SDK                                                                            |
| Validation             | Zod                                                                                      |
| Metrics                | `prom-client`                                                                            |
| Logging                | Pino and `pino-http`                                                                     |
| Tests                  | Vitest and Supertest                                                                     |
| Containers             | Docker, Docker Compose                                                                   |
| AWS deployment example | Terraform, ECS/Fargate, RDS PostgreSQL, ElastiCache Redis                                |

## Architecture

```text
                         ┌───────────────────────┐
                         │      API clients      │
                         └───────────┬───────────┘
                                     │ HTTP / Socket.IO
                         ┌───────────▼───────────┐
                         │ Express API + Socket.IO│
                         │ auth, validation, RBAC │
                         └──────┬─────────┬──────┘
                                │         │
                   ┌────────────▼─┐   ┌───▼─────────────────┐
                   │ PostgreSQL   │   │ Redis                │
                   │ Prisma       │   │ cache, BullMQ,       │
                   │ tenant data  │   │ Socket.IO adapter    │
                   └──────────────┘   └──────────┬───────────┘
                                                 │ AI/email jobs
                                      ┌──────────▼───────────┐
                                      │ Background worker    │
                                      │ BullMQ processors    │
                                      └──────────┬───────────┘
                                                 │
                                      ┌──────────▼───────────┐
                                      │ Anthropic / email    │
                                      └──────────────────────┘
```

The API and worker are separate processes. They can run from the same Docker
image, but both require access to the same PostgreSQL database and Redis
instance. Schema changes are managed as checked-in Prisma migrations.

## Data Model

The primary entities defined in `prisma/schema.prisma` are:

- **User** and **RefreshToken** — account identity, password/OAuth information, platform-admin status, and refresh-session tracking.
- **Organization** and **Membership** — tenant boundary, membership state, and `OWNER`, `ADMIN`, or `MEMBER` role.
- **Team** and **TeamMembership** — organization teams and team assignments.
- **Project** and **Task** — organization-owned projects and tasks; tasks support parent-child hierarchies and assignees.
- **Comment**, **Notification**, and **ActivityLog** — collaboration and audit/activity history.
- **Subscription** and **UsageRecord** — billing state and metered usage.
- **AiRequest** — queued/running/completed AI requests, result/error, and token/cost metadata.

Foreign keys and organization-aware composite keys help ensure that related
records stay within their tenant.

## Project Structure

```text
.
├── prisma/
│   ├── migrations/              # Database migration history
│   └── schema.prisma            # PostgreSQL data model
├── src/
│   ├── app.ts                   # Express middleware, health, metrics, routes
│   ├── server.ts                # HTTP server, Socket.IO, graceful shutdown
│   ├── config/                  # Environment, Prisma, Redis, Stripe, Anthropic
│   ├── jobs/                    # BullMQ queues and worker processors
│   ├── metrics/                 # Prometheus registry and HTTP metrics
│   ├── middleware/              # Auth, validation, RBAC, quotas, rate limits
│   ├── modules/                 # Feature modules and route handlers
│   ├── realtime/                # Socket.IO events and Redis adapter
│   └── utils/                   # Tokens, logging, mail, pagination, errors
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── infra/aws/                   # Example Terraform deployment for AWS
├── Dockerfile
├── compose.yaml
├── compose.managed.yaml
└── DEPLOYING.md
```

## Requirements

- Node.js 22 and npm (Node.js 20.19 or newer is required by the Prisma 7 toolchain; Node.js 22 is the recommended project runtime).
- PostgreSQL 17 for the supplied local Compose environment.
- Redis 7 for the supplied local Compose environment.
- Docker Desktop / Docker Engine with the Compose plugin, if using containers.

External integrations are optional for local development, but their features
remain unavailable until configured. Production JWT access-token signing
requires a secret of at least 32 characters.

## Quick Start

### Option A: Docker Compose

From the repository root:

```bash
docker compose up --build
```

This starts PostgreSQL, Redis, a one-shot migration service, the API, and the
background worker. The API is published on `http://localhost:4000`.

For a different local port, set `PORT` before starting Compose. Database
credentials and service URLs can also be overridden with the variables in
`compose.yaml`; do not use the Compose development defaults outside local
development.

### Option B: Run Node processes locally

1. Install dependencies and prepare the environment file:

   ```bash
   npm ci
   Copy-Item .env.example .env
   ```

   On macOS/Linux, use `cp .env.example .env` instead of `Copy-Item`.

2. Start PostgreSQL and Redis. For example, start just those dependencies from
   the supplied Compose file:

   ```bash
   docker compose up -d postgres redis
   ```

3. Edit `.env`. At minimum, set `DATABASE_URL` to your PostgreSQL database,
   set `REDIS_URL`, and provide a strong `JWT_ACCESS_TOKEN_SECRET` of at least
   32 characters.

4. Generate Prisma Client, apply migrations, and build:

   ```bash
   npx prisma generate
   npx prisma migrate deploy
   npm run build
   ```

5. Start the API and worker in separate terminals:

   ```bash
   npm run dev
   ```

   ```bash
   npm run worker
   ```

The API listens at `http://localhost:4000` by default. The root `/health`
endpoint checks database and Redis connectivity.

## Environment Variables

Copy `.env.example` to `.env` for local development. **Never commit `.env`,
Terraform state, or real credentials.** The variables below are read from
`src/config/env.ts`; “optional” means the application schema permits it to be
unset, not that the corresponding integration will work without it.

| Variable                       |           Required | Purpose                                                                                                                               |
| ------------------------------ | -----------------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                     |                 No | `development`, `test`, or `production`; defaults to `development`. Production enables secure refresh cookies.                         |
| `PORT`                         |                 No | HTTP listen port; defaults to `4000`.                                                                                                 |
| `APP_URL`                      |                 No | Public API base URL; defaults to `http://localhost:4000`.                                                                             |
| `FRONTEND_URL`                 |                 No | Frontend URL used for OAuth failure redirects; defaults to `http://localhost:3000`.                                                   |
| `CORS_ORIGIN`                  |                 No | Allowed browser origin(s), comma-separated; defaults to `http://localhost:3000`.                                                      |
| `DATABASE_URL`                 |            **Yes** | PostgreSQL connection string used by Prisma.                                                                                          |
| `REDIS_URL`                    |                 No | Redis connection URL; defaults to `redis://localhost:6379`. Use `rediss://` when the managed Redis provider requires TLS.             |
| `JWT_ACCESS_TOKEN_SECRET`      | **Yes at runtime** | Signs API access tokens; must be at least 32 characters.                                                                              |
| `JWT_ACCESS_TOKEN_EXPIRATION`  |                 No | Access-token lifetime, such as `15m`; defaults to `15m`.                                                                              |
| `JWT_REFRESH_TOKEN_EXPIRATION` |                 No | Refresh-session lifetime, such as `7d`; defaults to `7d`.                                                                             |
| `JWT_REFRESH_TOKEN_SECRET`     |                 No | Reserved in the current configuration; refresh tokens are opaque random values stored as hashes and are not signed with this setting. |
| `COOKIE_SECRET`                |                 No | Reserved in the current configuration; the refresh cookie is HTTP-only and is not signed with this setting.                           |
| `GOOGLE_CLIENT_ID`             |                 No | Google OAuth client ID.                                                                                                               |
| `GOOGLE_CLIENT_SECRET`         |                 No | Google OAuth client secret.                                                                                                           |
| `GOOGLE_CALLBACK_URI`          |                 No | Google OAuth callback URL; defaults to `http://localhost:4000/auth/google/callback`.                                                  |
| `EMAIL_HOST`                   |                 No | SMTP hostname for email workflows.                                                                                                    |
| `EMAIL_PORT`                   |                 No | SMTP port; defaults to `587`.                                                                                                         |
| `EMAIL_USERNAME`               |                 No | SMTP username.                                                                                                                        |
| `EMAIL_PASSWORD`               |                 No | SMTP password.                                                                                                                        |
| `EMAIL_FROM`                   |                 No | Sender address used for application email.                                                                                            |
| `STRIPE_SECRET_KEY`            |                 No | Stripe API secret for checkout, portal, and webhook processing.                                                                       |
| `STRIPE_WEBHOOK_SECRET`        |                 No | Stripe signing secret used to verify `/billing/webhook`.                                                                              |
| `STRIPE_PRICE_PRO`             |                 No | Stripe Price ID mapped to the Pro plan.                                                                                               |
| `STRIPE_PRICE_PREMIUM`         |                 No | Stripe Price ID mapped to the Premium plan.                                                                                           |
| `ANTHROPIC_API_KEY`            |                 No | Enables queued AI task summaries and subtask generation.                                                                              |
| `ANTHROPIC_MODEL`              |                 No | Anthropic model; defaults to `claude-haiku-4-5-20251001`.                                                                             |
| `GEMINI_API_KEY`               |                 No | Present in configuration but not currently used by the AI feature implementation.                                                     |
| `GEMINI_BASE_URL`              |                 No | Present in configuration but not currently used by the AI feature implementation.                                                     |
| `GEMINI_MODEL`                 |                 No | Present in configuration but not currently used by the AI feature implementation.                                                     |
| `SENTRY_DSN`                   |                 No | Sentry DSN configuration.                                                                                                             |
| `LOG_LEVEL`                    |                 No | Pino log level; defaults to `debug` in the application schema.                                                                        |

The managed-services Compose profile uses additional deployment variables:

| Variable               | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `MANAGED_DATABASE_URL` | TLS-enabled connection string for externally provisioned PostgreSQL. |
| `MANAGED_REDIS_URL`    | TLS-enabled Redis URL for externally provisioned Redis.              |
| `IMAGE_TAG`            | Shared image tag for API and worker; defaults to `local`.            |

That profile requires the API URL, frontend URL, CORS origin, and JWT/cookie
secrets to be explicitly set. `compose.yaml` has local-only fallback secrets;
never reuse those fallback values in a real environment.

## API Reference

All routes are mounted at the root; there is no `/api/v1` prefix. JSON request
bodies should use `Content-Type: application/json`. Protected HTTP routes accept
`Authorization: Bearer <accessToken>`, except refresh/logout, which use the
HTTP-only refresh-token cookie.

### Health and operations

| Method | Path       | Access                        | Purpose                                                                                              |
| ------ | ---------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET`  | `/health`  | Public                        | Checks PostgreSQL and Redis; returns `200` when both are available, otherwise `503`.                 |
| `GET`  | `/metrics` | Public by application routing | Prometheus exposition text. Restrict access at the network/proxy layer if metrics should be private. |

### Authentication

| Method | Path                           | Access                  | Purpose                                                     |
| ------ | ------------------------------ | ----------------------- | ----------------------------------------------------------- |
| `POST` | `/auth/register`               | Public                  | Create an account; expects `name`, `email`, and `password`. |
| `POST` | `/auth/login`                  | Public                  | Sign in; returns an access token and sets a refresh cookie. |
| `POST` | `/auth/refresh`                | Refresh cookie          | Rotate a refresh token and issue a new access token.        |
| `POST` | `/auth/logout`                 | Refresh cookie          | Revoke the refresh session and clear its cookie.            |
| `GET`  | `/auth/me`                     | Authenticated           | Return the current user.                                    |
| `GET`  | `/auth/verify-email?token=...` | Public                  | Verify an email address.                                    |
| `POST` | `/auth/resend-verification`    | Public                  | Request another verification email; expects `email`.        |
| `POST` | `/auth/forgot-password`        | Public                  | Start password reset; expects `email`.                      |
| `POST` | `/auth/reset-password`         | Public                  | Complete password reset; expects `token` and `newPassword`. |
| `GET`  | `/auth/google`                 | Public, when configured | Start Google OAuth.                                         |
| `GET`  | `/auth/google/callback`        | OAuth callback          | Complete Google OAuth.                                      |

### Organizations and members

| Method  | Path                                                              | Purpose                                                                |
| ------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `POST`  | `/organizations`                                                  | Create an organization; expects `name`.                                |
| `GET`   | `/organizations`                                                  | List organizations available to the current user.                      |
| `GET`   | `/organizations/invitations`                                      | List the current user's invitations.                                   |
| `GET`   | `/organizations/:organizationId`                                  | Get an organization.                                                   |
| `GET`   | `/organizations/:organizationId/members`                          | List members.                                                          |
| `POST`  | `/organizations/:organizationId/invitations`                      | Invite an email as `ADMIN` or `MEMBER`; organization owner/admin only. |
| `POST`  | `/organizations/:organizationId/invitations/:membershipId/accept` | Accept an invitation.                                                  |
| `PATCH` | `/organizations/:organizationId/members/:membershipId/role`       | Change a member to `ADMIN` or `MEMBER`; organization owner/admin only. |

### Teams and projects

Every route in this section is scoped to an organization and requires an active
organization membership.

| Method   | Path                                                 | Purpose                                   |
| -------- | ---------------------------------------------------- | ----------------------------------------- |
| `GET`    | `/organizations/:organizationId/teams`               | List teams.                               |
| `POST`   | `/organizations/:organizationId/teams`               | Create a team.                            |
| `GET`    | `/organizations/:organizationId/teams/:teamId`       | Get a team.                               |
| `PATCH`  | `/organizations/:organizationId/teams/:teamId`       | Update a team.                            |
| `DELETE` | `/organizations/:organizationId/teams/:teamId`       | Delete a team.                            |
| `GET`    | `/organizations/:organizationId/projects`            | List projects.                            |
| `POST`   | `/organizations/:organizationId/projects`            | Create a project; subject to plan limits. |
| `GET`    | `/organizations/:organizationId/projects/:projectId` | Get a project.                            |
| `PATCH`  | `/organizations/:organizationId/projects/:projectId` | Update a project.                         |
| `DELETE` | `/organizations/:organizationId/projects/:projectId` | Delete a project.                         |

List endpoints use `page` and `pageSize`; the maximum page size is 100. See
each route's Zod schema under `src/modules/` for accepted fields and validation
rules.

### Tasks and comments

Task status values are `BACKLOG`, `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`,
and `CANCELED`. Priority values are `LOW`, `MEDIUM`, `HIGH`, and `URGENT`.
Task lists also accept `status`, `priority`, `assigneeId`, and `parentId`
filters.

| Method   | Path                                                       | Purpose                                                   |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `GET`    | `/organizations/:organizationId/projects/:projectId/tasks` | List project tasks.                                       |
| `POST`   | `/organizations/:organizationId/projects/:projectId/tasks` | Create a project task or subtask; subject to plan limits. |
| `GET`    | `/organizations/:organizationId/tasks/:taskId`             | Get a task.                                               |
| `PATCH`  | `/organizations/:organizationId/tasks/:taskId`             | Update a task.                                            |
| `DELETE` | `/organizations/:organizationId/tasks/:taskId`             | Delete a task.                                            |
| `GET`    | `/organizations/:organizationId/tasks/:taskId/comments`    | List comments on a task.                                  |
| `POST`   | `/organizations/:organizationId/tasks/:taskId/comments`    | Add a comment.                                            |
| `PATCH`  | `/organizations/:organizationId/comments/:commentId`       | Edit a comment (author or organization admin).            |
| `DELETE` | `/organizations/:organizationId/comments/:commentId`       | Delete a comment.                                         |

### Billing, AI, and administration

| Method | Path                                                       | Access                     | Purpose                                                   |
| ------ | ---------------------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| `GET`  | `/billing/plans`                                           | Public                     | Return the plan catalog and configured plan availability. |
| `POST` | `/billing/webhook`                                         | Stripe signature           | Verify and process Stripe webhook events.                 |
| `GET`  | `/organizations/:organizationId/billing/subscription`      | Organization owner/admin   | Get the subscription.                                     |
| `POST` | `/organizations/:organizationId/billing/checkout`          | Organization owner/admin   | Create a checkout session for a paid plan.                |
| `POST` | `/organizations/:organizationId/billing/portal`            | Organization owner/admin   | Create a Stripe billing portal session.                   |
| `POST` | `/organizations/:organizationId/ai/tasks/:taskId/summary`  | Organization member        | Queue task-summary generation; returns `202`.             |
| `POST` | `/organizations/:organizationId/ai/tasks/:taskId/subtasks` | Organization member        | Queue subtask generation; returns `202`.                  |
| `GET`  | `/organizations/:organizationId/ai/requests/:requestId`    | Owning organization member | Poll an AI request's status/result.                       |
| `GET`  | `/admin/stats`                                             | Platform admin             | Return platform-wide administrative statistics.           |

For machine-readable request requirements, consult the Zod schemas in
`src/modules/<feature>/*.schema.ts`. Errors are sent through the centralized
error handler; callers should handle non-2xx responses and validation errors.

### Minimal request example

After signing in and receiving an access token, create an organization:

```bash
curl -X POST http://localhost:4000/organizations \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Example Workspace"}'
```

## Authentication and Authorization

- Passwords are hashed with Argon2.
- Access tokens are JWTs signed with `JWT_ACCESS_TOKEN_SECRET`; configure a
  random secret with at least 32 characters.
- Refresh tokens are opaque random values. The server stores their hashes,
  rotates them on refresh, and sends the raw value in an HTTP-only cookie.
- In production, that cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, and
  scoped to `/auth`. Production deployments must use HTTPS for cookie-based
  refresh flows.
- Protected organization routes require active membership. Privileged
  organization actions require `OWNER` or `ADMIN`.
- `/admin/stats` separately requires the authenticated user's
  `isPlatformAdmin` flag.
- Socket.IO connections require a valid access token, and joining an
  organization or project room requires active membership.

## Real-Time Events

The Socket.IO server shares the API's HTTP server and Redis connection. Pass an
access token in either `auth.token` or the `Authorization: Bearer ...`
handshake header.

Clients can request room membership using:

| Client event         | Payload         | Description                                                  |
| -------------------- | --------------- | ------------------------------------------------------------ |
| `organization:join`  | organization ID | Join only if the user is an active member.                   |
| `organization:leave` | organization ID | Leave the organization room.                                 |
| `project:join`       | project ID      | Join only if the user belongs to the project's organization. |
| `project:leave`      | project ID      | Leave the project room.                                      |

Successful room operations acknowledge `{ "ok": true }`; failures include
`INVALID_ARGUMENT`, `FORBIDDEN`, or `INTERNAL_ERROR`.

Server event names include `task:created`, `task:updated`, `task:deleted`,
`comment:created`, `comment:updated`, `comment:deleted`, `project:created`,
`project:updated`, `project:deleted`, `team:created`, `team:updated`,
`team:deleted`, `member:invited`, `member:joined`, and
`member:role-updated`. Events are wrapped with organization/project IDs,
`occurredAt`, and `data`.

## Plans, Billing, and Usage

The current plan limits are configured in
`src/modules/billing/billing.plans.ts`:

| Plan    | Projects per month | Tasks per month | AI requests per month |
| ------- | -----------------: | --------------: | --------------------: |
| Free    |                  3 |             500 |                     0 |
| Pro     |                 20 |           5,000 |                   500 |
| Premium |          Unlimited |       Unlimited |             Unlimited |

Limits and usage accounting are enforced server-side and recorded per
organization. Stripe-backed upgrades require the Stripe secret, webhook
signing secret, and matching configured price IDs. Without Stripe configuration
the plan catalog remains available, but paid checkout/webhook operations cannot
complete.

## Asynchronous AI Jobs

AI summary and subtask requests are queued rather than run in the HTTP request
path. The API responds with `202 Accepted` and an AI request record; poll
`GET /organizations/:organizationId/ai/requests/:requestId` for its status and
result. The worker consumes BullMQ jobs from Redis and calls Anthropic using
`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`.

The request state is `QUEUED`, `PROCESSING`, `SUCCEEDED`, or `FAILED`. AI usage
is checked against the organization's plan and tracked alongside token/cost
metadata. The Free plan has no AI request allowance.

## Health, Metrics, and Logging

- **`GET /health`** checks both PostgreSQL and Redis. It returns `200` with
  dependency status when both checks pass and `503` otherwise.
- **`GET /metrics`** exposes Prometheus process/default metrics plus
  `http_requests_total` and `http_request_duration_seconds`. HTTP metrics are
  labeled by method, matched route template, and status code; requests to
  `/metrics` do not increment these HTTP metrics.
- HTTP request logging and application logging use Pino. Set `LOG_LEVEL` to
  adjust verbosity.
- Configure `SENTRY_DSN` if Sentry reporting is part of your deployment.

Metrics are not authenticated at the application layer. Restrict scrape access
using private networking, a reverse proxy, firewall rules, or a monitoring
gateway when required.

## Testing

```bash
npm test
npm run test:e2e
```

Tests use Vitest. The route integration tests use Supertest; the e2e journey
exercises signup, organization and task workflows, and plan upgrade handling
with external dependencies mocked. It does not replace deployment smoke tests
against a real database, Redis, email provider, or Stripe account.

Useful development commands:

| Command                        | Purpose                                                 |
| ------------------------------ | ------------------------------------------------------- |
| `npm run dev`                  | Start the API in TypeScript watch mode.                 |
| `npm run worker`               | Start the TypeScript BullMQ worker.                     |
| `npm run build`                | Compile TypeScript to `dist/`.                          |
| `npm start`                    | Run the compiled API.                                   |
| `npx prisma generate`          | Generate the Prisma client.                             |
| `npx prisma migrate deploy`    | Apply checked-in migrations to the configured database. |
| `npx prisma validate`          | Validate the Prisma schema.                             |
| `npx prettier --check <paths>` | Check formatting for selected files.                    |

## Docker

The multi-stage `Dockerfile` builds the application and Prisma client, installs
production dependencies in a separate stage, and runs as the non-root `node`
user. API and worker processes use the same runtime image:

```bash
docker build -t ai-project-management:local .
docker run --rm --env-file .env -p 4000:4000 ai-project-management:local
```

To run a worker from that image, override its command:

```bash
docker run --rm --env-file .env \
  ai-project-management:local node dist/src/jobs/worker.js
```

For local development, prefer `docker compose up --build`; Compose coordinates
PostgreSQL, Redis, migrations, API, and worker startup. See [DEPLOYING.md](DEPLOYING.md)
for managed-service and AWS deployment instructions.

## Deployment

### Managed PostgreSQL and Redis

`compose.managed.yaml` accepts provider-issued PostgreSQL and Redis URLs via
`MANAGED_DATABASE_URL` and `MANAGED_REDIS_URL`, and runs migrations before
starting the API/worker. It does not provision cloud resources. Supply TLS
URLs, production secrets, public URLs, and network controls through the
deployment environment or secret manager.

### AWS ECS/Fargate example

`infra/aws/` contains Terraform for a test-oriented `us-east-1` environment
with ECS/Fargate API and worker services, an HTTP Application Load Balancer,
private RDS PostgreSQL and ElastiCache Redis, ECR, CloudWatch logs, and Secrets
Manager. Services are not started until `deploy_services` is enabled after
pushing the image and running the migration task.

This AWS example is **not a turnkey production architecture**: its load
balancer is HTTP-only because no domain/certificate was provided. Configure
HTTPS before production, establish encrypted remote Terraform state and
restricted state access before using real credentials, review AWS charges, and
follow the staged deployment and teardown guidance in [DEPLOYING.md](DEPLOYING.md).

## Security and Operations

- Use unique, high-entropy secrets and a secret manager in deployed
  environments. Never deploy the development fallback credentials from
  `compose.yaml`.
- Terminate public traffic with HTTPS in production. Production refresh cookies
  require HTTPS.
- Keep PostgreSQL and Redis private; limit inbound connectivity to application
  workloads. Require TLS for managed database/cache connections where
  supported.
- Restrict `/metrics` to trusted monitoring systems.
- Set a strict `CORS_ORIGIN` allowlist; the application supports comma-separated
  origins.
- Verify all Stripe webhook requests using the configured signing secret.
- Apply migrations as a controlled release step; do not use destructive schema
  reset or push commands against production data.
- Review the Terraform plan and cost impact before provisioning. NAT Gateway,
  load balancer, database, cache, tasks, and logs can incur ongoing charges.
- Back up PostgreSQL and regularly test recovery procedures.

## Troubleshooting

| Symptom                            | Checks                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/health` returns `503`            | Verify `DATABASE_URL`, `REDIS_URL`, service readiness, DNS, TLS options, and security-group/firewall rules. |
| API exits during startup           | Confirm `DATABASE_URL` is set and `JWT_ACCESS_TOKEN_SECRET` is at least 32 characters.                      |
| AI endpoints return unavailable    | Configure `ANTHROPIC_API_KEY`, start the worker, and verify Redis connectivity.                             |
| Refresh cookie is not retained     | Use HTTPS in production, allow credentials in the client, and configure exact `CORS_ORIGIN` values.         |
| Stripe checkout/webhooks fail      | Verify Stripe keys, price IDs, raw webhook delivery to `/billing/webhook`, and the endpoint signing secret. |
| Tasks or notifications stay queued | Confirm the worker is running and shares the API's Redis and database settings.                             |
| Prisma cannot connect              | Check the PostgreSQL URL, credentials, TLS requirements, database access policy, and migration status.      |

## Contributing

1. Create a feature branch.
2. Keep changes tenant-scoped and validate inputs at route boundaries.
3. Add or update unit and route integration tests for behavior changes,
   including cross-tenant access where applicable.
4. Run `npm test`, `npm run build`, and Prisma validation for database changes.
5. Update this README or the deployment guide when setup, configuration, routes,
   or operational behavior changes.

## License

No `LICENSE` file is currently included. Contact the repository owner before
redistributing or using this project under a particular license.
