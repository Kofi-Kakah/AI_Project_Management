import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MembershipStatus,
  OrganizationRole,
} from "../../generated/prisma/enums";

const mocks = vi.hoisted(() => {
  const model = () => ({
    create: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    upsert: vi.fn(),
  });
  const delegates = {
    user: model(),
    refreshToken: model(),
    organization: model(),
    membership: model(),
    team: model(),
    project: model(),
    task: model(),
    activityLog: model(),
    usageRecord: model(),
    subscription: model(),
  };
  const stripe = {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
  };
  return {
    delegates,
    stripe,
    enqueueEmail: vi.fn(),
    enqueueNotification: vi.fn(),
    argonHash: vi.fn(),
    argonVerify: vi.fn(),
    emitOrganizationEvent: vi.fn(),
    emitProjectEvent: vi.fn(),
    redisGet: vi.fn(),
    redisSet: vi.fn(),
    redisIncr: vi.fn(),
    redisCall: vi.fn(),
    organization: undefined as
      { id: string; name: string; slug: string } | undefined,
    project: undefined as
      { id: string; organizationId: string; name: string } | undefined,
    task: undefined as
      | {
          id: string;
          organizationId: string;
          projectId: string;
          title: string;
          status: string;
          priority: string;
          assigneeId: null;
        }
      | undefined,
    user: undefined as
      | {
          id: string;
          email: string;
          name: string;
          passwordHash: string;
          emailVerifiedAt: Date | null;
          emailVerificationHash: string | null;
          emailVerificationExpiresAt: Date | null;
          disabledAt: null;
          avatarUrl: null;
          createdAt: Date;
          updatedAt: Date;
        }
      | undefined,
  };
});

vi.mock("../../src/config/db", () => ({
  prisma: {
    ...mocks.delegates,
    $transaction: vi.fn(
      async (operation: (transaction: typeof mocks.delegates) => unknown) =>
        operation(mocks.delegates),
    ),
  },
}));
vi.mock("../../src/config/redis", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
    incr: mocks.redisIncr,
    call: mocks.redisCall,
  },
}));
vi.mock("../../src/jobs/queues", () => ({
  enqueueEmail: mocks.enqueueEmail,
  enqueueNotification: mocks.enqueueNotification,
}));
vi.mock("../../src/realtime/socket", () => ({
  emitOrganizationEvent: mocks.emitOrganizationEvent,
  emitProjectEvent: mocks.emitProjectEvent,
  REALTIME_SERVER_EVENTS: {
    projectCreated: "project:created",
    taskCreated: "task:created",
  },
}));
vi.mock("argon2", () => ({
  default: { hash: mocks.argonHash, verify: mocks.argonVerify },
}));
vi.mock("../../src/config/stripe", () => ({
  getStripeClient: () => mocks.stripe,
  getStripePriceId: (plan: string) => `price_${plan.toLowerCase()}`,
}));

vi.stubEnv("NODE_ENV", "test");
vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
vi.stubEnv(
  "JWT_ACCESS_TOKEN_SECRET",
  "test-secret-that-is-long-enough-for-jwt",
);
vi.stubEnv(
  "JWT_REFRESH_TOKEN_SECRET",
  "test-refresh-secret-that-is-long-enough",
);
vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_key");
vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret");
vi.stubEnv("STRIPE_PRICE_PRO", "price_pro");
vi.stubEnv("FRONTEND_URL", "https://app.example.com");

const { authRouter } = await import("../../src/modules/auth/auth.routes");
const { organizationsRouter } =
  await import("../../src/modules/organizations/organizations.routes");
const { projectsRouter } =
  await import("../../src/modules/projects/projects.routes");
const { projectTasksRouter } =
  await import("../../src/modules/tasks/tasks.routes");
const { billingRouter, organizationBillingRouter } =
  await import("../../src/modules/billing/billing.routes");
const { stripeWebhook } =
  await import("../../src/modules/billing/billing.controller");
