import { z } from "zod";

const projectFields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(10_000).nullable(),
  color: z
    .string()
    .regex(/^#[\da-fA-F]{6}$/)
    .nullable(),
  teamId: z.string().min(1).nullable(),
  startsAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .nullable(),
  dueAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .nullable(),
};

export const createProjectSchema = z.object({
  name: projectFields.name,
  description: projectFields.description.optional(),
  color: projectFields.color.optional(),
  teamId: projectFields.teamId.optional(),
  startsAt: projectFields.startsAt.optional(),
  dueAt: projectFields.dueAt.optional(),
});

export const updateProjectSchema = z
  .object(projectFields)
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided",
  );

export const projectIdParamsSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
