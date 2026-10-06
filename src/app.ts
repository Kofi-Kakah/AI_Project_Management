import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { prisma } from "./config/db";
import { redis } from "./config/redis";
import { errorHandler } from "./middleware/errorHandler";
import { authRateLimit } from "./middleware/rateLimit";
import { authRouter } from "./modules/auth/auth.routes";

export const app = express();

app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
  credentials: true,
}));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

app.get("/health", async (_req, res) => {
  const [database, cache] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping(),
  ]);
  const healthy = database.status === "fulfilled" && cache.status === "fulfilled";
  if (!healthy) {
    if (database.status === "rejected") console.error("Database health check failed:", database.reason);
    if (cache.status === "rejected") console.error("Redis health check failed:", cache.reason);
  }
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "error",
    db: database.status === "fulfilled" ? "connected" : "unreachable",
    redis: cache.status === "fulfilled" ? "connected" : "unreachable",
  });
});

app.use("/auth", authRateLimit, authRouter);
app.use(errorHandler);
