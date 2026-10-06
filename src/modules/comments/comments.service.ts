import {
  OrganizationRole,
  type OrganizationRole as OrganizationRoleType,
} from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/db";
import { AppError } from "../../utils/AppError";
import type { Pagination } from "../../utils/pagination";
import * as activity from "../activity/activity.service";

type WorkClient = Prisma.TransactionClient;

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function ensureTask(
  client: WorkClient,
  organizationId: string,
  taskId: string,
): Promise<void> {
  const task = await client.task.findUnique({
    where: { id_organizationId: { id: taskId, organizationId } },
    select: { id: true },
  });
  if (!task)
    throw new AppError("Task not found in this organization", 404, "NOT_FOUND");
}

export async function listTaskComments(
  organizationId: string,
  taskId: string,
  pagination: Pagination,
) {
  await ensureTask(prisma, organizationId, taskId);
  const where = { organizationId, taskId };
  const [comments, totalItems] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    }),
    prisma.comment.count({ where }),
  ]);
  return { comments, totalItems };
}

export async function createComment(
  organizationId: string,
  taskId: string,
  actorId: string,
  body: string,
) {
  return prisma.$transaction(async (tx) => {
    await ensureTask(tx, organizationId, taskId);
    const comment = await tx.comment.create({
      data: { organizationId, taskId, authorId: actorId, body },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    await activity.log(tx, {
      organizationId,
      actorId,
      action: "created",
      entityType: "comment",
      entityId: comment.id,
      metadata: { taskId },
    });
    return comment;
  });
}

async function findComment(organizationId: string, commentId: string) {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, organizationId },
    select: { id: true, taskId: true, authorId: true, body: true },
  });
  if (!comment) throw new AppError("Comment not found", 404, "NOT_FOUND");
  return comment;
}

function requireCommentPermission(
  authorId: string,
  actor: { userId: string; role: OrganizationRoleType },
): void {
  if (
    authorId !== actor.userId &&
    actor.role !== OrganizationRole.OWNER &&
    actor.role !== OrganizationRole.ADMIN
  ) {
    throw new AppError(
      "Only the comment author or an organization owner/admin can manage this comment",
      403,
      "FORBIDDEN",
    );
  }
}

export async function updateComment(
  organizationId: string,
  commentId: string,
  actor: { userId: string; role: OrganizationRoleType },
  body: string,
) {
  const existing = await findComment(organizationId, commentId);
  requireCommentPermission(existing.authorId, actor);
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.comment.updateMany({
        where: { id: existing.id, organizationId },
        data: { body, editedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new AppError("Comment not found", 404, "NOT_FOUND");
      }
      const comment = await tx.comment.findFirst({
        where: { id: existing.id, organizationId },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      });
      if (!comment) throw new AppError("Comment not found", 404, "NOT_FOUND");
      await activity.log(tx, {
        organizationId,
        actorId: actor.userId,
        action: "updated",
        entityType: "comment",
        entityId: comment.id,
        metadata: { taskId: existing.taskId },
      });
      return comment;
    });
  } catch (error) {
    if (isPrismaError(error, "P2025"))
      throw new AppError("Comment not found", 404, "NOT_FOUND");
    throw error;
  }
}

export async function deleteComment(
  organizationId: string,
  commentId: string,
  actor: { userId: string; role: OrganizationRoleType },
) {
  const existing = await findComment(organizationId, commentId);
  requireCommentPermission(existing.authorId, actor);
  try {
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.comment.deleteMany({
        where: { id: existing.id, organizationId },
      });
      if (deleted.count !== 1) {
        throw new AppError("Comment not found", 404, "NOT_FOUND");
      }
      await activity.log(tx, {
        organizationId,
        actorId: actor.userId,
        action: "deleted",
        entityType: "comment",
        entityId: existing.id,
        metadata: { taskId: existing.taskId },
      });
    });
  } catch (error) {
    if (isPrismaError(error, "P2025"))
      throw new AppError("Comment not found", 404, "NOT_FOUND");
    throw error;
  }
}
