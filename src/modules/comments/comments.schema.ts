import { z } from "zod";

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

export const updateCommentSchema = createCommentSchema;

export const commentIdParamsSchema = z.object({
  organizationId: z.string().min(1),
  commentId: z.string().min(1),
});

export const taskCommentParamsSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
