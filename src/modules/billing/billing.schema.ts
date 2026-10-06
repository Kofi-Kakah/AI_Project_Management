import { z } from "zod";

export const billingOrganizationParamsSchema = z.object({
  organizationId: z.string().min(1),
});

export const checkoutSchema = z.object({
  plan: z.enum(["PRO", "PREMIUM"]),
});
