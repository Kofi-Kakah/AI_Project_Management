import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MembershipStatus,
  OrganizationRole,
} from "../../generated/prisma/enums";

const { prismaMocks } = vi.hoisted(() => ({
  prismaMocks: {
    organizationCreate: vi.fn(),
    organizationFindUnique: vi.fn(),
    membershipFindMany: vi.fn(),
    membershipFindUnique: vi.fn(),
    membershipFindFirst: vi.fn(),
    membershipCreate: vi.fn(),
    membershipUpdate: vi.fn(),
    membershipUpdateMany: vi.fn(),
    membershipFindUniqueOrThrow: vi.fn(),
    userFindUnique: vi.fn(),
  },
}));

vi.mock("../../src/config/db", () => ({
  prisma: {
    organization: {
      create: prismaMocks.organizationCreate,
      findUnique: prismaMocks.organizationFindUnique,
    },
    membership: {
      findMany: prismaMocks.membershipFindMany,
      findUnique: prismaMocks.membershipFindUnique,
      findFirst: prismaMocks.membershipFindFirst,
      create: prismaMocks.membershipCreate,
      update: prismaMocks.membershipUpdate,
      updateMany: prismaMocks.membershipUpdateMany,
      findUniqueOrThrow: prismaMocks.membershipFindUniqueOrThrow,
    },
    user: { findUnique: prismaMocks.userFindUnique },
  },
}));

vi.mock("../../src/config/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    incr: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("../../src/middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    const userId = req.header("authorization")?.replace(/^Bearer /, "");
    if (userId) req.auth = { userId, email: `${userId}@example.com` };
    next();
  },
}));

vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
vi.stubEnv(
  "JWT_ACCESS_TOKEN_SECRET",
  "test-secret-that-is-long-enough-for-jwt",
);

const { errorHandler } = await import("../../src/middleware/errorHandler");
const { organizationsRouter } =
  await import("../../src/modules/organizations/organizations.routes");

const app = express();
app.use(express.json());
app.use("/organizations", organizationsRouter);
app.use(errorHandler);

describe("organization routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an organization with its creator as active owner", async () => {
    prismaMocks.organizationCreate.mockResolvedValue({
      id: "org-a",
      memberships: [{ role: "OWNER" }],
    });

    const response = await request(app)
      .post("/organizations")
      .set("Authorization", "Bearer user-a")
      .send({ name: "Acme Projects" });

    expect(response.status).toBe(201);
    expect(prismaMocks.organizationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberships: {
            create: expect.objectContaining({
              userId: "user-a",
              role: OrganizationRole.OWNER,
              status: MembershipStatus.ACTIVE,
            }),
          },
        }),
      }),
    );
  });

  it("lists only active organizations belonging to the current user", async () => {
    prismaMocks.membershipFindMany.mockResolvedValue([]);

    const response = await request(app)
      .get("/organizations")
      .set("Authorization", "Bearer user-a");

    expect(response.status).toBe(200);
    expect(prismaMocks.membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-a", status: MembershipStatus.ACTIVE },
      }),
    );
  });

  it("hides organizations from users without active membership", async () => {
    prismaMocks.membershipFindUnique.mockResolvedValue(null);

    const response = await request(app)
      .get("/organizations/org-a")
      .set("Authorization", "Bearer user-b");

    expect(response.status).toBe(404);
    expect(prismaMocks.membershipFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_userId: { organizationId: "org-a", userId: "user-b" },
        },
      }),
    );
  });

  it("forbids regular members from inviting users", async () => {
    prismaMocks.membershipFindUnique.mockResolvedValue({
      organizationId: "org-a",
      userId: "user-a",
      role: OrganizationRole.MEMBER,
      status: MembershipStatus.ACTIVE,
    });

    const response = await request(app)
      .post("/organizations/org-a/invitations")
      .set("Authorization", "Bearer user-a")
      .send({ email: "invitee@example.com", role: "MEMBER" });

    expect(response.status).toBe(403);
    expect(prismaMocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("prevents admins from inviting other admins", async () => {
    prismaMocks.membershipFindUnique.mockResolvedValue({
      organizationId: "org-a",
      userId: "admin-a",
      role: OrganizationRole.ADMIN,
      status: MembershipStatus.ACTIVE,
    });

    const response = await request(app)
      .post("/organizations/org-a/invitations")
      .set("Authorization", "Bearer admin-a")
      .send({ email: "invitee@example.com", role: "ADMIN" });

    expect(response.status).toBe(403);
    expect(prismaMocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("scopes role changes to the requested organization", async () => {
    prismaMocks.membershipFindUnique.mockResolvedValue({
      organizationId: "org-a",
      userId: "owner-a",
      role: OrganizationRole.OWNER,
      status: MembershipStatus.ACTIVE,
    });
    prismaMocks.membershipFindFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch("/organizations/org-a/members/member-from-org-b/role")
      .set("Authorization", "Bearer owner-a")
      .send({ role: "ADMIN" });

    expect(response.status).toBe(404);
    expect(prismaMocks.membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "member-from-org-b",
          organizationId: "org-a",
          status: MembershipStatus.ACTIVE,
        },
      }),
    );
  });

  it("scopes invitation acceptance to its organization, invitee, and invited status", async () => {
    prismaMocks.membershipUpdateMany.mockResolvedValue({ count: 0 });

    const response = await request(app)
      .post("/organizations/org-a/invitations/invite-from-org-b/accept")
      .set("Authorization", "Bearer user-a");

    expect(response.status).toBe(404);
    expect(prismaMocks.membershipUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "invite-from-org-b",
          organizationId: "org-a",
          userId: "user-a",
          status: MembershipStatus.INVITED,
        },
      }),
    );
  });
});
