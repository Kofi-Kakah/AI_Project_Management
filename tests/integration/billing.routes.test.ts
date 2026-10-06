import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MembershipStatus,
  OrganizationRole,
} from "../../generated/prisma/enums";

const { delegates, stripe } = vi.hoisted(() => {
  const model = () => ({
    create: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  });
  return {
    delegates: {
      membership: model(),
      organization: model(),
      subscription: model(),
    },
    stripe: {
      customers: { create: vi.fn() },
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
      subscriptions: { retrieve: vi.fn() },
    },
  };
});

vi.mock("../../src/config/db", () => ({ prisma: delegates }));
vi.mock("../../src/config/stripe", () => ({
  getStripeClient: () => stripe,
  getStripePriceId: (plan: string) => `price_${plan.toLowerCase()}`,
}));
vi.mock("../../src/middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const userId = req.header("authorization")?.replace(/^Bearer /, "");
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.auth = { userId, email: `${userId}@example.com` };
    next();
  },
}));

vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_key");
vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret");
vi.stubEnv("FRONTEND_URL", "https://app.example.com");

const { errorHandler } = await import("../../src/middleware/errorHandler");
const { billingRouter, organizationBillingRouter } =
  await import("../../src/modules/billing/billing.routes");
const { stripeWebhook } =
  await import("../../src/modules/billing/billing.controller");

const app = express();
app.post(
  "/billing/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);
app.use(express.json());
app.use("/billing", billingRouter);
app.use("/organizations/:organizationId/billing", organizationBillingRouter);
app.use(errorHandler);

describe("billing routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delegates.membership.findUnique.mockResolvedValue({
      organizationId: "org-a",
      userId: "owner-a",
      role: OrganizationRole.OWNER,
      status: MembershipStatus.ACTIVE,
    });
    delegates.organization.findUnique.mockResolvedValue({
      id: "org-a",
      name: "Example Organization",
    });
    delegates.subscription.findUnique.mockResolvedValue(null);
    delegates.subscription.upsert.mockResolvedValue({});
    stripe.customers.create.mockResolvedValue({ id: "cus_example" });
    stripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/session",
    });
    stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.com/session",
    });
    stripe.subscriptions.retrieve.mockReset();
    stripe.webhooks.constructEvent.mockReset();
  });

  it("lists the configured plans and their monthly quotas", async () => {
    const response = await request(app).get("/billing/plans");

    expect(response.status).toBe(200);
    expect(response.body.plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "FREE",
          monthlyProjectLimit: 3,
          monthlyTaskLimit: 500,
        }),
        expect.objectContaining({
          id: "PRO",
          monthlyProjectLimit: 20,
          monthlyTaskLimit: 5_000,
        }),
        expect.objectContaining({
          id: "PREMIUM",
          monthlyProjectLimit: null,
          monthlyTaskLimit: null,
        }),
      ]),
    );
  });

  it("creates a Stripe Checkout session for an authorized organization", async () => {
    const response = await request(app)
      .post("/organizations/org-a/billing/checkout")
      .set("Authorization", "Bearer owner-a")
      .send({ plan: "PRO" });

    expect(response.status).toBe(201);
    expect(response.body.url).toBe("https://checkout.stripe.com/session");
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_example",
        client_reference_id: "org-a",
        line_items: [{ price: "price_pro", quantity: 1 }],
        metadata: { organizationId: "org-a", plan: "PRO" },
        success_url:
          "https://app.example.com/settings/billing?checkout=success",
        cancel_url:
          "https://app.example.com/settings/billing?checkout=canceled",
      }),
    );
  });

  it("rejects checkout for non-admin organization members", async () => {
    delegates.membership.findUnique.mockResolvedValue({
      organizationId: "org-a",
      userId: "member-a",
      role: OrganizationRole.MEMBER,
      status: MembershipStatus.ACTIVE,
    });

    const response = await request(app)
      .post("/organizations/org-a/billing/checkout")
      .set("Authorization", "Bearer member-a")
      .send({ plan: "PRO" });

    expect(response.status).toBe(403);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("creates a billing portal session for the organization customer", async () => {
    delegates.subscription.findUnique.mockResolvedValue({
      stripeCustomerId: "cus_existing",
    });

    const response = await request(app)
      .post("/organizations/org-a/billing/portal")
      .set("Authorization", "Bearer owner-a");

    expect(response.status).toBe(200);
    expect(response.body.url).toBe("https://billing.stripe.com/session");
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_existing",
      return_url: "https://app.example.com/settings/billing",
    });
  });

  it("syncs subscription state from a signed checkout webhook", async () => {
    stripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          subscription: "sub_example",
          client_reference_id: "org-a",
          metadata: { organizationId: "org-a", plan: "PRO" },
        },
      },
    });
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_example",
      customer: "cus_example",
      status: "active",
      metadata: { organizationId: "org-a", plan: "PRO" },
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

    const response = await request(app)
      .post("/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "valid-test-signature")
      .send({ type: "checkout.session.completed" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_example");
    expect(delegates.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a" },
        create: expect.objectContaining({
          stripeSubscriptionId: "sub_example",
          stripePriceId: "price_pro",
          plan: "PRO",
          status: "ACTIVE",
          interval: "MONTH",
        }),
      }),
    );
  });

  it("rejects a webhook with an invalid Stripe signature", async () => {
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("signature mismatch");
    });

    const response = await request(app)
      .post("/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "invalid")
      .send({ type: "customer.subscription.updated" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_WEBHOOK_SIGNATURE");
  });
});
