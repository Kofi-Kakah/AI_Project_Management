import { env } from "./env";
import Redis from "ioredis";

export const redis = new Redis(env.REDIS_URL);

redis.on("connect", () => {
  console.info("Connected to Redis");
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
});