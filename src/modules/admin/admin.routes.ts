import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requirePlatformAdmin } from "../../middleware/platformAdmin";
import { getStats } from "./admin.controller";

export const adminRouter = Router();
adminRouter.use(requireAuth, requirePlatformAdmin);
adminRouter.get("/stats", getStats);
