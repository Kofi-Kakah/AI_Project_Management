import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("JWT_ACCESS_TOKEN_SECRET", "test-secret-that-is-long-enough-for-jwt");
vi.stubEnv("GOOGLE_CLIENT_ID", "");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "");

const { authRouter } = await import("../../src/modules/auth/auth.routes");
const app = express();
app.use(express.json());
app.use("/auth", authRouter);

describe("auth routes", () => {
  it("rejects invalid registration input", async () => {
    const response = await request(app).post("/auth/register").send({ email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it("rejects invalid login input", async () => {
    const response = await request(app).post("/auth/login").send({ email: "bad", password: "" });

    expect(response.status).toBe(400);
  });

  it("requires a bearer token for the current-user route", async () => {
    const response = await request(app).get("/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required");
  });

  it("allows logout when no refresh cookie is present", async () => {
    const response = await request(app).post("/auth/logout");

    expect(response.status).toBe(204);
  });

  it("requires a refresh cookie to rotate a session", async () => {
    const response = await request(app).post("/auth/refresh");

    expect(response.status).toBe(401);
  });

  it("rejects a missing email-verification token", async () => {
    const response = await request(app).get("/auth/verify-email");

    expect(response.status).toBe(400);
  });

  it("validates verification resend requests", async () => {
    const response = await request(app).post("/auth/resend-verification").send({});

    expect(response.status).toBe(400);
  });

  it("validates password-reset requests", async () => {
    const requestReset = await request(app).post("/auth/forgot-password").send({});
    const reset = await request(app).post("/auth/reset-password").send({});

    expect(requestReset.status).toBe(400);
    expect(reset.status).toBe(400);
  });

  it("reports Google sign-in as unavailable when not configured", async () => {
    const response = await request(app).get("/auth/google");

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("Google sign-in is not configured");
  });
});
