import type { RequestHandler } from "express";
import type { OrganizationRole } from "../../../generated/prisma/enums";
import { AppError } from "../../utils/AppError";
import { paginationMetadata, parsePagination } from "../../utils/pagination";
import { routeParam } from "../../utils/routeParams";
import {
  createComment,
  deleteComment,
  listTaskComments,
  updateComment,
} from "./comments.service";

function actor(req: Parameters<RequestHandler>[0]): {
  userId: string;
  role: OrganizationRole;
} {
  const userId = req.auth?.userId;
  const role = req.organization?.role;
  if (!userId || !role) {
    throw new AppError(
      "Organization access was not authorized",
      403,
      "FORBIDDEN",
    );
  }
  return { userId, role };
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
    const result = await listTaskComments(
      organizationId(req),
      routeParam(req, "taskId"),
      page,
    );
    res.json({
      comments: result.comments,
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

export const create: RequestHandler = async (req, res, next) => {
  try {
    const comment = await createComment(
      organizationId(req),
      routeParam(req, "taskId"),
      actor(req).userId,
      req.body.body,
    );
    res.status(201).json({ comment });
  } catch (error) {
    next(error);
  }
};

export const update: RequestHandler = async (req, res, next) => {
  try {
    const comment = await updateComment(
      organizationId(req),
      routeParam(req, "commentId"),
      actor(req),
      req.body.body,
    );
    res.json({ comment });
  } catch (error) {
    next(error);
  }
};

export const remove: RequestHandler = async (req, res, next) => {
  try {
    await deleteComment(
      organizationId(req),
      routeParam(req, "commentId"),
      actor(req),
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
