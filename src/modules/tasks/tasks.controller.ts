import type { RequestHandler } from "express";
import { AppError } from "../../utils/AppError";
import { paginationMetadata, parsePagination } from "../../utils/pagination";
import { routeParam } from "../../utils/routeParams";
import { listTasksQuerySchema } from "./tasks.schema";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from "./tasks.service";

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
    const parsed = listTasksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError("Invalid task filters", 400, "VALIDATION_ERROR");
    }
    const page = parsePagination(req.query);
    const { status, priority, assigneeId, parentId } = parsed.data;
    const result = await listTasks(
      organizationId(req),
      routeParam(req, "projectId"),
      page,
      { status, priority, assigneeId, parentId },
    );
    res.json({
      tasks: result.tasks,
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
      task: await getTask(organizationId(req), routeParam(req, "taskId")),
    });
  } catch (error) {
    next(error);
  }
};

export const create: RequestHandler = async (req, res, next) => {
  try {
    const task = await createTask(
      organizationId(req),
      actorId(req),
      routeParam(req, "projectId"),
      req.body,
    );
    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
};

export const update: RequestHandler = async (req, res, next) => {
  try {
    const task = await updateTask(
      organizationId(req),
      actorId(req),
      routeParam(req, "taskId"),
      req.body,
    );
    res.json({ task });
  } catch (error) {
    next(error);
  }
};

export const remove: RequestHandler = async (req, res, next) => {
  try {
    await deleteTask(
      organizationId(req),
      actorId(req),
      routeParam(req, "taskId"),
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
