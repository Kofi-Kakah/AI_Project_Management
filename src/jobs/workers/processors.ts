import { NotificationType, TaskStatus } from "../../../generated/prisma/enums";
import type { EmailJobData, NotificationJobData } from "../queues";
import { enqueueNotification, getQueues } from "../queues";
import { prisma } from "../../config/db";
import { deliverEmail } from "../../utils/mailer";

export async function processEmail(data: EmailJobData): Promise<void> {
  await deliverEmail(data);
}

export async function processNotification(
  data: NotificationJobData,
): Promise<void> {
  await prisma.notification.create({
    data: {
      organizationId: data.organizationId,
      userId: data.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
    },
  });
}

export async function queueUpcomingDeadlineNotifications(
  now = new Date(),
): Promise<number> {
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: { not: null },
      dueAt: { gte: now, lt: horizon },
      status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELED] },
    },
    select: {
      id: true,
      organizationId: true,
      assigneeId: true,
      title: true,
      dueAt: true,
    },
  });

  for (const task of tasks) {
    if (!task.assigneeId || !task.dueAt) continue;
    const dueDay = task.dueAt.toISOString().slice(0, 10);
    await enqueueNotification(
      {
        organizationId: task.organizationId,
        userId: task.assigneeId,
        type: NotificationType.TASK_UPDATED,
        title: "Upcoming task deadline",
        body: `"${task.title}" is due ${task.dueAt.toLocaleString()}.`,
        resourceType: "task",
        resourceId: task.id,
      },
      {
        jobId: `deadline-${task.id}-${dueDay}`,
        removeOnComplete: { age: 30 * 24 * 60 * 60, count: 10_000 },
      },
    );
  }

  return tasks.length;
}

export async function scheduleDeadlineScan(): Promise<void> {
  await getQueues().deadlines.upsertJobScheduler(
    "upcoming-deadlines-hourly",
    { every: 60 * 60 * 1000 },
    { name: "scan-upcoming-deadlines", data: {} },
  );
}
