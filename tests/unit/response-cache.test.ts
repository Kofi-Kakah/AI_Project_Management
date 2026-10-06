import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationRole } from "../../generated/prisma/enums";

const { cache, values } = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    cache: {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
        return "OK";
      }),
      incr: vi.fn(async (key: string) => {
        const version = Number(values.get(key) ?? "0") + 1;
        values.set(key, String(version));
        return version;
      }),
    },
  };
});

vi.mock("../../src/config/redis", () => ({ redis: cache }));
vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");

const { cacheOrganizationResponses, invalidateOrganizationResponses } =
  await import("../../src/middleware/responseCache");

let readCount = 0;
const app = express();
app.use((req, _res, next) => {
  const userId = req.header("x-user") ?? "user-a";
  const organizationId = req.header("x-organization") ?? "org-a";
  req.auth = { userId, email: `${userId}@example.com` };
  req.organization = {
    id: organizationId,
    userId,
    role: OrganizationRole.MEMBER,
  };
  next();
});
app.use(cacheOrganizationResponses, invalidateOrganizationResponses);
app.get("/organizations/:organizationId/resources", (_req, res) => {
  readCount += 1;
  res.json({ readCount });
});
app.post("/organizations/:organizationId/resources", (_req, res) => {
  res.status(204).end();
});

describe("organization response cache", () => {
  beforeEach(() => {
    values.clear();
    cache.get.mockClear();
    cache.set.mockClear();
    cache.incr.mockClear();
    readCount = 0;
  });

  it("reuses only a user's organization-scoped response and invalidates it on writes", async () => {
    const first = await request(app).get("/organizations/org-a/resources");
    const cached = await request(app).get("/organizations/org-a/resources");
    const otherUser = await request(app)
      .get("/organizations/org-a/resources")
      .set("x-user", "user-b");
    const otherOrganization = await request(app)
      .get("/organizations/org-a/resources")
      .set("x-organization", "org-b");

    expect(first.body).toEqual({ readCount: 1 });
    expect(cached.body).toEqual({ readCount: 1 });
    expect(otherUser.body).toEqual({ readCount: 2 });
    expect(otherOrganization.body).toEqual({ readCount: 3 });

    await request(app).post("/organizations/org-a/resources");
    const afterWrite = await request(app).get("/organizations/org-a/resources");

    expect(cache.incr).toHaveBeenCalledWith(
      "response-cache:organization:org-a:version",
    );
    expect(afterWrite.body).toEqual({ readCount: 4 });
  });
});
