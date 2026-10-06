import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError } from "../utils/AppError";

export type RequestPart = "body" | "query" | "params";

export function validate<T>(schema: ZodType<T>, part: RequestPart = "body"): RequestHandler {
  return (req, _res, next) => {
    const input =
      part === "body" ? req.body : part === "query" ? req.query : req.params;
    const result = schema.safeParse(input);

    if (!result.success) {
      next(
        new AppError("Request validation failed", 400, "VALIDATION_ERROR"),
      );
      return;
    }

    if (part === "body") req.body = result.data;
    next();
  };
}
