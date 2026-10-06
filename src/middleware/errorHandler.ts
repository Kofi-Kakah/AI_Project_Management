import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("Unhandled request error:", error);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
};
