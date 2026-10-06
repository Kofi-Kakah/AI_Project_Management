import argon2 from "argon2";
import type { RequestHandler } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../config/db";
import { enqueueEmail } from "../../jobs/queues";
import {
  accessToken,
  hashToken,
  issueSession,
  randomToken,
  refreshExpiry,
} from "../../utils/tokens";
import {
  credentialsSchema,
  emailSchema,
  registerSchema,
  resetPasswordSchema,
  verificationTokenQuerySchema,
} from "./auth.schema";

const refreshCookieName = "refreshToken";
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/auth",
};

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T | undefined {
  const result = schema.safeParse(body);
  return result.success ? result.data : undefined;
}

function setRefreshCookie(res: Parameters<RequestHandler>[1], token: string) {
  const expiry = refreshExpiry();
  res.cookie(refreshCookieName, token, {
    ...refreshCookieOptions,
    maxAge: Math.max(expiry.getTime() - Date.now(), 0),
  });
}

function clearRefreshCookie(res: Parameters<RequestHandler>[1]) {
  res.clearCookie(refreshCookieName, refreshCookieOptions);
}

function requestMetadata(req: Parameters<RequestHandler>[0]) {
  return { userAgent: req.get("user-agent"), ipAddress: req.ip };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

function isGoogleAuthUser(value: unknown): value is {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  disabledAt?: Date | null;
} {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "email" in value &&
    typeof value.email === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "avatarUrl" in value &&
    (typeof value.avatarUrl === "string" || value.avatarUrl === null) &&
    "emailVerifiedAt" in value &&
    (value.emailVerifiedAt instanceof Date || value.emailVerifiedAt === null) &&
    "createdAt" in value &&
    value.createdAt instanceof Date &&
    (!("disabledAt" in value) ||
      value.disabledAt === null ||
      value.disabledAt instanceof Date)
  );
}

export const register: RequestHandler = async (req, res, next) => {
  const input = parseBody(registerSchema, req.body);
  if (!input) {
    res
      .status(400)
      .json({ error: "A valid name, email, and password are required" });
    return;
  }

  try {
    const verificationToken = randomToken();
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: await argon2.hash(input.password),
        emailVerificationHash: hashToken(verificationToken),
        emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    await enqueueEmail({
      kind: "verify",
      email: input.email.toLowerCase(),
      token: verificationToken,
    });
    res.status(201).json({
      message: "Account created. Check your email to verify your address.",
      userId: user.id,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res
        .status(409)
        .json({ error: "An account with this email already exists" });
      return;
    }
    next(error);
  }
};

export const login: RequestHandler = async (req, res, next) => {
  const input = parseBody(credentialsSchema, req.body);
  if (!input) {
    res.status(400).json({ error: "A valid email and password are required" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    const passwordMatches =
      user?.passwordHash !== null &&
      user?.passwordHash !== undefined &&
      (await argon2.verify(user.passwordHash, input.password));
    if (!user || !passwordMatches || user.disabledAt) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    if (!user.emailVerifiedAt) {
      res
        .status(403)
        .json({ error: "Verify your email address before signing in" });
      return;
    }

    const session = await issueSession(user, requestMetadata(req));
    setRefreshCookie(res, session.refreshToken);
    res.json({ accessToken: session.accessToken, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
};

export const refresh: RequestHandler = async (req, res, next) => {
  const rawToken = req.cookies?.[refreshCookieName];
  if (!rawToken) {
    res.status(401).json({ error: "Refresh token required" });
    return;
  }

  try {
    const oldTokenHash = hashToken(rawToken);
    const rotated = await prisma.$transaction(async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { tokenHash: oldTokenHash },
        include: { user: true },
      });
      if (
        !current ||
        current.revokedAt ||
        current.expiresAt <= new Date() ||
        current.user.disabledAt
      ) {
        return undefined;
      }

      const now = new Date();
      const revoked = await tx.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) return undefined;

      const nextRawToken = randomToken();
      const nextToken = await tx.refreshToken.create({
        data: {
          userId: current.userId,
          tokenHash: hashToken(nextRawToken),
          expiresAt: refreshExpiry(),
          userAgent: req.get("user-agent")?.slice(0, 1024),
          ipAddress: req.ip,
        },
      });
      await tx.refreshToken.update({
        where: { id: current.id },
        data: { replacedByTokenId: nextToken.id },
      });
      return { user: current.user, refreshToken: nextRawToken };
    });

    if (!rotated) {
      clearRefreshCookie(res);
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }

    setRefreshCookie(res, rotated.refreshToken);
    res.json({
      accessToken: accessToken(rotated.user),
      user: publicUser(rotated.user),
    });
  } catch (error) {
    next(error);
  }
};

export const logout: RequestHandler = async (req, res, next) => {
  const rawToken = req.cookies?.[refreshCookieName];
  try {
    if (rawToken) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearRefreshCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const getCurrentUser: RequestHandler = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth?.userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

export const verifyEmail: RequestHandler = async (req, res, next) => {
  const input = verificationTokenQuerySchema.safeParse(req.query);
  if (!input.success) {
    res.status(400).json({ error: "A valid verification token is required" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { emailVerificationHash: hashToken(input.data.token) },
      select: { id: true, emailVerificationExpiresAt: true },
    });
    if (
      !user ||
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt <= new Date()
    ) {
      res
        .status(400)
        .json({ error: "Verification link is invalid or expired" });
      return;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationHash: null,
        emailVerificationExpiresAt: null,
      },
    });
    res.json({ message: "Email address verified" });
  } catch (error) {
    next(error);
  }
};

export const resendVerification: RequestHandler = async (req, res, next) => {
  const input = emailSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: input.data.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        disabledAt: true,
      },
    });
    if (user && !user.emailVerifiedAt && !user.disabledAt) {
      const token = randomToken();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerificationHash: hashToken(token),
          emailVerificationExpiresAt: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ),
        },
      });
      await enqueueEmail({ kind: "verify", email: user.email, token });
    }
    res.json({
      message: "If the account needs verification, a link will be sent",
    });
  } catch (error) {
    next(error);
  }
};

