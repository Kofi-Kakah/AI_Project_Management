import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MembershipStatus,
  OrganizationRole,
} from "../../generated/prisma/enums";

const { userFindUnique, membershipFindUnique, aiRequest, aiSubtasks } =
  vi.hoisted(() => ({
    userFindUnique: vi.fn(),
    membershipFindUnique: vi.fn(),
    aiRequest: vi.fn(),
    aiSubtasks: vi.fn(),
  }));

vi.mock("../../src/config/db", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    membership: { findUnique: membershipFindUnique },
  },
}));
vi.mock("../../src/middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const userId = req.header("authorization");
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.auth = { userId, email: `${userId}@example.com` };
    next();
  },
}));
vi.mock("../../src/modules/ai/ai.service", () => ({
  queueTaskSummary: aiRequest,
  queueSubtaskGeneration: aiSubtasks,
  getAiRequest: vi.fn(),
}));
vi.mock("../../src/modules/admin/admin.service", () => ({
  getPlatformStats: vi.fn().mockResolvedValue({ totals: { users: 7 } }),
}));
vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");

const { errorHandler } = await import("../../src/middleware/errorHandler");
const { aiRouter } = await import("../../src/modules/ai/ai.routes");
const { adminRouter } = await import("../../src/modules/admin/admin.routes");
const { getPlatformStats } =
  await import("../../src/modules/admin/admin.service");

const app = express();
app.use(express.json());
app.use("/organizations/:organizationId/ai", aiRouter);
app.use("/admin", adminRouter);
app.use(errorHandler);

describe("AI and platform-admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipFindUnique.mockResolvedValue({
      organizationId: "org-a",
      userId: "user-a",
      role: OrganizationRole.MEMBER,
      status: MembershipStatus.ACTIVE,
    });
    aiRequest.mockResolvedValue({
      id: "request-a",
      status: "QUEUED",
    });
    aiSubtasks.mockResolvedValue({
      id: "request-a",
      status: "QUEUED",
    });
    vi.mocked(getPlatformStats).mockResolvedValue({
      totals: { users: 7 },
    } as Awaited<ReturnType<typeof getPlatformStats>>);
  });

  it("queues task summaries only for active organization members", async () => {
    const response = await request(app)
      .post("/organizations/org-a/ai/tasks/task-a/summary")
      .set("Authorization", "user-a");

    expect(response.status).toBe(202);
    expect(response.body.request).toEqual({
      id: "request-a",
      status: "QUEUED",
    });
    expect(aiRequest).toHaveBeenCalledWith("org-a", "user-a", "task-a");
  });

  it("defaults subtask generation to five items when no body is sent", async () => {
    const response = await request(app)
      .post("/organizations/org-a/ai/tasks/task-a/subtasks")
      .set("Authorization", "user-a");

    expect(response.status).toBe(202);
    expect(aiSubtasks).toHaveBeenCalledWith("org-a", "user-a", "task-a", 5);
  });

  it("requires a platform-admin flag for admin stats", async () => {
    userFindUnique.mockResolvedValue({
      isPlatformAdmin: false,
      disabledAt: null,
    });

    const response = await request(app)
      .get("/admin/stats")
      .set("Authorization", "user-a");

    expect(response.status).toBe(403);
    expect(getPlatformStats).not.toHaveBeenCalled();
  });

  it("returns aggregate stats to an enabled platform administrator", async () => {
    userFindUnique.mockResolvedValue({
      isPlatformAdmin: true,
      disabledAt: null,
    });

    const response = await request(app)
      .get("/admin/stats")
      .set("Authorization", "admin-a");

    expect(response.status).toBe(200);
    expect(response.body.stats.totals.users).toBe(7);
    expect(getPlatformStats).toHaveBeenCalledOnce();
  });
});
