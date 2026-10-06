import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireOrganizationRole } from "../../middleware/rbac";
import {
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
} from "../../middleware/responseCache";
import { validate } from "../../middleware/validate";
import { create, get, list, remove, update } from "./tasks.controller";
import {
  createTaskSchema,
  listTasksQuerySchema,
  projectTaskParamsSchema,
  taskIdParamsSchema,
  updateTaskSchema,
} from "./tasks.schema";

export const projectTasksRouter = Router({ mergeParams: true });
projectTasksRouter.use(
  requireAuth,
  validate(projectTaskParamsSchema.omit({ projectId: true }), "params"),
  requireOrganizationRole(),
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
);
projectTasksRouter.get("/", validate(listTasksQuerySchema, "query"), list);
projectTasksRouter.post(
  "/",
  validate(projectTaskParamsSchema, "params"),
  validate(createTaskSchema),
  create,
);

export const tasksRouter = Router({ mergeParams: true });
const organizationAccess = [
  requireAuth,
  validate(taskIdParamsSchema.omit({ taskId: true }), "params"),
  requireOrganizationRole(),
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
];

tasksRouter.get(
  "/:taskId",
  ...organizationAccess,
  validate(taskIdParamsSchema, "params"),
  get,
);
tasksRouter.patch(
  "/:taskId",
  ...organizationAccess,
  validate(taskIdParamsSchema, "params"),
  validate(updateTaskSchema),
  update,
);
tasksRouter.delete(
  "/:taskId",
  ...organizationAccess,
  validate(taskIdParamsSchema, "params"),
  remove,
);
