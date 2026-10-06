import { Router } from "express";
import { OrganizationRole } from "../../../generated/prisma/enums";
import { requireAuth } from "../../middleware/auth";
import { requireOrganizationRole } from "../../middleware/rbac";
import {
  cacheOrganizationResponses,
  invalidateOrganizationResponses,
} from "../../middleware/responseCache";
import { validate } from "../../middleware/validate";
import {
  createOrganizationSchema,
  inviteMemberSchema,
  memberParamsSchema,
  organizationIdParamsSchema,
  updateMemberRoleSchema,
} from "./organizations.schema";
import {
  accept,
  create,
  get,
  invite,
  list,
  listInvitations,
  listMembers,
  updateRole,
} from "./organizations.controller";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

organizationsRouter.post("/", validate(createOrganizationSchema), create);
organizationsRouter.get("/", list);
organizationsRouter.get("/invitations", listInvitations);

organizationsRouter.post(
  "/:organizationId/invitations/:membershipId/accept",
  validate(memberParamsSchema, "params"),
  invalidateOrganizationResponses,
  accept,
);
organizationsRouter.get(
  "/:organizationId",
  validate(organizationIdParamsSchema, "params"),
  requireOrganizationRole(),
  cacheOrganizationResponses,
  get,
);
organizationsRouter.get(
  "/:organizationId/members",
  validate(organizationIdParamsSchema, "params"),
  requireOrganizationRole(),
  cacheOrganizationResponses,
  listMembers,
);
organizationsRouter.post(
  "/:organizationId/invitations",
  validate(organizationIdParamsSchema, "params"),
  validate(inviteMemberSchema),
  requireOrganizationRole([OrganizationRole.OWNER, OrganizationRole.ADMIN]),
  invalidateOrganizationResponses,
  invite,
);
organizationsRouter.patch(
  "/:organizationId/members/:membershipId/role",
  validate(memberParamsSchema, "params"),
  validate(updateMemberRoleSchema),
  requireOrganizationRole([OrganizationRole.OWNER, OrganizationRole.ADMIN]),
  invalidateOrganizationResponses,
  updateRole,
);
