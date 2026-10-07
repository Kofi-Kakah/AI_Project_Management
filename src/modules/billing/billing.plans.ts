import { env } from "../../config/env";

export type PaidPlan = "PRO" | "PREMIUM";
export type PlanId = "FREE" | PaidPlan;

export const PLAN_CATALOG = {
  FREE: {
    name: "Free",
    monthlyProjectLimit: 3,
    monthlyTaskLimit: 500,
    monthlyAiRequestLimit: 0,
    stripePriceConfigured: false,
  },
  PRO: {
    name: "Pro",
    monthlyProjectLimit: 20,
    monthlyTaskLimit: 5_000,
    monthlyAiRequestLimit: 500,
    stripePriceConfigured: Boolean(env.STRIPE_PRICE_PRO),
  },
  PREMIUM: {
    name: "Premium",
    monthlyProjectLimit: null,
    monthlyTaskLimit: null,
    monthlyAiRequestLimit: null,
    stripePriceConfigured: Boolean(env.STRIPE_PRICE_PREMIUM),
  },
} as const;

export function isPlanId(value: string): value is PlanId {
  return value === "FREE" || value === "PRO" || value === "PREMIUM";
}

export function planForStripePrice(
  priceId: string | null | undefined,
): PaidPlan | null {
  if (priceId && priceId === env.STRIPE_PRICE_PRO) return "PRO";
  if (priceId && priceId === env.STRIPE_PRICE_PREMIUM) return "PREMIUM";
  return null;
}
