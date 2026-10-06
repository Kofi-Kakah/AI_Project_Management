import { z } from "zod";
import { TaskPriority, TaskStatus } from "../../../generated/prisma/enums";

const taskFields = {
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(20_000).nullable(),
  status: z.enum(TaskStatus),
  priority: z.enum(TaskPriority),
  position: z.number().int().min(0),
  parentId: z.string().min(1).nullable(),
  assigneeId: z.string().min(1).nullable(),
  startsAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .nullable(),
  dueAt: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .nullable(),
};

export const createTaskSchema = z.object({
  title: taskFields.title,
  description: taskFields.description.optional(),
  status: taskFields.status.optional(),
  priority: taskFields.priority.optional(),
  position: taskFields.position.optional(),
  parentId: taskFields.parentId.optional(),
  assigneeId: taskFields.assigneeId.optional(),
  startsAt: taskFields.startsAt.optional(),
  dueAt: taskFields.dueAt.optional(),
});

export const updateTaskSchema = z
  .object(taskFields)
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided",
  );

export const taskIdParamsSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
});

export const projectTaskParamsSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});

export const listTasksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TaskPriority).optional(),
  assigneeId: z.string().min(1).optional(),
  parentId: z.string().min(1).optional(),
});
