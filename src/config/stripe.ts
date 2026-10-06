import Stripe from "stripe";
import { env } from "./env";
import { AppError } from "../utils/AppError";

let stripeClient: Stripe | undefined;

export function getStripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(
      "Stripe billing is not configured",
      503,
      "BILLING_UNAVAILABLE",
    );
  }

  stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export function getStripePriceId(plan: "PRO" | "PREMIUM"): string {
  const priceId =
    plan === "PRO" ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_PREMIUM;
  if (!priceId) {
    throw new AppError(
      `The ${plan.toLowerCase()} plan is not configured for checkout`,
      503,
      "BILLING_UNAVAILABLE",
    );
  }
  return priceId;
}
