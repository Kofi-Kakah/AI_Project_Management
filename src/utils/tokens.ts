import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../config/db";

const accessSecret = env.JWT_ACCESS_TOKEN_SECRET;
if (!accessSecret || accessSecret.length < 32) {
  throw new Error("JWT_ACCESS_TOKEN_SECRET must contain at least 32 characters");
}

export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export const accessToken = (user: { id: string; email: string }) =>
  jwt.sign({ email: user.email }, accessSecret, { subject: user.id, expiresIn: "15m", issuer: "ai-project-management", audience: "api" });

export const refreshExpiry = () => {
  const duration = env.JWT_REFRESH_TOKEN_EXPIRATION;
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error("JWT_REFRESH_TOKEN_EXPIRATION must use a duration such as 7d");
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return new Date(Date.now() + Number(match[1]) * units[match[2]]);
};

export async function issueSession(user: { id: string; email: string }, metadata: { userAgent?: string; ipAddress?: string }) {
  const raw = randomToken();
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: refreshExpiry(), userAgent: metadata.userAgent?.slice(0, 1024), ipAddress: metadata.ipAddress } });
  return { accessToken: accessToken(user), refreshToken: raw };
}
