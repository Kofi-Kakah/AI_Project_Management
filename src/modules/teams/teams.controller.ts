import type { RequestHandler } from "express";
import { AppError } from "../../utils/AppError";
import { paginationMetadata, parsePagination } from "../../utils/pagination";
import { routeParam } from "../../utils/routeParams";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
} from "./teams.service";

function actorId(req: Parameters<RequestHandler>[0]): string {
  const userId = req.auth?.userId;
  if (!userId)
    throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  return userId;
}

function organizationId(req: Parameters<RequestHandler>[0]): string {
  const id = req.organization?.id;
  if (!id)
    throw new AppError(
      "Organization access was not authorized",
      403,
      "FORBIDDEN",
    );
  return id;
}

export const list: RequestHandler = async (req, res, next) => {
  try {
    const page = parsePagination(req.query);
    const result = await listTeams(organizationId(req), page);
    res.json({
      teams: result.teams,
      pagination: paginationMetadata(
        page.page,
        page.pageSize,
        result.totalItems,
      ),
    });
  } catch (error) {
    next(error);
  }
};

export const get: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      team: await getTeam(organizationId(req), routeParam(req, "teamId")),
    });
  } catch (error) {
    next(error);
  }
};

export const create: RequestHandler = async (req, res, next) => {
  try {
    const team = await createTeam(organizationId(req), actorId(req), req.body);
    res.status(201).json({ team });
  } catch (error) {
    next(error);
  }
};

export const update: RequestHandler = async (req, res, next) => {
  try {
    const team = await updateTeam(
      organizationId(req),
      actorId(req),
      routeParam(req, "teamId"),
      req.body,
    );
    res.json({ team });
  } catch (error) {
    next(error);
  }
};

export const remove: RequestHandler = async (req, res, next) => {
  try {
    await deleteTeam(
      organizationId(req),
      actorId(req),
      routeParam(req, "teamId"),
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
