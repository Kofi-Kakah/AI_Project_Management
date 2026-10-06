import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireOrganizationRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { create, get, list, remove, update } from "./projects.controller";
import {
  createProjectSchema,
  paginationQuerySchema,
  projectIdParamsSchema,
  updateProjectSchema,
} from "./projects.schema";

export const projectsRouter = Router({ mergeParams: true });

const organizationAccess = [
  requireAuth,
  validate(projectIdParamsSchema.omit({ projectId: true }), "params"),
  requireOrganizationRole(),
];

projectsRouter.get(
  "/",
  ...organizationAccess,
  validate(paginationQuerySchema, "query"),
  list,
);
projectsRouter.post(
  "/",
  ...organizationAccess,
  validate(createProjectSchema),
  create,
);
projectsRouter.get(
  "/:projectId",
  ...organizationAccess,
  validate(projectIdParamsSchema, "params"),
  get,
);
projectsRouter.patch(
  "/:projectId",
  ...organizationAccess,
  validate(projectIdParamsSchema, "params"),
  validate(updateProjectSchema),
  update,
);
projectsRouter.delete(
  "/:projectId",
  ...organizationAccess,
  validate(projectIdParamsSchema, "params"),
  remove,
);
