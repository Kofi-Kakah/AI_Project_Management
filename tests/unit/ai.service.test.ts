import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiRequestStatus,
  SubscriptionStatus,
  UsageMetric,
} from "../../generated/prisma/enums";

const { delegates, tx, enqueueAiJob } = vi.hoisted(() => {
  const delegates = {
    task: { findUnique: vi.fn() },
    aiRequest: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    usageRecord: { aggregate: vi.fn() },
    subscription: { findUnique: vi.fn() },
  };
  const tx = {
    subscription: { findUnique: vi.fn() },
    usageRecord: {
      aggregate: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    aiRequest: { create: vi.fn() },
  };
  return { delegates, tx, enqueueAiJob: vi.fn() };
});

vi.mock("../../src/config/db", () => ({
  prisma: {
    ...delegates,
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  },
}));
vi.mock("../../src/jobs/queues", () => ({ enqueueAiJob }));
vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
vi.stubEnv("GLM_API_KEY", "test-api-key");
vi.stubEnv("GLM_MODEL", "gemini-test");

const { getAiRequest, queueSubtaskGeneration, queueTaskSummary } =
  await import("../../src/modules/ai/ai.service");

describe("AI request service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delegates.task.findUnique.mockResolvedValue({ id: "task-a" });
    tx.subscription.findUnique.mockResolvedValue(null);
    tx.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    tx.aiRequest.create.mockResolvedValue({
      id: "request-a",
      status: AiRequestStatus.QUEUED,
      createdAt: new Date("2026-10-07T00:00:00.000Z"),
    });
    tx.usageRecord.create.mockResolvedValue({});
    enqueueAiJob.mockResolvedValue(undefined);
  });

  it("blocks AI requests on the Free plan without enqueueing or charging", async () => {
    await expect(
      queueTaskSummary("org-a", "user-a", "task-a"),
    ).rejects.toMatchObject({
      statusCode: 402,
      code: "PLAN_LIMIT_EXCEEDED",
    });

    expect(tx.aiRequest.create).not.toHaveBeenCalled();
    expect(enqueueAiJob).not.toHaveBeenCalled();
  });

  it("queues a subtask request on Pro and records its monthly AI usage", async () => {
    tx.subscription.findUnique.mockResolvedValue({
      plan: "PRO",
      status: SubscriptionStatus.ACTIVE,
    });
    tx.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 17 } });

    const request = await queueSubtaskGeneration(
      "org-a",
      "user-a",
      "task-a",
      4,
    );

    expect(request.status).toBe(AiRequestStatus.QUEUED);
    expect(tx.aiRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          userId: "user-a",
          feature: "subtask-generation",
          model: "gemini-test",
          succeeded: false,
        }),
      }),
    );
    expect(tx.usageRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          metric: UsageMetric.AI_REQUEST,
          idempotencyKey: "ai-request:request-a",
        }),
      }),
    );
    expect(enqueueAiJob).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-a",
        organizationId: "org-a",
        userId: "user-a",
        taskId: "task-a",
        feature: "subtask-generation",
        subtaskCount: 4,
      }),
    );
  });

  it("rejects a request once the monthly Pro quota is exhausted", async () => {
    tx.subscription.findUnique.mockResolvedValue({
      plan: "PRO",
      status: SubscriptionStatus.ACTIVE,
    });
    tx.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 500 } });

    await expect(
      queueTaskSummary("org-a", "user-a", "task-a"),
    ).rejects.toMatchObject({ statusCode: 402 });
    expect(tx.aiRequest.create).not.toHaveBeenCalled();
  });

  it("hides AI requests owned by a different user or organization", async () => {
    delegates.aiRequest.findFirst.mockResolvedValue(null);

    await expect(
      getAiRequest("org-a", "user-a", "request-b"),
    ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    expect(delegates.aiRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "request-b", organizationId: "org-a", userId: "user-a" },
      }),
    );
  });
});
