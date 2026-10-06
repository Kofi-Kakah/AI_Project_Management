import { Queue, type JobsOptions } from "bullmq";
import Redis from "ioredis";
import type { NotificationType } from "../../generated/prisma/enums";
import { env } from "../config/env";

export type EmailJobData =
  | { kind: "verify" | "reset"; email: string; token: string }
  | {
      kind: "invitation";
      email: string;
      inviteeName: string;
      inviterName: string;
      organizationName: string;
      invitationUrl: string;
    };

export type NotificationJobData = {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
};

export const QUEUE_NAMES = {
  email: "email",
  notifications: "notifications",
  deadlines: "deadlines",
} as const;

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800, count: 5_000 },
};

let queueConnection: Redis | undefined;
let queues:
  | {
      email: Queue<EmailJobData>;
      notifications: Queue<NotificationJobData>;
      deadlines: Queue;
    }
  | undefined;

export function getQueues() {
  if (!queues) {
    queueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    queues = {
      email: new Queue<EmailJobData>(QUEUE_NAMES.email, {
        connection: queueConnection,
        defaultJobOptions,
      }),
      notifications: new Queue<NotificationJobData>(QUEUE_NAMES.notifications, {
        connection: queueConnection,
        defaultJobOptions,
      }),
      deadlines: new Queue(QUEUE_NAMES.deadlines, {
        connection: queueConnection,
        defaultJobOptions,
      }),
    };
  }
  return queues;
}

export async function enqueueEmail(data: EmailJobData): Promise<void> {
  const jobName = data.kind === "invitation" ? "invitation" : "auth-link";
  await getQueues().email.add(jobName, data);
}

export async function enqueueNotification(
  data: NotificationJobData,
  options?: JobsOptions,
): Promise<void> {
  await getQueues().notifications.add("persist-notification", data, options);
}

export async function closeQueues(): Promise<void> {
  if (!queues) return;
  const activeQueues = queues;
  queues = undefined;
  await Promise.all([
    activeQueues.email.close(),
    activeQueues.notifications.close(),
    activeQueues.deadlines.close(),
  ]);
  await queueConnection?.quit();
  queueConnection = undefined;
}
