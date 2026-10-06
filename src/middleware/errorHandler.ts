import type { ErrorRequestHandler } from "express";
import { AppError } from "../utils/AppError";
import { logger } from "../utils/logger";

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error, method: req.method, url: req.originalUrl }, error.message);
    }
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }

  logger.error({ err: error, method: req.method, url: req.originalUrl }, "Unhandled request error");
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
};
