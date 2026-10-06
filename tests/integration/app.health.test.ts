import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryDatabase, pingRedis, callRedis } = vi.hoisted(() => ({
  queryDatabase: vi.fn(),
  pingRedis: vi.fn(),
  callRedis: vi.fn(),
}));

vi.mock("../../src/config/db", () => ({
  prisma: { $queryRaw: queryDatabase },
}));
vi.mock("../../src/config/redis", () => ({
  redis: { ping: pingRedis, call: callRedis },
}));

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("JWT_ACCESS_TOKEN_SECRET", "test-secret-that-is-long-enough-for-jwt");
vi.stubEnv("GOOGLE_CLIENT_ID", "");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "");

const { app } = await import("../../src/app");

describe("application health endpoint", () => {
  beforeEach(() => {
    queryDatabase.mockResolvedValue([{ "?column?": 1 }]);
    pingRedis.mockResolvedValue("PONG");
  });

  it("reports both dependencies healthy", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", db: "connected", redis: "connected" });
  });

  it("reports unavailable dependencies with a service-unavailable status", async () => {
    pingRedis.mockRejectedValueOnce(new Error("Redis unavailable"));

    const response = await request(app).get("/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "error", db: "connected", redis: "unreachable" });
  });
});
