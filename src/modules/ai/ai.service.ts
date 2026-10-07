import {
  AiRequestStatus,
  SubscriptionStatus,
  UsageMetric,
} from "../../../generated/prisma/enums";
import { prisma } from "../../config/db";
import { env } from "../../config/env";
import { enqueueAiJob, type AiJobData } from "../../jobs/queues";
import { AppError } from "../../utils/AppError";
import { logger } from "../../utils/logger";
import { PLAN_CATALOG, isPlanId, type PlanId } from "../billing/billing.plans";
import { currentUsagePeriod } from "../billing/billing.usage";

function effectivePlan(
  subscription: { plan: string; status: SubscriptionStatus } | null,
): PlanId {
  const paidAccess =
    subscription?.status === SubscriptionStatus.ACTIVE ||
    subscription?.status === SubscriptionStatus.TRIALING ||
    subscription?.status === SubscriptionStatus.PAST_DUE;
  return paidAccess && subscription && isPlanId(subscription.plan)
    ? subscription.plan
    : "FREE";
}

async function createRequest(data: Omit<AiJobData, "requestId">) {
  if (!env.GLM_API_KEY) {
    throw new AppError("AI service is not configured", 503, "AI_UNAVAILABLE");
  }

  const { periodStart, periodEnd } = currentUsagePeriod();
  const request = await prisma.$transaction(
    async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { organizationId: data.organizationId },
        select: { plan: true, status: true },
      });
      const plan = effectivePlan(subscription);
      const limit = PLAN_CATALOG[plan].monthlyAiRequestLimit;
      if (limit === 0) {
        throw new AppError(
          "AI features are not available on the Free plan",
          402,
          "PLAN_LIMIT_EXCEEDED",
        );
      }

      if (limit !== null) {
        const usage = await tx.usageRecord.aggregate({
          where: {
            organizationId: data.organizationId,
            metric: UsageMetric.AI_REQUEST,
            periodStart,
            periodEnd,
          },
          _sum: { quantity: true },
        });
        if (Number(usage._sum.quantity ?? 0) >= limit) {
          throw new AppError(
            `Your ${PLAN_CATALOG[plan].name} plan allows ${limit} AI requests per month`,
            402,
            "PLAN_LIMIT_EXCEEDED",
          );
        }
      }

      const record = await tx.aiRequest.create({
        data: {
          organizationId: data.organizationId,
          userId: data.userId,
          feature: data.feature,
          model: env.GLM_MODEL,
          status: AiRequestStatus.QUEUED,
          succeeded: false,
        },
        select: { id: true, status: true, createdAt: true },
      });
      await tx.usageRecord.create({
        data: {
          organizationId: data.organizationId,
          metric: UsageMetric.AI_REQUEST,
          periodStart,
          periodEnd,
          source: `ai.${data.feature}`,
          idempotencyKey: `ai-request:${record.id}`,
          metadata: { requestId: record.id, userId: data.userId },
        },
      });
      return record;
    },
    { isolationLevel: "Serializable" },
  );

  const job: AiJobData = { ...data, requestId: request.id };
  try {
    await enqueueAiJob(job);
  } catch (error) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.usageRecord.deleteMany({
          where: { idempotencyKey: `ai-request:${request.id}` },
        });
        await tx.aiRequest.update({
          where: { id: request.id },
          data: {
            status: AiRequestStatus.FAILED,
            succeeded: false,
            error: "Could not enqueue the AI request",
          },
        });
      });
    } catch (updateError) {
      logger.error(
        { requestId: request.id, error: updateError },
        "Could not clean up the AI request after enqueue error",
      );
    }
    throw error;
  }
  return request;
}

export async function queueTaskSummary(
  organizationId: string,
  userId: string,
  taskId: string,
) {
  const task = await prisma.task.findUnique({
    where: { id_organizationId: { id: taskId, organizationId } },
    select: { id: true },
  });
  if (!task) throw new AppError("Task not found", 404, "NOT_FOUND");

  return createRequest({
    organizationId,
    userId,
    taskId,
    feature: "task-summary",
  });
}

export async function queueSubtaskGeneration(
  organizationId: string,
  userId: string,
  taskId: string,
  subtaskCount: number,
) {
  const task = await prisma.task.findUnique({
    where: { id_organizationId: { id: taskId, organizationId } },
    select: { id: true },
  });
  if (!task) throw new AppError("Task not found", 404, "NOT_FOUND");

  return createRequest({
    organizationId,
    userId,
    taskId,
    feature: "subtask-generation",
    subtaskCount,
  });
}

export async function getAiRequest(
  organizationId: string,
  userId: string,
  requestId: string,
) {
  const request = await prisma.aiRequest.findFirst({
    where: { id: requestId, organizationId, userId },
    select: {
      id: true,
      feature: true,
      status: true,
      result: true,
      error: true,
      createdAt: true,
      durationMs: true,
    },
  });
  if (!request) throw new AppError("AI request not found", 404, "NOT_FOUND");
  return request;
}
