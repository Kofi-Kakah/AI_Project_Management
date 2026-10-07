import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireOrganizationRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { createSubtasks, createTaskSummary, getRequest } from "./ai.controller";
import {
  aiRequestParamsSchema,
  generateSubtasksSchema,
  organizationAiParamsSchema,
  taskAiParamsSchema,
} from "./ai.schema";

export const aiRouter = Router({ mergeParams: true });
aiRouter.use(
  requireAuth,
  validate(organizationAiParamsSchema, "params"),
  requireOrganizationRole(),
);
aiRouter.post(
  "/tasks/:taskId/summary",
  validate(taskAiParamsSchema, "params"),
  createTaskSummary,
);
aiRouter.post(
  "/tasks/:taskId/subtasks",
  validate(taskAiParamsSchema, "params"),
  validate(generateSubtasksSchema),
  createSubtasks,
);
aiRouter.get(
  "/requests/:requestId",
  validate(aiRequestParamsSchema, "params"),
  getRequest,
);
