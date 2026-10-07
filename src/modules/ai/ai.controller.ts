import type { RequestHandler } from "express";
import { AppError } from "../../utils/AppError";
import { routeParam } from "../../utils/routeParams";
import {
  getAiRequest,
  queueSubtaskGeneration,
  queueTaskSummary,
} from "./ai.service";

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

export const createTaskSummary: RequestHandler = async (req, res, next) => {
  try {
    const request = await queueTaskSummary(
      organizationId(req),
      actorId(req),
      routeParam(req, "taskId"),
    );
    res.status(202).json({ request });
  } catch (error) {
    next(error);
  }
};

export const createSubtasks: RequestHandler = async (req, res, next) => {
  try {
    const request = await queueSubtaskGeneration(
      organizationId(req),
      actorId(req),
      routeParam(req, "taskId"),
      req.body.count,
    );
    res.status(202).json({ request });
  } catch (error) {
    next(error);
  }
};

export const getRequest: RequestHandler = async (req, res, next) => {
  try {
    const request = await getAiRequest(
      organizationId(req),
      actorId(req),
      routeParam(req, "requestId"),
    );
    res.json({ request });
  } catch (error) {
    next(error);
  }
};
