import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userCreate: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  userUpdateMany: vi.fn(),
  refreshCreate: vi.fn(),
  refreshFindUnique: vi.fn(),
  refreshUpdate: vi.fn(),
  refreshUpdateMany: vi.fn(),
  transaction: vi.fn(),
  sendAuthLink: vi.fn(),
  argonHash: vi.fn(),
  argonVerify: vi.fn(),
}));

vi.mock("../../src/config/db", () => ({
  prisma: {
    user: {
      create: mocks.userCreate,
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
      updateMany: mocks.userUpdateMany,
    },
    refreshToken: {
      create: mocks.refreshCreate,
      findUnique: mocks.refreshFindUnique,
      update: mocks.refreshUpdate,
      updateMany: mocks.refreshUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../../src/utils/mailer", () => ({ sendAuthLink: mocks.sendAuthLink }));
vi.mock("argon2", () => ({
  default: { hash: mocks.argonHash, verify: mocks.argonVerify },
}));

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("JWT_ACCESS_TOKEN_SECRET", "test-secret-that-is-long-enough-for-jwt");
vi.stubEnv("JWT_ACCESS_TOKEN_EXPIRATION", "15m");
vi.stubEnv("JWT_REFRESH_TOKEN_EXPIRATION", "7d");
vi.stubEnv("GOOGLE_CLIENT_ID", "");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "");

const { authRouter } = await import("../../src/modules/auth/auth.routes");
const { errorHandler } = await import("../../src/middleware/errorHandler");
const { hashToken } = await import("../../src/utils/tokens");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/auth", authRouter);
app.use(errorHandler);

const verifiedUser = {
  id: "user_1",
  email: "user@example.com",
  name: "Test User",
  avatarUrl: null,
  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  emailVerificationHash: null,
  emailVerificationExpiresAt: null,
  passwordResetHash: null,
  passwordResetExpiresAt: null,
  passwordHash: "argon2:correct-password",
  googleId: null,
  isPlatformAdmin: false,
  disabledAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.argonHash.mockImplementation(async (password: string) => `argon2:${password}`);
  mocks.argonVerify.mockImplementation(
    async (encoded: string, password: string) => encoded === `argon2:${password}`,
  );
  mocks.userCreate.mockResolvedValue({ id: "user_1" });
  mocks.userFindUnique.mockResolvedValue(verifiedUser);
  mocks.userUpdate.mockResolvedValue(verifiedUser);
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.refreshCreate.mockResolvedValue({ id: "refresh_1" });
  mocks.refreshFindUnique.mockResolvedValue(null);
  mocks.refreshUpdate.mockResolvedValue({});
  mocks.refreshUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(
    (callback: (tx: unknown) => unknown) =>
      callback({
        user: {
          findUnique: mocks.userFindUnique,
          updateMany: mocks.userUpdateMany,
        },
        refreshToken: {
          findUnique: mocks.refreshFindUnique,
          create: mocks.refreshCreate,
          update: mocks.refreshUpdate,
          updateMany: mocks.refreshUpdateMany,
        },
      }),
  );
});

describe("authentication flows", () => {
  it("registers an account with a password hash and a hashed verification token", async () => {
    const response = await request(app).post("/auth/register").send({
      name: " Test User ",
      email: "USER@example.com",
      password: "correct-password",
    });

    expect(response.status).toBe(201);
    expect(mocks.userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "user@example.com",
        name: "Test User",
        passwordHash: "argon2:correct-password",
        emailVerificationHash: expect.any(String),
        emailVerificationExpiresAt: expect.any(Date),
      }),
      select: { id: true },
    });
    const storedToken = mocks.userCreate.mock.calls[0][0].data.emailVerificationHash;
    expect(storedToken).not.toBe(mocks.sendAuthLink.mock.calls[0]?.[2]);
    expect(mocks.sendAuthLink).toHaveBeenCalledWith("verify", "user@example.com", expect.any(String));
  });

  it("does not sign in an account before email verification", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ ...verifiedUser, emailVerifiedAt: null });

    const response = await request(app)
      .post("/auth/login")
      .send({ email: "user@example.com", password: "correct-password" });

    expect(response.status).toBe(403);
    expect(mocks.refreshCreate).not.toHaveBeenCalled();
  });

  it("rejects a wrong password without creating a session", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "user@example.com", password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(mocks.refreshCreate).not.toHaveBeenCalled();
  });

  it("signs in verified users and persists only a hash of the refresh token", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "USER@example.com", password: "correct-password" });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("user@example.com");
    expect(response.body.accessToken).toEqual(expect.any(String));
    const accessClaims = jwt.decode(response.body.accessToken) as jwt.JwtPayload;
    expect(accessClaims.exp! - accessClaims.iat!).toBe(15 * 60);
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    const rawRefreshToken = decodeURIComponent(
      response.headers["set-cookie"][0].match(/refreshToken=([^;]+)/)?.[1] ?? "",
    );
    expect(rawRefreshToken).toBeTruthy();
    expect(mocks.refreshCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        tokenHash: hashToken(rawRefreshToken),
        expiresAt: expect.any(Date),
      }),
    });
  });

  it("rotates refresh tokens once and links the old token to its replacement", async () => {
    const existing = {
      id: "refresh_old",
      userId: "user_1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: verifiedUser,
    };
    mocks.refreshFindUnique.mockResolvedValueOnce(existing);

    const response = await request(app)
      .post("/auth/refresh")
      .set("Cookie", "refreshToken=old-refresh-token");

    expect(response.status).toBe(200);
    expect(mocks.refreshUpdateMany).toHaveBeenCalledWith({
      where: { id: "refresh_old", revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.refreshUpdate).toHaveBeenCalledWith({
      where: { id: "refresh_old" },
      data: { replacedByTokenId: "refresh_1" },
    });
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
  });

  it("rejects refresh-token replay when the token was already revoked", async () => {
    mocks.refreshFindUnique.mockResolvedValueOnce({
      id: "refresh_old",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: verifiedUser,
    });

    const response = await request(app)
      .post("/auth/refresh")
      .set("Cookie", "refreshToken=old-refresh-token");

    expect(response.status).toBe(401);
    expect(mocks.refreshCreate).not.toHaveBeenCalled();
  });

  it("verifies an email with the hash of the supplied single-use token", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: "user_1",
      emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    });

    const response = await request(app).get("/auth/verify-email?token=verification-secret");

    expect(response.status).toBe(200);
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { emailVerificationHash: hashToken("verification-secret") },
      select: { id: true, emailVerificationExpiresAt: true },
    });
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        emailVerifiedAt: expect.any(Date),
        emailVerificationHash: null,
        emailVerificationExpiresAt: null,
      },
    });
  });

  it("resets a password with a one-time token and revokes active sessions atomically", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: "user_1",
      passwordResetExpiresAt: new Date(Date.now() + 60_000),
    });

    const response = await request(app)
      .post("/auth/reset-password")
      .send({ token: "reset-secret", newPassword: "new-password" });

    expect(response.status).toBe(200);
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "user_1",
        passwordResetHash: hashToken("reset-secret"),
        passwordResetExpiresAt: { gt: expect.any(Date) },
      },
      data: {
        passwordHash: "argon2:new-password",
        passwordResetHash: null,
        passwordResetExpiresAt: null,
      },
    });
    expect(mocks.refreshUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user_1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
