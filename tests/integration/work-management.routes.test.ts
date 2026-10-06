import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MembershipStatus,
  OrganizationRole,
} from "../../generated/prisma/enums";

const { delegates } = vi.hoisted(() => {
  const model = () => ({
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  return {
    delegates: {
      membership: model(),
      team: model(),
      teamMembership: model(),
      project: model(),
      task: model(),
      comment: model(),
      activityLog: model(),
    },
  };
});

vi.mock("../../src/config/db", () => ({
  prisma: {
    ...delegates,
    $transaction: vi.fn(
      async (operation: (transaction: typeof delegates) => unknown) =>
        operation(delegates),
    ),
  },
}));

vi.mock("../../src/config/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    incr: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("../../src/middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    const userId = req.header("authorization")?.replace(/^Bearer /, "");
    if (userId) req.auth = { userId, email: `${userId}@example.com` };
    next();
  },
}));

vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
vi.stubEnv(
  "JWT_ACCESS_TOKEN_SECRET",
  "test-secret-that-is-long-enough-for-jwt",
);

const { errorHandler } = await import("../../src/middleware/errorHandler");
const { organizationsRouter } =
  await import("../../src/modules/organizations/organizations.routes");
const { teamsRouter } = await import("../../src/modules/teams/teams.routes");
const { projectsRouter } =
  await import("../../src/modules/projects/projects.routes");
const { tasksRouter } = await import("../../src/modules/tasks/tasks.routes");
const { projectTasksRouter } =
  await import("../../src/modules/tasks/tasks.routes");
const { taskCommentsRouter, commentsRouter } =
  await import("../../src/modules/comments/comments.routes");

const app = express();
app.use(express.json());
app.use("/organizations", organizationsRouter);
app.use("/organizations/:organizationId/teams", teamsRouter);
app.use("/organizations/:organizationId/projects", projectsRouter);
app.use(
  "/organizations/:organizationId/projects/:projectId/tasks",
  projectTasksRouter,
);
app.use("/organizations/:organizationId/tasks", tasksRouter);
app.use(
  "/organizations/:organizationId/tasks/:taskId/comments",
  taskCommentsRouter,
);
app.use("/organizations/:organizationId/comments", commentsRouter);
app.use(errorHandler);

