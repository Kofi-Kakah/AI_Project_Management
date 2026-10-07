import { AiRequestStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../config/db";
import { currentUsagePeriod } from "../billing/billing.usage";

export async function getPlatformStats() {
  const { periodStart, periodEnd } = currentUsagePeriod();
  const period = { gte: periodStart, lt: periodEnd };
  const [
    users,
    organizations,
    activeMemberships,
    projects,
    tasks,
    monthlyAi,
    successfulAiRequests,
    failedAiRequests,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.membership.count({ where: { status: "ACTIVE" } }),
    prisma.project.count(),
    prisma.task.count(),
    prisma.aiRequest.aggregate({
      where: { createdAt: period },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
      },
    }),
    prisma.aiRequest.count({
      where: { createdAt: period, status: AiRequestStatus.SUCCEEDED },
    }),
    prisma.aiRequest.count({
      where: { createdAt: period, status: AiRequestStatus.FAILED },
    }),
  ]);

  return {
    periodStart,
    periodEnd,
    totals: { users, organizations, activeMemberships, projects, tasks },
    ai: {
      requests: monthlyAi._count._all,
      successfulRequests: successfulAiRequests,
      failedRequests: failedAiRequests,
      inputTokens: monthlyAi._sum.inputTokens ?? 0,
      outputTokens: monthlyAi._sum.outputTokens ?? 0,
      estimatedCostUsd:
        monthlyAi._sum.estimatedCostUsd === null
          ? null
          : Number(monthlyAi._sum.estimatedCostUsd),
    },
  };
}
