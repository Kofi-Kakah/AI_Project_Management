import { z } from "zod";

const teamFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(10_000).nullable(),
};

export const createTeamSchema = z.object({
  name: teamFields.name,
  description: teamFields.description.optional(),
});

export const updateTeamSchema = z
  .object(teamFields)
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided",
  );

export const teamIdParamsSchema = z.object({
  organizationId: z.string().min(1),
  teamId: z.string().min(1),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
