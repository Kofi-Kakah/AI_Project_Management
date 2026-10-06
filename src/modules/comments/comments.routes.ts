import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireOrganizationRole } from "../../middleware/rbac";
import {
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
} from "../../middleware/responseCache";
import { validate } from "../../middleware/validate";
import { create, list, remove, update } from "./comments.controller";
import {
  commentIdParamsSchema,
  createCommentSchema,
  paginationQuerySchema,
  taskCommentParamsSchema,
  updateCommentSchema,
} from "./comments.schema";

export const taskCommentsRouter = Router({ mergeParams: true });
taskCommentsRouter.use(
  requireAuth,
  validate(taskCommentParamsSchema, "params"),
  requireOrganizationRole(),
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
);
taskCommentsRouter.get("/", validate(paginationQuerySchema, "query"), list);
taskCommentsRouter.post("/", validate(createCommentSchema), create);

export const commentsRouter = Router({ mergeParams: true });
commentsRouter.use(
  requireAuth,
  validate(commentIdParamsSchema.omit({ commentId: true }), "params"),
  requireOrganizationRole(),
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
);
commentsRouter.patch(
  "/:commentId",
  validate(commentIdParamsSchema, "params"),
  validate(updateCommentSchema),
  update,
);
commentsRouter.delete(
  "/:commentId",
  validate(commentIdParamsSchema, "params"),
  remove,
);
