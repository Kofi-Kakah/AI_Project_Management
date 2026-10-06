import type { Prisma } from "../../../generated/prisma/client";
import type { UsageMetric } from "../../../generated/prisma/enums";

export function currentUsagePeriod(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    periodStart: new Date(Date.UTC(year, month, 1)),
    periodEnd: new Date(Date.UTC(year, month + 1, 1)),
  };
}

export async function recordMonthlyUsage(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    metric: UsageMetric;
    entityId: string;
    source: string;
  },
): Promise<void> {
  const { periodStart, periodEnd } = currentUsagePeriod();
  await transaction.usageRecord.create({
    data: {
      organizationId: input.organizationId,
      metric: input.metric,
      periodStart,
      periodEnd,
      source: input.source,
      idempotencyKey: `${input.metric.toLowerCase()}:${input.entityId}`,
      metadata: { entityId: input.entityId },
    },
  });
}
