import type { RequestHandler } from "express";
import { env } from "../../config/env";
import { getStripeClient } from "../../config/stripe";
import { AppError } from "../../utils/AppError";
import {
  createCheckoutSession,
  createPortalSession,
  getOrganizationSubscription,
  listPlans,
  processStripeWebhookEvent,
} from "./billing.service";

function getOrganizationId(organizationId: string | undefined): string {
  if (!organizationId) {
    throw new AppError("Organization access required", 400, "VALIDATION_ERROR");
  }
  return organizationId;
}

function getAuthenticatedEmail(email: string | undefined): string {
  if (!email) {
    throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  }
  return email;
}

export const getPlans: RequestHandler = (_req, res) => {
  res.json({ plans: listPlans() });
};

export const getSubscription: RequestHandler = async (req, res) => {
  const result = await getOrganizationSubscription(
    getOrganizationId(req.organization?.id),
  );
  res.json(result);
};

export const checkout: RequestHandler = async (req, res) => {
  const result = await createCheckoutSession(
    getOrganizationId(req.organization?.id),
    getAuthenticatedEmail(req.auth?.email),
    req.body.plan,
  );
  res.status(201).json(result);
};

export const portal: RequestHandler = async (req, res) => {
  const result = await createPortalSession(
    getOrganizationId(req.organization?.id),
  );
  res.json(result);
};

export const stripeWebhook: RequestHandler = async (req, res, next) => {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    next(
      new AppError(
        "Stripe webhook is not configured",
        503,
        "BILLING_UNAVAILABLE",
      ),
    );
    return;
  }
  const signature = req.get("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) {
    res.status(400).json({
      error: "A signed Stripe webhook payload is required",
      code: "INVALID_WEBHOOK",
    });
    return;
  }

  let event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      req.body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    res.status(400).json({
      error: "Invalid Stripe webhook signature",
      code: "INVALID_WEBHOOK_SIGNATURE",
    });
    return;
  }

  try {
    await processStripeWebhookEvent(event);
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
};
