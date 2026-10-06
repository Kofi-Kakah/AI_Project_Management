import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireOrganizationRole } from "../../middleware/rbac";
import {
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
} from "../../middleware/responseCache";
import { validate } from "../../middleware/validate";
import { create, get, list, remove, update } from "./teams.controller";
import {
  createTeamSchema,
  paginationQuerySchema,
  teamIdParamsSchema,
  updateTeamSchema,
} from "./teams.schema";

export const teamsRouter = Router({ mergeParams: true });

teamsRouter.use(
  requireAuth,
  validate(teamIdParamsSchema.omit({ teamId: true }), "params"),
  requireOrganizationRole(),
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
);
teamsRouter.get("/", validate(paginationQuerySchema, "query"), list);
teamsRouter.post("/", validate(createTeamSchema), create);
teamsRouter.get("/:teamId", validate(teamIdParamsSchema, "params"), get);
teamsRouter.patch(
  "/:teamId",
  validate(teamIdParamsSchema, "params"),
  validate(updateTeamSchema),
  update,
);
teamsRouter.delete("/:teamId", validate(teamIdParamsSchema, "params"), remove);
