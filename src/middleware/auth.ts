import type { RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";

const secret = env.JWT_ACCESS_TOKEN_SECRET;
if (!secret || secret.length < 32) throw new Error("JWT_ACCESS_TOKEN_SECRET must contain at least 32 characters");

declare global {
  namespace Express { interface Request { auth?: { userId: string; email: string } } }
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const payload = jwt.verify(header.slice(7), secret, { issuer: "ai-project-management", audience: "api" }) as JwtPayload;
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") throw new Error("Invalid token claims");
    req.auth = { userId: payload.sub, email: payload.email };
    next();
  } catch { res.status(401).json({ error: "Invalid or expired access token" }); }
};
