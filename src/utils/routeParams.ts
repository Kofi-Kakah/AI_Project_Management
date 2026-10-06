import type { Request } from "express";
import { AppError } from "./AppError";

export function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError(
      "A valid route parameter is required",
      400,
      "VALIDATION_ERROR",
    );
  }
  return value;
}
