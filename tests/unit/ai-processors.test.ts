import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiRequestStatus, UsageMetric } from "../../generated/prisma/enums";

const { delegates, tx, anthropicCreate } = vi.hoisted(() => {
  const delegates = {
    task: { findUnique: vi.fn() },
    aiRequest: { update: vi.fn() },
  };
  const tx = {
    aiRequest: { update: vi.fn() },
    usageRecord: { create: vi.fn() },
  };
  return { delegates, tx, anthropicCreate: vi.fn() };
});

vi.mock("../../src/config/db", () => ({
  prisma: {
    ...delegates,
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
      operation(tx),
    ),
  },
}));
vi.mock("../../src/config/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));
vi.mock("../../src/jobs/queues", () => ({
  enqueueNotification: vi.fn(),
  getQueues: vi.fn(),
}));
vi.mock("../../src/utils/mailer", () => ({ deliverEmail: vi.fn() }));
vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
vi.stubEnv("ANTHROPIC_MODEL", "claude-test");

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
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "A concise task summary." }],
      usage: { input_tokens: 100, output_tokens: 20 },
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
    expect(anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-test",
        messages: [
          expect.objectContaining({
            content: expect.stringContaining("Prepare release"),
          }),
        ],
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
    anthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '[{"title":"Review deployment","description":"Check production readiness."}]',
        },
      ],
      usage: { input_tokens: 90, output_tokens: 15 },
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
