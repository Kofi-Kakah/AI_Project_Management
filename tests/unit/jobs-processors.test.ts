import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationType, TaskStatus } from "../../generated/prisma/enums";

const {
  notificationCreate,
  taskFindMany,
  enqueueNotification,
  deadlineSchedule,
  deliverEmail,
} = vi.hoisted(() => ({
  notificationCreate: vi.fn(),
  taskFindMany: vi.fn(),
  enqueueNotification: vi.fn(),
  deadlineSchedule: vi.fn(),
  deliverEmail: vi.fn(),
}));

vi.mock("../../src/config/db", () => ({
  prisma: {
    notification: { create: notificationCreate },
    task: { findMany: taskFindMany },
  },
}));
vi.mock("../../src/jobs/queues", () => ({
  enqueueNotification,
  getQueues: () => ({
    deadlines: { upsertJobScheduler: deadlineSchedule },
  }),
}));
vi.mock("../../src/utils/mailer", () => ({ deliverEmail }));

const {
  processEmail,
  processNotification,
  queueUpcomingDeadlineNotifications,
  scheduleDeadlineScan,
} = await import("../../src/jobs/workers/processors");

describe("background job processors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delivers email jobs through the configured mailer", async () => {
    const data = {
      kind: "verify" as const,
      email: "member@example.com",
      token: "verification-token",
    };
    await processEmail(data);
    expect(deliverEmail).toHaveBeenCalledWith(data);
  });

  it("persists notification jobs using the notification model", async () => {
    const data = {
      organizationId: "org-a",
      userId: "user-a",
      type: NotificationType.TASK_ASSIGNED,
      title: "Task assigned to you",
      body: "Draft plan",
      resourceType: "task",
      resourceId: "task-a",
    };
    await processNotification(data);
    expect(notificationCreate).toHaveBeenCalledWith({ data });
  });

  it("queues due-soon task reminders once per task and due date", async () => {
    const dueAt = new Date("2026-10-07T08:00:00.000Z");
    taskFindMany.mockResolvedValue([
      {
        id: "task-a",
        organizationId: "org-a",
        assigneeId: "user-a",
        title: "Prepare release",
        dueAt,
      },
    ]);
    const now = new Date("2026-10-06T20:00:00.000Z");

    const count = await queueUpcomingDeadlineNotifications(now);

    expect(count).toBe(1);
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assigneeId: { not: null },
          dueAt: { gte: now, lt: new Date("2026-10-07T20:00:00.000Z") },
          status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELED] },
        },
      }),
    );
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        userId: "user-a",
        type: NotificationType.TASK_UPDATED,
        resourceId: "task-a",
      }),
      expect.objectContaining({
        jobId: "deadline-task-a-2026-10-07",
      }),
    );
  });

  it("schedules the deadline scan to repeat hourly", async () => {
    await scheduleDeadlineScan();
    expect(deadlineSchedule).toHaveBeenCalledWith(
      "upcoming-deadlines-hourly",
      { every: 60 * 60 * 1000 },
      { name: "scan-upcoming-deadlines", data: {} },
    );
  });
});
