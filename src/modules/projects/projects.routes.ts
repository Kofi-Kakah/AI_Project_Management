import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireOrganizationRole } from "../../middleware/rbac";
import { requirePlanCapacity } from "../../middleware/planLimits";
import {
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
} from "../../middleware/responseCache";
import { validate } from "../../middleware/validate";
import { UsageMetric } from "../../../generated/prisma/enums";
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
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
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
  requirePlanCapacity(UsageMetric.PROJECT),
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
