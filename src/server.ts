import "dotenv/config";
import { createServer } from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/db";
import { redis } from "./config/redis";
import { closeQueues } from "./jobs/queues";
import { closeRealtime, initializeRealtime } from "./realtime/socket";

const server = createServer(app);
initializeRealtime(server);

server.listen(env.PORT, () => {
  console.info(`Server is running on http://localhost:${env.PORT}`);
});

let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.info(`${signal} received; shutting down gracefully`);

  try {
    await closeRealtime();
  } catch (shutdownError) {
    console.error("Realtime server shutdown failed:", shutdownError);
    process.exitCode = 1;
  }
  try {
    await Promise.all([prisma.$disconnect(), redis.quit(), closeQueues()]);
  } catch (shutdownError) {
    console.error("Failed to close application connections:", shutdownError);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