describe("teams, projects, tasks, and comments routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delegates.membership.findUnique.mockReset();
    delegates.membership.findUnique.mockResolvedValue({
      organizationId: "org-a",
      userId: "owner-a",
      role: OrganizationRole.OWNER,
      status: MembershipStatus.ACTIVE,
    });
    delegates.activityLog.create.mockResolvedValue({});
  });

  it("creates teams inside the authorized organization and records activity", async () => {
    delegates.team.create.mockResolvedValue({ id: "team-a", name: "Design" });

    const response = await request(app)
      .post("/organizations/org-a/teams")
      .set("Authorization", "Bearer owner-a")
      .send({ name: "Design" });

    expect(response.status).toBe(201);
    expect(delegates.team.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-a" }),
      }),
    );
    expect(delegates.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          actorId: "owner-a",
          action: "created",
          entityType: "team",
          entityId: "team-a",
        }),
      }),
    );
  });

  it("requires authentication on the work-management routes", async () => {
    const response = await request(app).get("/organizations/org-a/teams");

    expect(response.status).toBe(401);
    expect(delegates.team.findMany).not.toHaveBeenCalled();
  });

  it("paginates team lists and scopes them by organization", async () => {
    delegates.team.findMany.mockResolvedValue([]);
    delegates.team.count.mockResolvedValue(0);

    const response = await request(app)
      .get("/organizations/org-a/teams?page=2&pageSize=5")
      .set("Authorization", "Bearer owner-a");

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      page: 2,
      pageSize: 5,
      totalItems: 0,
      totalPages: 0,
    });
    expect(delegates.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a" },
        skip: 5,
        take: 5,
      }),
    );
  });

  it("denies work-management access to inactive organization members", async () => {
    delegates.membership.findUnique.mockResolvedValue({
      organizationId: "org-a",
      userId: "owner-a",
      role: OrganizationRole.MEMBER,
      status: MembershipStatus.SUSPENDED,
    });

    const response = await request(app)
      .get("/organizations/org-a/teams")
      .set("Authorization", "Bearer owner-a");

    expect(response.status).toBe(404);
    expect(delegates.team.findMany).not.toHaveBeenCalled();
  });

  it("rejects attaching a team from another organization to a project", async () => {
    delegates.team.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post("/organizations/org-a/projects")
      .set("Authorization", "Bearer owner-a")
      .send({ name: "Launch", teamId: "team-from-org-b" });

    expect(response.status, JSON.stringify(response.body)).toBe(404);
    expect(delegates.team.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id_organizationId: { id: "team-from-org-b", organizationId: "org-a" },
        },
      }),
    );
    expect(delegates.project.create).not.toHaveBeenCalled();
  });

  it("creates projects within the organization and records activity", async () => {
    delegates.project.create.mockResolvedValue({
      id: "project-a",
      name: "Launch",
    });

    const response = await request(app)
      .post("/organizations/org-a/projects")
      .set("Authorization", "Bearer owner-a")
      .send({ name: "Launch", dueAt: "2026-12-01T00:00:00.000Z" });

    expect(response.status).toBe(201);
    expect(delegates.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          name: "Launch",
          dueAt: new Date("2026-12-01T00:00:00.000Z"),
        }),
      }),
    );
    expect(delegates.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          entityType: "project",
          entityId: "project-a",
          action: "created",
        }),
      }),
    );
  });

  it("creates an assigned subtask in the same project and organization", async () => {
    delegates.project.findUnique.mockResolvedValue({ id: "project-a" });
    delegates.task.findUnique.mockResolvedValue({
      id: "parent-a",
      projectId: "project-a",
      parentId: null,
    });
    delegates.task.create.mockResolvedValue({
      id: "subtask-a",
      title: "Draft copy",
      parentId: "parent-a",
    });

    const response = await request(app)
      .post("/organizations/org-a/projects/project-a/tasks")
      .set("Authorization", "Bearer owner-a")
      .send({
        title: "Draft copy",
        parentId: "parent-a",
        assigneeId: "owner-a",
        priority: "HIGH",
        dueAt: "2026-11-01T00:00:00.000Z",
      });

    expect(response.status).toBe(201);
    expect(delegates.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          projectId: "project-a",
          parentId: "parent-a",
          assigneeId: "owner-a",
          dueAt: new Date("2026-11-01T00:00:00.000Z"),
        }),
      }),
    );
    expect(delegates.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "task",
          entityId: "subtask-a",
          action: "created",
        }),
      }),
    );
  });

  it("rejects assigning a task to a user outside the organization", async () => {
    delegates.project.findUnique.mockResolvedValue({
      id: "project-a",
      organizationId: "org-a",
    });
    delegates.membership.findUnique
      .mockResolvedValueOnce({
        organizationId: "org-a",
        userId: "owner-a",
        role: OrganizationRole.OWNER,
        status: MembershipStatus.ACTIVE,
      })
      .mockResolvedValueOnce(null);

    const response = await request(app)
      .post("/organizations/org-a/projects/project-a/tasks")
      .set("Authorization", "Bearer owner-a")
      .send({ title: "Prepare launch", assigneeId: "user-from-org-b" });

    expect(response.status, JSON.stringify(response.body)).toBe(404);
    expect(delegates.membership.findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          organizationId_userId: {
            organizationId: "org-a",
            userId: "user-from-org-b",
          },
        },
      }),
    );
    expect(delegates.task.create).not.toHaveBeenCalled();
  });

  it("records task status updates as organization activity", async () => {
    delegates.task.findUnique.mockResolvedValue({
      id: "task-a",
      projectId: "project-a",
      status: "TODO",
      title: "Prepare launch",
    });
    delegates.task.update.mockResolvedValue({
      id: "task-a",
      status: "DONE",
      title: "Prepare launch",
    });

    const response = await request(app)
      .patch("/organizations/org-a/tasks/task-a")
      .set("Authorization", "Bearer owner-a")
      .send({ status: "DONE" });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(delegates.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_organizationId: { id: "task-a", organizationId: "org-a" } },
        data: expect.objectContaining({
          status: "DONE",
          completedAt: expect.any(Date),
        }),
      }),
    );
    expect(delegates.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          entityType: "task",
          entityId: "task-a",
          action: "updated",
        }),
      }),
    );
  });

  it("rejects task-parent updates that would create a hierarchy cycle", async () => {
    delegates.task.findUnique
      .mockResolvedValueOnce({
        id: "task-a",
        projectId: "project-a",
        status: "TODO",
        startsAt: null,
        dueAt: null,
      })
      .mockResolvedValueOnce({
        id: "subtask-a",
        projectId: "project-a",
        parentId: "task-a",
      });

    const response = await request(app)
      .patch("/organizations/org-a/tasks/task-a")
      .set("Authorization", "Bearer owner-a")
      .send({ parentId: "subtask-a" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("TASK_HIERARCHY_CYCLE");
    expect(delegates.task.update).not.toHaveBeenCalled();
  });

  it("does not expose comments for a task outside the organization", async () => {
    delegates.task.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get("/organizations/org-a/tasks/task-from-org-b/comments")
      .set("Authorization", "Bearer owner-a");

    expect(response.status).toBe(404);
    expect(delegates.comment.findMany).not.toHaveBeenCalled();
  });

  it("creates comments only on organization-scoped tasks and records activity", async () => {
    delegates.task.findUnique.mockResolvedValue({ id: "task-a" });
    delegates.comment.create.mockResolvedValue({
      id: "comment-a",
      body: "Looks good",
    });

    const response = await request(app)
      .post("/organizations/org-a/tasks/task-a/comments")
      .set("Authorization", "Bearer owner-a")
      .send({ body: "Looks good" });

    expect(response.status).toBe(201);
    expect(delegates.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          organizationId: "org-a",
          taskId: "task-a",
          authorId: "owner-a",
          body: "Looks good",
        },
      }),
    );
    expect(delegates.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "comment",
          entityId: "comment-a",
          action: "created",
        }),
      }),
    );
  });

  it("allows only comment authors or organization admins to edit comments", async () => {
    delegates.membership.findUnique.mockResolvedValue({
      organizationId: "org-a",
      userId: "owner-a",
      role: OrganizationRole.MEMBER,
      status: MembershipStatus.ACTIVE,
    });
    delegates.comment.findFirst.mockResolvedValue({
      id: "comment-a",
      authorId: "another-user",
      body: "Existing comment",
    });

    const response = await request(app)
      .patch("/organizations/org-a/comments/comment-a")
      .set("Authorization", "Bearer owner-a")
      .send({ body: "Edited comment" });

    expect(response.status).toBe(403);
    expect(delegates.comment.updateMany).not.toHaveBeenCalled();
  });

  it("updates comments with an organization-scoped write and activity entry", async () => {
    delegates.comment.findFirst
      .mockResolvedValueOnce({
        id: "comment-a",
        taskId: "task-a",
        authorId: "another-user",
        body: "Existing comment",
      })
      .mockResolvedValueOnce({
        id: "comment-a",
        taskId: "task-a",
        authorId: "another-user",
        body: "Edited comment",
        author: { id: "another-user", name: "Member", avatarUrl: null },
      });
    delegates.comment.updateMany.mockResolvedValue({ count: 1 });

    const response = await request(app)
      .patch("/organizations/org-a/comments/comment-a")
      .set("Authorization", "Bearer owner-a")
      .send({ body: "Edited comment" });

    expect(response.status).toBe(200);
    expect(delegates.comment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "comment-a", organizationId: "org-a" },
        data: expect.objectContaining({
          body: "Edited comment",
          editedAt: expect.any(Date),
        }),
      }),
    );
    expect(delegates.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-a",
          entityType: "comment",
          entityId: "comment-a",
          action: "updated",
        }),
      }),
    );
  });

  it("rejects invalid pagination parameters", async () => {
    const response = await request(app)
      .get("/organizations/org-a/teams?page=0")
      .set("Authorization", "Bearer owner-a");

    expect(response.status).toBe(400);
    expect(delegates.team.findMany).not.toHaveBeenCalled();
  });
});
