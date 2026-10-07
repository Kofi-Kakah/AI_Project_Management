import type { RequestHandler } from "express";
import { getPlatformStats } from "./admin.service";

export const getStats: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ stats: await getPlatformStats() });
  } catch (error) {
    next(error);
  }
};
