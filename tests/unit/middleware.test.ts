import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/errorHandler";
import { validate } from "../../src/middleware/validate";
import { AppError } from "../../src/utils/AppError";
import { emailSchema } from "../../src/modules/auth/auth.schema";

const app = express();
app.use(express.json());
app.post("/validated", validate(emailSchema), (req, res) => {
  res.json(req.body);
});
app.get("/expected-error", (_req, _res, next) => {
  next(new AppError("Not found", 404, "NOT_FOUND"));
});
app.get("/unexpected-error", (_req, _res, next) => {
  next(new Error("Private implementation detail"));
});
app.use(errorHandler);

describe("core middleware", () => {
  it("rejects invalid input before route execution", async () => {
    const response = await request(app).post("/validated").send({ email: "invalid" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Request validation failed",
      code: "VALIDATION_ERROR",
    });
  });

  it("passes sanitized schema output to the route", async () => {
    const response = await request(app)
      .post("/validated")
      .send({ email: "  test@example.com  ", extra: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ email: "test@example.com" });
  });

  it("returns intentional application errors with their status and code", async () => {
    const response = await request(app).get("/expected-error");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found", code: "NOT_FOUND" });
  });

  it("hides unexpected internal error details", async () => {
    const response = await request(app).get("/unexpected-error");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  });
});
