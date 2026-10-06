import "dotenv/config";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { closeQueues, QUEUE_NAMES } from "./queues";
import {
  processEmail,
  processNotification,
  queueUpcomingDeadlineNotifications,
  scheduleDeadlineScan,
} from "./workers/processors";

const workerConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const emailWorker = new Worker(
  QUEUE_NAMES.email,
  (job) => processEmail(job.data),
  { connection: workerConnection.duplicate() },
);
const notificationWorker = new Worker(
  QUEUE_NAMES.notifications,
  (job) => processNotification(job.data),
  { connection: workerConnection.duplicate() },
);
const deadlineWorker = new Worker(
  QUEUE_NAMES.deadlines,
  async () => {
    const queuedCount = await queueUpcomingDeadlineNotifications();
    logger.info({ queuedCount }, "Upcoming deadline scan completed");
  },
  { connection: workerConnection.duplicate() },
);

for (const worker of [emailWorker, notificationWorker, deadlineWorker]) {
  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, queue: worker.name, error },
      "Background job failed",
    );
  });
  worker.on("error", (error) => {
    logger.error({ queue: worker.name, error }, "Background worker error");
  });
}

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Worker shutdown started");
  try {
    await Promise.all([
      emailWorker.close(),
      notificationWorker.close(),
      deadlineWorker.close(),
    ]);
    await Promise.all([
      closeQueues(),
      workerConnection.quit(),
      prisma.$disconnect(),
    ]);
    process.exitCode = exitCode;
  } catch (error) {
    logger.error({ error }, "Worker shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void scheduleDeadlineScan().catch((error: unknown) => {
  logger.error({ error }, "Failed to schedule deadline scans");
  void shutdown("deadline-scheduler-startup-failure", 1);
});
