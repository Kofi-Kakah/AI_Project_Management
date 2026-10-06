import { z } from "zod";
import { AppError } from "./AppError";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export function parsePagination(input: unknown): Pagination {
  const parsed = paginationSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "Invalid pagination parameters",
      400,
      "VALIDATION_ERROR",
    );
  }
  return {
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    skip: (parsed.data.page - 1) * parsed.data.pageSize,
    take: parsed.data.pageSize,
  };
}

export function paginationMetadata(
  page: number,
  pageSize: number,
  totalItems: number,
) {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
  };
}
