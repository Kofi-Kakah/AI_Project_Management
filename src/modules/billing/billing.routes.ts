import { Router } from "express";
import { OrganizationRole } from "../../../generated/prisma/enums";
import { requireAuth } from "../../middleware/auth";
import { requireOrganizationRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import {
  checkout,
  getPlans,
  getSubscription,
  portal,
} from "./billing.controller";
import {
  billingOrganizationParamsSchema,
  checkoutSchema,
} from "./billing.schema";

export const billingRouter = Router();
billingRouter.get("/plans", getPlans);

export const organizationBillingRouter = Router({ mergeParams: true });
organizationBillingRouter.use(
  requireAuth,
  validate(billingOrganizationParamsSchema, "params"),
  requireOrganizationRole([OrganizationRole.OWNER, OrganizationRole.ADMIN]),
);
organizationBillingRouter.get("/subscription", getSubscription);
organizationBillingRouter.post("/checkout", validate(checkoutSchema), checkout);
organizationBillingRouter.post("/portal", portal);