const { errorHandler } = await import("../../src/middleware/errorHandler");

const app = express();
app.post(
  "/billing/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);
app.use(express.json());
app.use(cookieParser());
app.use("/auth", authRouter);
app.use("/billing", billingRouter);
app.use("/organizations", organizationsRouter);
app.use("/organizations/:organizationId/projects", projectsRouter);
app.use(
  "/organizations/:organizationId/projects/:projectId/tasks",
  projectTasksRouter,
);
app.use("/organizations/:organizationId/billing", organizationBillingRouter);
app.use(errorHandler);

describe("end-to-end signup, organization, task, and upgrade flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organization = undefined;
    mocks.project = undefined;
    mocks.task = undefined;
    mocks.user = undefined;

    mocks.argonHash.mockImplementation(
      async (password: string) => `hashed:${password}`,
    );
    mocks.argonVerify.mockImplementation(
      async (hash: string, password: string) => hash === `hashed:${password}`,
    );
    mocks.enqueueEmail.mockResolvedValue(undefined);
    mocks.enqueueNotification.mockResolvedValue(undefined);
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue("OK");
    mocks.redisIncr.mockResolvedValue(1);
    mocks.redisCall.mockImplementation((command: string) =>
      Promise.resolve(command === "SCRIPT" ? "script-sha" : [0, 60_000]),
    );

    mocks.delegates.user.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        mocks.user = {
          id: "user-e2e",
          email: String(data.email),
          name: String(data.name),
          passwordHash: String(data.passwordHash),
          emailVerifiedAt: null,
          emailVerificationHash: String(data.emailVerificationHash),
          emailVerificationExpiresAt: data.emailVerificationExpiresAt as Date,
          disabledAt: null,
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return { id: mocks.user.id };
      },
    );
    mocks.delegates.user.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, string> }) => {
        if (
          where.emailVerificationHash &&
          mocks.user?.emailVerificationHash === where.emailVerificationHash
        ) {
          return mocks.user;
        }
        if (where.email && mocks.user?.email === where.email) {
          return mocks.user;
        }
        return null;
      },
    );
    mocks.delegates.user.update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<NonNullable<typeof mocks.user>>;
      }) => {
        if (mocks.user?.id === where.id) Object.assign(mocks.user, data);
        return mocks.user;
      },
    );
    mocks.delegates.refreshToken.create.mockResolvedValue({
      id: "refresh-e2e",
    });
    mocks.delegates.organization.create.mockImplementation(
      async ({ data }: { data: { name: string; slug: string } }) => {
        mocks.organization = {
          id: "org-e2e",
          name: data.name,
          slug: data.slug,
        };
        return {
          ...mocks.organization,
          createdAt: new Date(),
          memberships: [{ id: "membership-e2e", role: OrganizationRole.OWNER }],
        };
      },
    );
    mocks.delegates.organization.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        mocks.organization?.id === where.id ? mocks.organization : null,
    );
    mocks.delegates.membership.findUnique.mockImplementation(async () =>
      mocks.organization
        ? {
            organizationId: mocks.organization.id,
            userId: "user-e2e",
            role: OrganizationRole.OWNER,
            status: MembershipStatus.ACTIVE,
          }
        : null,
    );
    mocks.delegates.project.count.mockResolvedValue(0);
    mocks.delegates.project.create.mockImplementation(
      async ({ data }: { data: { organizationId: string; name: string } }) => {
        mocks.project = {
          id: "project-e2e",
          organizationId: data.organizationId,
          name: data.name,
        };
        return { ...mocks.project, team: null };
      },
    );
    mocks.delegates.project.findUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { id_organizationId: { id: string; organizationId: string } };
      }) =>
        mocks.project?.id === where.id_organizationId.id &&
        mocks.project.organizationId === where.id_organizationId.organizationId
          ? mocks.project
          : null,
    );
    mocks.delegates.task.count.mockResolvedValue(0);
    mocks.delegates.task.findUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { id_organizationId: { id: string; organizationId: string } };
      }) =>
        mocks.task?.id === where.id_organizationId.id &&
        mocks.task.organizationId === where.id_organizationId.organizationId
          ? { ...mocks.task, parentId: null }
          : null,
    );
    mocks.delegates.task.create.mockImplementation(
      async ({
        data,
      }: {
        data: {
          organizationId: string;
          projectId: string;
          title: string;
          status?: string;
          priority?: string;
          assigneeId?: null;
        };
      }) => {
        mocks.task = {
          id: "task-e2e",
          organizationId: data.organizationId,
          projectId: data.projectId,
          title: data.title,
          status: data.status ?? "TODO",
          priority: data.priority ?? "MEDIUM",
          assigneeId: null,
        };
        return { ...mocks.task, assignee: null };
      },
    );
    mocks.delegates.activityLog.create.mockResolvedValue({});
    mocks.delegates.usageRecord.aggregate.mockResolvedValue({
      _sum: { quantity: 0 },
    });
    mocks.delegates.usageRecord.create.mockResolvedValue({});
    mocks.delegates.subscription.findUnique.mockResolvedValue(null);
    mocks.delegates.subscription.upsert.mockResolvedValue({});
    mocks.stripe.customers.create.mockResolvedValue({ id: "cus-e2e" });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/e2e",
    });
    mocks.stripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub-e2e",
          client_reference_id: "org-e2e",
          metadata: { organizationId: "org-e2e", plan: "PRO" },
        },
      },
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub-e2e",
      customer: "cus-e2e",
      status: "active",
      metadata: { organizationId: "org-e2e", plan: "PRO" },
      items: {
        data: [
          {
            price: { id: "price_pro", recurring: { interval: "month" } },
            current_period_start: 1_800_000_000,
            current_period_end: 1_802_592_000,
            quantity: 1,
          },
        ],
      },
      cancel_at_period_end: false,
      canceled_at: null,
      trial_end: null,
    });
  });

  it("creates an account and organization, adds a task, then upgrades the subscription", async () => {
    const registration = await request(app).post("/auth/register").send({
      name: "E2E User",
      email: "e2e@example.com",
      password: "correct-password",
    });
    expect(registration.status).toBe(201);

    const verificationToken = mocks.enqueueEmail.mock.calls[0][0]
      .token as string;
    const verification = await request(app)
      .get("/auth/verify-email")
      .query({ token: verificationToken });
    expect(verification.status).toBe(200);

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "e2e@example.com", password: "correct-password" });
    expect(login.status).toBe(200);
    const authorization = `Bearer ${login.body.accessToken as string}`;

    const organization = await request(app)
      .post("/organizations")
      .set("Authorization", authorization)
      .send({ name: "E2E Workspace" });
    expect(organization.status).toBe(201);
    const organizationId = organization.body.organization.id as string;

    const project = await request(app)
      .post(`/organizations/${organizationId}/projects`)
      .set("Authorization", authorization)
      .send({ name: "Launch project" });
    expect(project.status).toBe(201);
    const projectId = project.body.project.id as string;

    const task = await request(app)
      .post(`/organizations/${organizationId}/projects/${projectId}/tasks`)
      .set("Authorization", authorization)
      .send({ title: "Ship the first release" });
    expect(task.status).toBe(201);
    expect(task.body.task.title).toBe("Ship the first release");

    const checkout = await request(app)
      .post(`/organizations/${organizationId}/billing/checkout`)
      .set("Authorization", authorization)
      .send({ plan: "PRO" });
    expect(checkout.status).toBe(201);
    expect(checkout.body.url).toBe("https://checkout.stripe.com/e2e");

    const webhook = await request(app)
      .post("/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "valid-e2e-signature")
      .send({ type: "checkout.session.completed" });
    expect(webhook.status).toBe(200);
    expect(mocks.delegates.subscription.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-e2e" },
        create: expect.objectContaining({ plan: "PRO", status: "ACTIVE" }),
      }),
    );
  });
});
