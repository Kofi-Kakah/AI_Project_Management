import type { RequestHandler } from "express";
import { AppError } from "../../utils/AppError";
import { paginationMetadata, parsePagination } from "../../utils/pagination";
import { routeParam } from "../../utils/routeParams";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "./projects.service";

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
    const result = await listProjects(organizationId(req), page);
    res.json({
      projects: result.projects,
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
      project: await getProject(
        organizationId(req),
        routeParam(req, "projectId"),
      ),
    });
  } catch (error) {
    next(error);
  }
};

export const create: RequestHandler = async (req, res, next) => {
  try {
    const project = await createProject(
      organizationId(req),
      actorId(req),
      req.body,
    );
    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
};

export const update: RequestHandler = async (req, res, next) => {
  try {
    const project = await updateProject(
      organizationId(req),
      actorId(req),
      routeParam(req, "projectId"),
      req.body,
    );
    res.json({ project });
  } catch (error) {
    next(error);
  }
};

export const remove: RequestHandler = async (req, res, next) => {
  try {
    await deleteProject(
      organizationId(req),
      actorId(req),
      routeParam(req, "projectId"),
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
