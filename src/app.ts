import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { prisma } from "./config/db";
import { redis } from "./config/redis";
import { errorHandler } from "./middleware/errorHandler";
import { apiRateLimit, authRateLimit } from "./middleware/rateLimit";
import { requestLogger } from "./middleware/requestLogger";
import { authRouter } from "./modules/auth/auth.routes";
import {
  commentsRouter,
  taskCommentsRouter,
} from "./modules/comments/comments.routes";
import { organizationsRouter } from "./modules/organizations/organizations.routes";
import { projectsRouter } from "./modules/projects/projects.routes";
import { tasksRouter, projectTasksRouter } from "./modules/tasks/tasks.routes";
import { teamsRouter } from "./modules/teams/teams.routes";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
  }),
);
app.use(requestLogger);
app.use(apiRateLimit);
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

app.get("/health", async (_req, res) => {
  const [database, cache] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping(),
  ]);
  const healthy =
    database.status === "fulfilled" && cache.status === "fulfilled";
  if (!healthy) {
    if (database.status === "rejected")
      console.error("Database health check failed:", database.reason);
    if (cache.status === "rejected")
      console.error("Redis health check failed:", cache.reason);
  }
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "error",
    db: database.status === "fulfilled" ? "connected" : "unreachable",
    redis: cache.status === "fulfilled" ? "connected" : "unreachable",
  });
});

app.use("/auth", authRateLimit, authRouter);
app.use("/organizations", organizationsRouter);
app.use("/organizations/:organizationId/teams", teamsRouter);
app.use("/organizations/:organizationId/projects", projectsRouter);
app.use(
  "/organizations/:organizationId/projects/:projectId/tasks",
  projectTasksRouter,
);
app.use("/organizations/:organizationId/tasks", tasksRouter);
app.use(
  "/organizations/:organizationId/tasks/:taskId/comments",
  taskCommentsRouter,
);
app.use("/organizations/:organizationId/comments", commentsRouter);
app.use(errorHandler);
