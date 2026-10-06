import Stripe from "stripe";
import {
  BillingInterval,
  SubscriptionStatus,
  UsageMetric,
} from "../../../generated/prisma/enums";
import { prisma } from "../../config/db";
import { env } from "../../config/env";
import { getStripeClient, getStripePriceId } from "../../config/stripe";
import { AppError } from "../../utils/AppError";
import { logger } from "../../utils/logger";
import {
  PLAN_CATALOG,
  isPlanId,
  planForStripePrice,
  type PaidPlan,
} from "./billing.plans";

const billingPortalPath = "/settings/billing";

export function listPlans() {
  return Object.entries(PLAN_CATALOG).map(([id, plan]) => ({
    id,
    ...plan,
  }));
}

export async function getOrganizationSubscription(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    select: {
      plan: true,
      status: true,
      interval: true,
      quantity: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      cancelAtPeriodEnd: true,
      canceledAt: true,
    },
  });
  const hasPaidAccess =
    subscription?.status === SubscriptionStatus.ACTIVE ||
    subscription?.status === SubscriptionStatus.TRIALING ||
    subscription?.status === SubscriptionStatus.PAST_DUE;
  const plan =
    hasPaidAccess && subscription && isPlanId(subscription.plan)
      ? subscription.plan
      : "FREE";

  return {
    subscription,
    effectivePlan: plan,
    limits: PLAN_CATALOG[plan],
  };
}

export async function createCheckoutSession(
  organizationId: string,
  email: string,
  plan: PaidPlan,
) {
  const [organization, existing] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    }),
    prisma.subscription.findUnique({
      where: { organizationId },
      select: {
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        status: true,
      },
    }),
  ]);
  if (!organization) {
    throw new AppError("Organization not found", 404, "NOT_FOUND");
  }
  if (
    existing?.stripeSubscriptionId &&
    existing.status !== SubscriptionStatus.CANCELED
  ) {
    throw new AppError(
      "An active or pending subscription already exists; use the billing portal to manage it",
      409,
      "SUBSCRIPTION_EXISTS",
    );
  }

  const priceId = getStripePriceId(plan);
  const stripe = getStripeClient();
  const stripeCustomerId =
    existing?.stripeCustomerId ??
    (
      await stripe.customers.create({
        email,
        name: organization.name,
        metadata: { organizationId },
      })
    ).id;

  await prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      stripeCustomerId,
      plan: "FREE",
      status: SubscriptionStatus.INCOMPLETE,
    },
    update: { stripeCustomerId },
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    client_reference_id: organizationId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { organizationId, plan },
    subscription_data: { metadata: { organizationId, plan } },
    success_url: new URL(
      `${billingPortalPath}?checkout=success`,
      env.FRONTEND_URL,
    ).toString(),
    cancel_url: new URL(
      `${billingPortalPath}?checkout=canceled`,
      env.FRONTEND_URL,
    ).toString(),
  });

  if (!session.url) {
    throw new AppError(
      "Stripe did not return a checkout URL",
      502,
      "BILLING_PROVIDER_ERROR",
    );
  }
  return { url: session.url };
}

export async function createPortalSession(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { stripeCustomerId: true },
  });
  if (!subscription?.stripeCustomerId) {
    throw new AppError(
      "No Stripe customer is associated with this organization",
      404,
      "BILLING_CUSTOMER_NOT_FOUND",
    );
  }

  const session = await getStripeClient().billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: new URL(billingPortalPath, env.FRONTEND_URL).toString(),
  });
  return { url: session.url };
}

function mapStripeStatus(
  status: Stripe.Subscription.Status,
): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "past_due":
      return SubscriptionStatus.PAST_DUE;
    case "canceled":
      return SubscriptionStatus.CANCELED;
    case "unpaid":
      return SubscriptionStatus.UNPAID;
    case "paused":
      return SubscriptionStatus.PAUSED;
    case "incomplete":
    case "incomplete_expired":
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}

function unixSecondsToDate(value: number | null | undefined): Date | null {
  return value == null ? null : new Date(value * 1000);
}

async function syncStripeSubscription(
  subscription: Stripe.Subscription,
  organizationId?: string,
): Promise<void> {
  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
    select: {
      organizationId: true,
      plan: true,
      stripePriceId: true,
    },
  });
  const resolvedOrganizationId =
    organizationId ??
    subscription.metadata.organizationId ??
    existing?.organizationId;
  if (!resolvedOrganizationId) {
    logger.warn(
      { stripeSubscriptionId: subscription.id },
      "Ignoring Stripe subscription event without an organization reference",
    );
    return;
  }

  const firstItem = subscription.items.data[0];
  const priceId = firstItem?.price.id ?? existing?.stripePriceId ?? null;
  const plan =
    planForStripePrice(priceId) ??
    (subscription.metadata.plan && isPlanId(subscription.metadata.plan)
      ? subscription.metadata.plan
      : null) ??
    (existing?.plan && isPlanId(existing.plan) ? existing.plan : null);
  if (!plan) {
    throw new AppError(
      "Stripe subscription uses an unrecognized price",
      422,
      "UNKNOWN_STRIPE_PRICE",
    );
  }
  if (plan === "FREE") {
    throw new AppError(
      "Stripe subscriptions cannot use the free plan",
      422,
      "UNKNOWN_STRIPE_PRICE",
    );
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const interval =
    firstItem?.price.recurring?.interval === "year"
      ? BillingInterval.YEAR
      : BillingInterval.MONTH;
  const periodStart = unixSecondsToDate(firstItem?.current_period_start);
  const periodEnd = unixSecondsToDate(firstItem?.current_period_end);
  const status = mapStripeStatus(subscription.status);
  const canceledAt = unixSecondsToDate(subscription.canceled_at);
  const trialEndsAt = unixSecondsToDate(subscription.trial_end);
  const subscriptionData = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    plan,
    status,
    interval,
    quantity: firstItem?.quantity ?? 1,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    trialEndsAt,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt,
  };

  await prisma.subscription.upsert({
    where: { organizationId: resolvedOrganizationId },
    create: { organizationId: resolvedOrganizationId, ...subscriptionData },
    update: subscriptionData,
  });
}

export async function processStripeWebhookEvent(
  event: Stripe.Event,
): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode !== "subscription" || !session.subscription) return;
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;
    const subscription =
      await getStripeClient().subscriptions.retrieve(subscriptionId);
    await syncStripeSubscription(
      subscription,
      session.metadata?.organizationId ??
        session.client_reference_id ??
        undefined,
    );
    return;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const latestSubscription = await getStripeClient().subscriptions.retrieve(
      event.data.object.id,
    );
    await syncStripeSubscription(latestSubscription);
    return;
  }

  if (event.type.startsWith("customer.subscription.")) {
    logger.warn(
      { eventType: event.type },
      "Unhandled Stripe subscription event",
    );
    return;
  }

  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed"
  ) {
    const invoice = event.data.object;
    if (
      invoice.parent?.type !== "subscription_details" ||
      !invoice.parent.subscription_details
    ) {
      return;
    }
    const subscriptionId = invoice.parent.subscription_details.subscription;
    const id =
      typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id;
    const subscription = await getStripeClient().subscriptions.retrieve(id);
    await syncStripeSubscription(subscription);
    return;
  }

  logger.info({ eventType: event.type }, "Ignoring unrelated Stripe event");
}
