import {
  MembershipStatus,
  TaskStatus,
  type TaskPriority as TaskPriorityType,
  type TaskStatus as TaskStatusType,
} from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/db";
import { AppError } from "../../utils/AppError";
import type { Pagination } from "../../utils/pagination";
import * as activity from "../activity/activity.service";

type TaskInput = {
  title?: string;
  description?: string | null;
  status?: TaskStatusType;
  priority?: TaskPriorityType;
  position?: number;
  parentId?: string | null;
  assigneeId?: string | null;
  startsAt?: Date | null;
  dueAt?: Date | null;
};

type ListTaskFilters = {
  status?: TaskStatusType;
  priority?: TaskPriorityType;
  assigneeId?: string;
  parentId?: string;
};

type WorkClient = Prisma.TransactionClient;

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function ensureDateRange(
  startsAt: Date | null | undefined,
  dueAt: Date | null | undefined,
): void {
  if (startsAt && dueAt && startsAt > dueAt) {
    throw new AppError(
      "Task start date must be before its due date",
      400,
      "VALIDATION_ERROR",
    );
  }
}

async function ensureProject(
  client: WorkClient,
  organizationId: string,
  projectId: string,
): Promise<void> {
  const project = await client.project.findUnique({
    where: { id_organizationId: { id: projectId, organizationId } },
    select: { id: true },
  });
  if (!project)
    throw new AppError(
      "Project not found in this organization",
      404,
      "NOT_FOUND",
    );
}

async function ensureAssignee(
  client: WorkClient,
  organizationId: string,
  assigneeId: string | null | undefined,
): Promise<void> {
  if (!assigneeId) return;
  const membership = await client.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: assigneeId } },
    select: { status: true },
  });
  if (!membership || membership.status !== MembershipStatus.ACTIVE) {
    throw new AppError(
      "Assignee must be an active organization member",
      404,
      "USER_NOT_FOUND",
    );
  }
}

async function ensureParent(
  client: WorkClient,
  organizationId: string,
  projectId: string,
  parentId: string | null | undefined,
  taskId?: string,
): Promise<void> {
  if (parentId == null) return;
  const visited = new Set<string>();
  let ancestorId: string | null = parentId;

  while (ancestorId) {
    if (ancestorId === taskId) {
      throw new AppError(
        "A task cannot be its own ancestor",
        400,
        "TASK_HIERARCHY_CYCLE",
      );
    }
    if (visited.has(ancestorId)) {
      throw new AppError(
        "The existing task hierarchy is invalid",
        409,
        "TASK_HIERARCHY_INVALID",
      );
    }
    visited.add(ancestorId);

    const ancestor: {
      id: string;
      projectId: string;
      parentId: string | null;
    } | null = await client.task.findUnique({
      where: { id_organizationId: { id: ancestorId, organizationId } },
      select: { id: true, projectId: true, parentId: true },
    });
    if (!ancestor || ancestor.projectId !== projectId) {
      throw new AppError(
        "Parent task not found in this project",
        404,
        "NOT_FOUND",
      );
    }
    ancestorId = ancestor.parentId;
  }
}

export async function listTasks(
  organizationId: string,
  projectId: string,
  pagination: Pagination,
  filters: ListTaskFilters,
) {
  await ensureProject(prisma, organizationId, projectId);
  if (filters.parentId) {
    await ensureParent(prisma, organizationId, projectId, filters.parentId);
  }
  const where = {
    organizationId,
    projectId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
    ...(filters.parentId ? { parentId: filters.parentId } : {}),
  };
  const [tasks, totalItems] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        _count: { select: { subtasks: true, comments: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);
  return { tasks, totalItems };
}

export async function getTask(organizationId: string, taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id_organizationId: { id: taskId, organizationId } },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      parent: { select: { id: true, title: true } },
      subtasks: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          assigneeId: true,
          dueAt: true,
        },
      },
    },
  });
  if (!task) throw new AppError("Task not found", 404, "NOT_FOUND");
  return task;
}

export async function createTask(
  organizationId: string,
  actorId: string,
  projectId: string,
  input: Required<Pick<TaskInput, "title">> & TaskInput,
) {
  ensureDateRange(input.startsAt, input.dueAt);
  return prisma.$transaction(async (tx) => {
    await ensureProject(tx, organizationId, projectId);
    await ensureParent(tx, organizationId, projectId, input.parentId);
    await ensureAssignee(tx, organizationId, input.assigneeId);
    const task = await tx.task.create({
      data: {
        organizationId,
        projectId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        position: input.position,
        parentId: input.parentId,
        assigneeId: input.assigneeId,
        startsAt: input.startsAt,
        dueAt: input.dueAt,
        ...(input.status === TaskStatus.DONE
          ? { completedAt: new Date() }
          : {}),
      },
      include: { assignee: { select: { id: true, name: true, email: true } } },
    });
    await activity.log(tx, {
      organizationId,
      actorId,
      action: "created",
      entityType: "task",
      entityId: task.id,
      metadata: { title: task.title, projectId },
    });
    return task;
  });
}

export async function updateTask(
  organizationId: string,
  actorId: string,
  taskId: string,
  input: TaskInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.task.findUnique({
        where: { id_organizationId: { id: taskId, organizationId } },
        select: {
          id: true,
          projectId: true,
          status: true,
          startsAt: true,
          dueAt: true,
        },
      });
      if (!existing) throw new AppError("Task not found", 404, "NOT_FOUND");

      if (input.parentId !== undefined) {
        await ensureParent(
          tx,
          organizationId,
          existing.projectId,
          input.parentId,
          existing.id,
        );
      }
      if (input.assigneeId !== undefined) {
        await ensureAssignee(tx, organizationId, input.assigneeId);
      }
      ensureDateRange(
        input.startsAt !== undefined ? input.startsAt : existing.startsAt,
        input.dueAt !== undefined ? input.dueAt : existing.dueAt,
      );

      const data = {
        ...input,
        ...(input.status !== undefined
          ? {
              completedAt: input.status === TaskStatus.DONE ? new Date() : null,
            }
          : {}),
      };
      const task = await tx.task.update({
        where: { id_organizationId: { id: existing.id, organizationId } },
        data,
        include: {
          assignee: { select: { id: true, name: true, email: true } },
        },
      });
      await activity.log(tx, {
        organizationId,
        actorId,
        action: "updated",
        entityType: "task",
        entityId: task.id,
        metadata: { title: task.title, projectId: existing.projectId },
      });
      return task;
    });
  } catch (error) {
    if (isPrismaError(error, "P2025"))
      throw new AppError("Task not found", 404, "NOT_FOUND");
    throw error;
  }
}

export async function deleteTask(
  organizationId: string,
  actorId: string,
  taskId: string,
) {
  try {
    await prisma.$transaction(async (tx) => {
      const task = await tx.task.delete({
        where: { id_organizationId: { id: taskId, organizationId } },
      });
      await activity.log(tx, {
        organizationId,
        actorId,
        action: "deleted",
        entityType: "task",
        entityId: task.id,
        metadata: { title: task.title, projectId: task.projectId },
      });
    });
  } catch (error) {
    if (isPrismaError(error, "P2025"))
      throw new AppError("Task not found", 404, "NOT_FOUND");
    throw error;
  }
}
