import { z } from "zod";
import { OrganizationRole } from "../../../generated/prisma/enums";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(160),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum([OrganizationRole.ADMIN, OrganizationRole.MEMBER]).default(OrganizationRole.MEMBER),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum([OrganizationRole.ADMIN, OrganizationRole.MEMBER]),
});

export const organizationIdParamsSchema = z.object({
  organizationId: z.string().min(1),
});

export const memberParamsSchema = organizationIdParamsSchema.extend({
  membershipId: z.string().min(1),
});
