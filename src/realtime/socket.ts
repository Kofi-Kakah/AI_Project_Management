import { createAdapter } from "@socket.io/redis-adapter";
import type { Server as HttpServer } from "node:http";
import jwt, { type JwtPayload } from "jsonwebtoken";
import Redis from "ioredis";
import { Server, type Socket } from "socket.io";
import { MembershipStatus } from "../../generated/prisma/enums";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { REALTIME_CLIENT_EVENTS, REALTIME_SERVER_EVENTS } from "./events";

export type SocketIdentity = { userId: string; email: string };

type RoomAcknowledgement = (result: {
  ok: boolean;
  error?: "INVALID_ARGUMENT" | "FORBIDDEN" | "INTERNAL_ERROR";
}) => void;

function getAccessTokenSecret(): string {
  const secret = env.JWT_ACCESS_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_ACCESS_TOKEN_SECRET must contain at least 32 characters",
    );
  }
  return secret;
}

const accessTokenSecret = getAccessTokenSecret();
export { REALTIME_SERVER_EVENTS };

let io: Server | undefined;
let publisher: Redis | undefined;
let subscriber: Redis | undefined;

export function organizationRoom(organizationId: string): string {
  return `organization:${organizationId}`;
}

export function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}

export async function authenticateSocketToken(
  token: string,
): Promise<SocketIdentity> {
  const verifiedToken = jwt.verify(token, accessTokenSecret, {
    issuer: "ai-project-management",
    audience: "api",
  });
  if (typeof verifiedToken !== "object" || verifiedToken === null) {
    throw new Error("Invalid access token claims");
  }
  const payload: JwtPayload = verifiedToken;

  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new Error("Invalid access token claims");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { disabledAt: true },
  });
  if (!user || user.disabledAt) {
    throw new Error("User is unavailable");
  }

  return { userId: payload.sub, email: payload.email };
}

function readSocketToken(socket: Socket): string | undefined {
  const authToken: unknown = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.length > 0) return authToken;

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1];
}

function acknowledge(
  callback: RoomAcknowledgement | undefined,
  result: Parameters<RoomAcknowledgement>[0],
): void {
  if (typeof callback === "function") callback(result);
}

function validRoomId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

async function joinOrganization(
  socket: Socket,
  organizationId: unknown,
  callback?: RoomAcknowledgement,
): Promise<void> {
  if (!validRoomId(organizationId)) {
    acknowledge(callback, { ok: false, error: "INVALID_ARGUMENT" });
    return;
  }

  try {
    const membership = await prisma.membership.findFirst({
      where: {
        organizationId,
        userId: socket.data.identity.userId,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!membership) {
      acknowledge(callback, { ok: false, error: "FORBIDDEN" });
      return;
    }

    await socket.join(organizationRoom(organizationId));
    acknowledge(callback, { ok: true });
  } catch (error) {
    logger.error({ error, organizationId }, "Organization room join failed");
    acknowledge(callback, { ok: false, error: "INTERNAL_ERROR" });
  }
}

async function joinProject(
  socket: Socket,
  projectId: unknown,
  callback?: RoomAcknowledgement,
): Promise<void> {
  if (!validRoomId(projectId)) {
    acknowledge(callback, { ok: false, error: "INVALID_ARGUMENT" });
    return;
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project) {
      acknowledge(callback, { ok: false, error: "FORBIDDEN" });
      return;
    }

    const membership = await prisma.membership.findFirst({
      where: {
        organizationId: project.organizationId,
        userId: socket.data.identity.userId,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!membership) {
      acknowledge(callback, { ok: false, error: "FORBIDDEN" });
      return;
    }

    await socket.join(projectRoom(projectId));
    acknowledge(callback, { ok: true });
  } catch (error) {
    logger.error({ error, projectId }, "Project room join failed");
    acknowledge(callback, { ok: false, error: "INTERNAL_ERROR" });
  }
}

export function registerRoomHandlers(socket: Socket): void {
  socket.on(REALTIME_CLIENT_EVENTS.joinOrganization, (id, callback) =>
    joinOrganization(socket, id, callback),
  );
  socket.on(REALTIME_CLIENT_EVENTS.leaveOrganization, async (id, callback) => {
    if (!validRoomId(id)) {
      acknowledge(callback, { ok: false, error: "INVALID_ARGUMENT" });
      return;
    }
    try {
      await socket.leave(organizationRoom(id));
      acknowledge(callback, { ok: true });
    } catch (error) {
      logger.error(
        { error, organizationId: id },
        "Organization room leave failed",
      );
      acknowledge(callback, { ok: false, error: "INTERNAL_ERROR" });
    }
  });
  socket.on(REALTIME_CLIENT_EVENTS.joinProject, (id, callback) =>
    joinProject(socket, id, callback),
  );
  socket.on(REALTIME_CLIENT_EVENTS.leaveProject, async (id, callback) => {
    if (!validRoomId(id)) {
      acknowledge(callback, { ok: false, error: "INVALID_ARGUMENT" });
      return;
    }
    try {
      await socket.leave(projectRoom(id));
      acknowledge(callback, { ok: true });
    } catch (error) {
      logger.error({ error, projectId: id }, "Project room leave failed");
      acknowledge(callback, { ok: false, error: "INTERNAL_ERROR" });
    }
  });
}

export function initializeRealtime(httpServer: HttpServer): void {
  if (io) throw new Error("Realtime server is already initialized");

  publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  subscriber = publisher.duplicate();
  for (const [name, client] of [
    ["publisher", publisher],
    ["subscriber", subscriber],
  ] as const) {
    client.on("error", (error) =>
      logger.error({ error, client: name }, "Realtime Redis connection error"),
    );
  }

  io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
      credentials: true,
    },
  });
  io.adapter(createAdapter(publisher, subscriber));
  io.use((socket, next) => {
    const token = readSocketToken(socket);
    if (!token) {
      next(new Error("Authentication required"));
      return;
    }
    void authenticateSocketToken(token)
      .then((identity) => {
        socket.data.identity = identity;
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof jwt.JsonWebTokenError) {
          next(new Error("Invalid or expired access token"));
          return;
        }
        logger.error({ error }, "Socket authentication failed");
        next(new Error("Socket authentication failed"));
      });
  });
  io.on("connection", (socket) => registerRoomHandlers(socket));
}

export function emitOrganizationEvent(
  organizationId: string,
  event: string,
  data: unknown,
): void {
  io?.to(organizationRoom(organizationId)).emit(event, {
    organizationId,
    occurredAt: new Date().toISOString(),
    data,
  });
}

export function emitProjectEvent(
  organizationId: string,
  projectId: string,
  event: string,
  data: unknown,
): void {
  io?.to(organizationRoom(organizationId))
    .to(projectRoom(projectId))
    .emit(event, {
      organizationId,
      projectId,
      occurredAt: new Date().toISOString(),
      data,
    });
}

export async function closeRealtime(): Promise<void> {
  const activeServer = io;
  const activePublisher = publisher;
  const activeSubscriber = subscriber;
  io = undefined;
  publisher = undefined;
  subscriber = undefined;

  const failures: unknown[] = [];
  try {
    await activeServer?.close();
  } catch (error) {
    failures.push(error);
  }

  const redisResults = await Promise.allSettled([
    activePublisher?.quit(),
    activeSubscriber?.quit(),
  ]);
  failures.push(
    ...redisResults
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason),
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Realtime shutdown failed");
  }
}
