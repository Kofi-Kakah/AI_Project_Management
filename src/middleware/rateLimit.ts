import rateLimit from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { redis } from "../config/redis";

async function sendRedisCommand(...args: string[]): Promise<RedisReply> {
  const [command, ...commandArgs] = args;
  if (!command) throw new Error("Rate-limit Redis command was empty");

  const reply: unknown = await redis.call(command, ...commandArgs);
  const isRedisValue = (
    value: unknown,
  ): value is boolean | number | string | null =>
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string";
  if (reply === null) return false;
  if (
    typeof reply === "boolean" ||
    typeof reply === "number" ||
    typeof reply === "string"
  ) {
    return reply;
  }
  if (Array.isArray(reply) && reply.every(isRedisValue)) {
    return reply.map((value) => value ?? false);
  }
  throw new Error("Rate-limit Redis returned an unsupported response");
}

const redisStore = (prefix: string) =>
  new RedisStore({
    prefix,
    sendCommand: sendRedisCommand,
  });

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health",
  store: redisStore("rate-limit:api:"),
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("rate-limit:auth:"),
});
