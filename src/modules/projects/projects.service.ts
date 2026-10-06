import { prisma } from "../../config/db";
import {
  emitOrganizationEvent,
  REALTIME_SERVER_EVENTS,
} from "../../realtime/socket";
import { AppError } from "../../utils/AppError";
import type { Pagination } from "../../utils/pagination";
import * as activity from "../activity/activity.service";

type ProjectInput = {
  name?: string;
  description?: string | null;
  color?: string | null;
  teamId?: string | null;
  startsAt?: Date | null;
  dueAt?: Date | null;
};

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function ensureTeamBelongsToOrganization(
  organizationId: string,
  teamId: string | null | undefined,
  client: typeof prisma,
): Promise<void> {
  if (teamId == null) return;
  const team = await client.team.findUnique({
    where: { id_organizationId: { id: teamId, organizationId } },
    select: { id: true },
  });
  if (!team)
    throw new AppError("Team not found in this organization", 404, "NOT_FOUND");
}

function ensureDateRange(
  startsAt: Date | null | undefined,
  dueAt: Date | null | undefined,
): void {
  if (startsAt && dueAt && startsAt > dueAt) {
    throw new AppError(
      "Project start date must be before its due date",
      400,
      "VALIDATION_ERROR",
    );
  }
}

export async function listProjects(
  organizationId: string,
  pagination: Pagination,
) {
  const where = { organizationId };
  const [projects, totalItems] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: pagination.skip,
      take: pagination.take,
      include: { team: { select: { id: true, name: true } } },
    }),
    prisma.project.count({ where }),
  ]);
  return { projects, totalItems };
}

export async function getProject(organizationId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id_organizationId: { id: projectId, organizationId } },
    include: { team: { select: { id: true, name: true } } },
  });
  if (!project) throw new AppError("Project not found", 404, "NOT_FOUND");
  return project;
}

export async function createProject(
  organizationId: string,
  actorId: string,
  input: Required<Pick<ProjectInput, "name">> & ProjectInput,
) {
  ensureDateRange(input.startsAt, input.dueAt);
  await ensureTeamBelongsToOrganization(organizationId, input.teamId, prisma);
  const project = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        organizationId,
        name: input.name,
        description: input.description,
        color: input.color,
        teamId: input.teamId,
        startsAt: input.startsAt,
        dueAt: input.dueAt,
      },
      include: { team: { select: { id: true, name: true } } },
    });
    await activity.log(tx, {
      organizationId,
      actorId,
      action: "created",
      entityType: "project",
      entityId: project.id,
      metadata: { name: project.name },
    });
    return project;
  });
  emitOrganizationEvent(
    organizationId,
    REALTIME_SERVER_EVENTS.projectCreated,
    project,
  );
  return project;
}

export async function updateProject(
  organizationId: string,
  actorId: string,
  projectId: string,
  input: ProjectInput,
) {
  const existing = await prisma.project.findUnique({
    where: { id_organizationId: { id: projectId, organizationId } },
    select: { id: true, startsAt: true, dueAt: true },
  });
  if (!existing) throw new AppError("Project not found", 404, "NOT_FOUND");

  ensureDateRange(
    input.startsAt !== undefined ? input.startsAt : existing.startsAt,
    input.dueAt !== undefined ? input.dueAt : existing.dueAt,
  );
  await ensureTeamBelongsToOrganization(organizationId, input.teamId, prisma);
  try {
    const project = await prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id_organizationId: { id: projectId, organizationId } },
        data: input,
        include: { team: { select: { id: true, name: true } } },
      });
      await activity.log(tx, {
        organizationId,
        actorId,
        action: "updated",
        entityType: "project",
        entityId: project.id,
        metadata: { name: project.name },
      });
      return project;
    });
    emitOrganizationEvent(
      organizationId,
      REALTIME_SERVER_EVENTS.projectUpdated,
      project,
    );
    return project;
  } catch (error) {
    if (isPrismaError(error, "P2025"))
      throw new AppError("Project not found", 404, "NOT_FOUND");
    throw error;
  }
}

export async function deleteProject(
  organizationId: string,
  actorId: string,
  projectId: string,
) {
  try {
    const project = await prisma.$transaction(async (tx) => {
      const project = await tx.project.delete({
        where: { id_organizationId: { id: projectId, organizationId } },
      });
      await activity.log(tx, {
        organizationId,
        actorId,
        action: "deleted",
        entityType: "project",
        entityId: project.id,
        metadata: { name: project.name },
      });
      return project;
    });
    emitOrganizationEvent(
      organizationId,
      REALTIME_SERVER_EVENTS.projectDeleted,
      { projectId: project.id },
    );
  } catch (error) {
    if (isPrismaError(error, "P2025"))
      throw new AppError("Project not found", 404, "NOT_FOUND");
    throw error;
  }
}
