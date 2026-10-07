import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiRequestStatus, UsageMetric } from "../../generated/prisma/enums";

const { delegates, tx, generateContent } = vi.hoisted(() => {
  const delegates = {
    task: { findUnique: vi.fn() },
    aiRequest: { update: vi.fn() },
  };
  const tx = {
    aiRequest: { update: vi.fn() },
    usageRecord: { create: vi.fn() },
  };
  return { delegates, tx, generateContent: vi.fn() };
});

vi.mock("../../src/config/db", () => ({
  prisma: {
    ...delegates,
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  },
}));
vi.mock("../../src/config/google", () => ({
  getGoogleGenAIClient: () => ({
    models: { generateContent },
  }),
}));
vi.mock("../../src/jobs/queues", () => ({
  enqueueNotification: vi.fn(),
  getQueues: vi.fn(),
}));
vi.mock("../../src/utils/mailer", () => ({ deliverEmail: vi.fn() }));
vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
vi.stubEnv("GLM_MODEL", "gemini-test");

const { processAiRequest } = await import("../../src/jobs/workers/processors");

const task = {
  title: "Prepare release",
  description: "Validate the release candidate and publish notes.",
  status: "IN_PROGRESS",
  priority: "HIGH",
  subtasks: [{ title: "Run regression tests", status: "TODO" }],
};

describe("AI background processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delegates.task.findUnique.mockResolvedValue(task);
    delegates.aiRequest.update.mockResolvedValue({});
    tx.aiRequest.update.mockResolvedValue({});
    tx.usageRecord.create.mockResolvedValue({});
    generateContent.mockResolvedValue({
      text: "A concise task summary.",
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
    });
  });

  it("generates and stores task summaries with token usage", async () => {
    await processAiRequest({
      requestId: "request-a",
      organizationId: "org-a",
      userId: "user-a",
      taskId: "task-a",
      feature: "task-summary",
    });

    expect(delegates.aiRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "request-a" },
        data: { status: AiRequestStatus.PROCESSING },
      }),
    );
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-test",
        contents: expect.stringContaining("Prepare release"),
      }),
    );
    expect(tx.aiRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AiRequestStatus.SUCCEEDED,
          succeeded: true,
          inputTokens: 100,
          outputTokens: 20,
          result: { summary: "A concise task summary." },
        }),
      }),
    );
    expect(tx.usageRecord.create).toHaveBeenCalledTimes(2);
    expect(tx.usageRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metric: UsageMetric.AI_INPUT_TOKENS,
          quantity: 100,
        }),
      }),
    );
  });

  it("validates generated subtasks before storing the result", async () => {
    generateContent.mockResolvedValueOnce({
      text: '[{"title":"Review deployment","description":"Check production readiness."}]',
      usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 15 },
    });

    await processAiRequest({
      requestId: "request-b",
      organizationId: "org-a",
      userId: "user-a",
      taskId: "task-a",
      feature: "subtask-generation",
      subtaskCount: 1,
    });

    expect(tx.aiRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: {
            subtasks: [
              {
                title: "Review deployment",
                description: "Check production readiness.",
              },
            ],
          },
        }),
      }),
    );
  });

  it("marks failed jobs and propagates the error", async () => {
    delegates.task.findUnique.mockResolvedValueOnce(null);

    await expect(
      processAiRequest({
        requestId: "request-c",
        organizationId: "org-a",
        userId: "user-a",
        taskId: "missing",
        feature: "task-summary",
      }),
    ).rejects.toThrow("Task not found");
    expect(delegates.aiRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AiRequestStatus.FAILED,
          succeeded: false,
          error: "AI generation failed; try again later",
        }),
      }),
    );
  });
});
