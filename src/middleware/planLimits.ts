import type { RequestHandler } from "express";
import { SubscriptionStatus, UsageMetric } from "../../generated/prisma/enums";
import { prisma } from "../config/db";
import { logger } from "../utils/logger";
import { AppError } from "../utils/AppError";
import {
  PLAN_CATALOG,
  isPlanId,
  type PlanId,
} from "../modules/billing/billing.plans";
import { currentUsagePeriod } from "../modules/billing/billing.usage";

type QuotaMetric = typeof UsageMetric.PROJECT | typeof UsageMetric.TASK;

function planLimit(plan: PlanId, metric: QuotaMetric): number | null {
  return metric === UsageMetric.PROJECT
    ? PLAN_CATALOG[plan].monthlyProjectLimit
    : PLAN_CATALOG[plan].monthlyTaskLimit;
}

export function requirePlanCapacity(metric: QuotaMetric): RequestHandler {
  return async (req, _res, next) => {
    const organizationId = req.organization?.id;
    if (!organizationId) {
      next(
        new AppError("Organization access required", 400, "VALIDATION_ERROR"),
      );
      return;
    }

    try {
      const subscription = await prisma.subscription.findUnique({
        where: { organizationId },
        select: { plan: true, status: true },
      });
      const paidAccess =
        subscription?.status === SubscriptionStatus.ACTIVE ||
        subscription?.status === SubscriptionStatus.TRIALING ||
        subscription?.status === SubscriptionStatus.PAST_DUE;
      if (paidAccess && subscription && !isPlanId(subscription.plan)) {
        logger.error(
          { organizationId, plan: subscription.plan },
          "Organization has an unrecognized billing plan; applying free-plan limits",
        );
      }
      const plan =
        paidAccess && subscription && isPlanId(subscription.plan)
          ? subscription.plan
          : "FREE";
      const limit = planLimit(plan, metric);
      if (limit === null) {
        next();
        return;
      }

      const { periodStart, periodEnd } = currentUsagePeriod();
      const [usage, currentEntityCount] = await Promise.all([
        prisma.usageRecord.aggregate({
          where: {
            organizationId,
            metric,
            periodStart,
            periodEnd,
          },
          _sum: { quantity: true },
        }),
        metric === UsageMetric.PROJECT
          ? prisma.project.count({
              where: {
                organizationId,
                createdAt: { gte: periodStart, lt: periodEnd },
              },
            })
          : prisma.task.count({
              where: {
                organizationId,
                createdAt: { gte: periodStart, lt: periodEnd },
              },
            }),
      ]);
      const recordedUsage = Number(usage._sum.quantity ?? 0);
      const used = Math.max(recordedUsage, currentEntityCount);

      if (used >= limit) {
        next(
          new AppError(
            `Your ${PLAN_CATALOG[plan].name} plan allows ${limit} ${metric === UsageMetric.PROJECT ? "projects" : "tasks"} per month`,
            402,
            "PLAN_LIMIT_EXCEEDED",
          ),
        );
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