export const requestPasswordReset: RequestHandler = async (req, res, next) => {
  const input = emailSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: input.data.email.toLowerCase() },
      select: { id: true, email: true, disabledAt: true },
    });
    if (user && !user.disabledAt) {
      const token = randomToken();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetHash: hashToken(token),
          passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await enqueueEmail({ kind: "reset", email: user.email, token });
    }
    res.json({
      message: "If the account exists, a password reset link will be sent",
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword: RequestHandler = async (req, res, next) => {
  const input = parseBody(resetPasswordSchema, req.body);
  if (!input) {
    res
      .status(400)
      .json({ error: "A valid reset token and new password are required" });
    return;
  }

  try {
    const passwordHash = await argon2.hash(input.newPassword);
    const reset = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { passwordResetHash: hashToken(input.token) },
        select: { id: true, passwordResetExpiresAt: true },
      });
      if (
        !user ||
        !user.passwordResetExpiresAt ||
        user.passwordResetExpiresAt <= new Date()
      ) {
        return false;
      }
      const changed = await tx.user.updateMany({
        where: {
          id: user.id,
          passwordResetHash: hashToken(input.token),
          passwordResetExpiresAt: { gt: new Date() },
        },
        data: {
          passwordHash,
          passwordResetHash: null,
          passwordResetExpiresAt: null,
        },
      });
      if (changed.count !== 1) return false;
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return true;
    });
    if (!reset) {
      res
        .status(400)
        .json({ error: "Password reset link is invalid or expired" });
      return;
    }
    res.json({ message: "Password has been reset" });
  } catch (error) {
    next(error);
  }
};

export const googleAuthUnavailable: RequestHandler = (_req, res, next) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    res.status(503).json({ error: "Google sign-in is not configured" });
    return;
  }
  next();
};

export const googleCallback: RequestHandler = async (req, res, next) => {
  const user = req.user;
  if (!isGoogleAuthUser(user) || user.disabledAt) {
    res.status(401).json({ error: "Google sign-in failed" });
    return;
  }

  try {
    const session = await issueSession(
      { id: user.id, email: user.email },
      requestMetadata(req),
    );
    setRefreshCookie(res, session.refreshToken);
    res.json({ accessToken: session.accessToken, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
};
