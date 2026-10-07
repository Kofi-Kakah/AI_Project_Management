import { z } from "zod";

export const organizationAiParamsSchema = z.object({
  organizationId: z.string().min(1),
});

export const taskAiParamsSchema = organizationAiParamsSchema.extend({
  taskId: z.string().min(1),
});

export const aiRequestParamsSchema = organizationAiParamsSchema.extend({
  requestId: z.string().min(1),
});

export const generateSubtasksSchema = z
  .object({
    count: z.coerce.number().int().min(1).max(10).default(5),
  })
  .default({ count: 5 });
