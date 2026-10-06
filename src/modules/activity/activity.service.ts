import type { Prisma } from "../../../generated/prisma/client";

type ActivityEntry = {
  organizationId: string;
  actorId: string;
  action: "created" | "updated" | "deleted";
  entityType: "team" | "project" | "task" | "comment";
  entityId: string;
  metadata?: Prisma.InputJsonObject;
};

export async function log(
  tx: Prisma.TransactionClient,
  entry: ActivityEntry,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      ...entry,
      metadata: entry.metadata ?? {},
    },
  });
}
