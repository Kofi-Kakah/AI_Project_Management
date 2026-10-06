import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { redis } from "../config/redis";
import { AppError } from "../utils/AppError";
import { logger } from "../utils/logger";

const CACHE_TTL_SECONDS = 30;
const CACHE_VERSION_PREFIX = "response-cache:organization:";

function organizationVersionKey(organizationId: string): string {
  return `${CACHE_VERSION_PREFIX}${organizationId}:version`;
}

function organizationResponseKey(
  organizationId: string,
  userId: string,
  version: string,
  url: string,
): string {
  const urlHash = createHash("sha256").update(url).digest("hex");
  return `${CACHE_VERSION_PREFIX}${organizationId}:user:${userId}:v:${version}:${urlHash}`;
}

export const cacheOrganizationResponses: RequestHandler = async (
  req,
  res,
  next,
) => {
  if (req.method !== "GET" || !req.organization || !req.auth) {
    next();
    return;
  }

  const { id: organizationId } = req.organization;
  const { userId } = req.auth;
  const versionKey = organizationVersionKey(organizationId);
  const version = (await redis.get(versionKey)) ?? "0";
  const responseKey = organizationResponseKey(
    organizationId,
    userId,
    version,
    req.originalUrl,
  );
  const cached = await redis.get(responseKey);

  if (cached !== null) {
    const response = JSON.parse(cached) as {
      statusCode: number;
      body: unknown;
    };
    res.status(response.statusCode).json(response.body);
    return;
  }

  let serializedResponse: string | undefined;
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      serializedResponse = JSON.stringify({ statusCode: res.statusCode, body });
    }
    return sendJson(body);
  }) as typeof res.json;

  res.once("finish", () => {
    if (!serializedResponse) return;
    void redis
      .set(responseKey, serializedResponse, "EX", CACHE_TTL_SECONDS)
      .catch((error: unknown) => {
        logger.error(
          { error, organizationId, userId },
          "Failed to write organization response cache",
        );
      });
  });

  next();
};

export const invalidateOrganizationResponses: RequestHandler = (
  req,
  res,
  next,
) => {
  if (req.method === "GET") {
    next();
    return;
  }

  const organizationId = req.organization?.id ?? req.params.organizationId;
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    next(new AppError("Organization ID is required", 400, "VALIDATION_ERROR"));
    return;
  }

  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    void redis
      .incr(organizationVersionKey(organizationId))
      .catch((error: unknown) => {
        logger.error(
          { error, organizationId },
          "Failed to invalidate organization response cache",
        );
      });
  });

  next();
};
