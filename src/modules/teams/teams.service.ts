import { prisma } from "../../config/db";
import { AppError } from "../../utils/AppError";
import type { Pagination } from "../../utils/pagination";
import * as activity from "../activity/activity.service";

type TeamInput = {
  name?: string;
  description?: string | null;
};

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export async function listTeams(
  organizationId: string,
  pagination: Pagination,
) {
  const where = { organizationId };
  const [teams, totalItems] = await Promise.all([
    prisma.team.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.team.count({ where }),
  ]);
  return { teams, totalItems };
}

export async function getTeam(organizationId: string, teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id_organizationId: { id: teamId, organizationId } },
  });
  if (!team) throw new AppError("Team not found", 404, "NOT_FOUND");
  return team;
}

export async function createTeam(
  organizationId: string,
  actorId: string,
  input: Required<Pick<TeamInput, "name">> & TeamInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          organizationId,
          name: input.name,
          description: input.description,
        },
      });
      await activity.log(tx, {
        organizationId,
        actorId,
        action: "created",
        entityType: "team",
        entityId: team.id,
        metadata: { name: team.name },
      });
      return team;
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      throw new AppError(
        "A team with this name already exists",
        409,
        "TEAM_CONFLICT",
      );
    }
    throw error;
  }
}

export async function updateTeam(
  organizationId: string,
  actorId: string,
  teamId: string,
  input: TeamInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const team = await tx.team.update({
        where: { id_organizationId: { id: teamId, organizationId } },
        data: input,
      });
      await activity.log(tx, {
        organizationId,
        actorId,
        action: "updated",
        entityType: "team",
        entityId: team.id,
        metadata: { name: team.name },
      });
      return team;
    });
  } catch (error) {
    if (isPrismaError(error, "P2025"))
      throw new AppError("Team not found", 404, "NOT_FOUND");
    if (isPrismaError(error, "P2002")) {
      throw new AppError(
        "A team with this name already exists",
        409,
        "TEAM_CONFLICT",
      );
    }
    throw error;
  }
}

export async function deleteTeam(
  organizationId: string,
  actorId: string,
  teamId: string,
) {
  try {
    await prisma.$transaction(async (tx) => {
      const team = await tx.team.delete({
        where: { id_organizationId: { id: teamId, organizationId } },
      });
      await activity.log(tx, {
        organizationId,
        actorId,
        action: "deleted",
        entityType: "team",
        entityId: team.id,
        metadata: { name: team.name },
      });
    });
  } catch (error) {
    if (isPrismaError(error, "P2025"))
      throw new AppError("Team not found", 404, "NOT_FOUND");
    if (isPrismaError(error, "P2003")) {
      throw new AppError(
        "A team with active projects cannot be deleted",
        409,
        "TEAM_IN_USE",
      );
    }
    throw error;
  }
}
