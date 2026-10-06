import jwt from "jsonwebtoken";
import type { Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembershipStatus } from "../../generated/prisma/enums";

const { userFindUnique, membershipFindFirst, projectFindUnique } = vi.hoisted(
  () => ({
    userFindUnique: vi.fn(),
    membershipFindFirst: vi.fn(),
    projectFindUnique: vi.fn(),
  }),
);

vi.mock("../../src/config/db", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    membership: { findFirst: membershipFindFirst },
    project: { findUnique: projectFindUnique },
  },
}));

vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
vi.stubEnv(
  "JWT_ACCESS_TOKEN_SECRET",
  "test-secret-that-is-long-enough-for-jwt",
);

const {
  authenticateSocketToken,
  organizationRoom,
  projectRoom,
  registerRoomHandlers,
} = await import("../../src/realtime/socket");
const { REALTIME_CLIENT_EVENTS } = await import("../../src/realtime/events");

const secret = "test-secret-that-is-long-enough-for-jwt";

function accessToken(userId = "user-a"): string {
  return jwt.sign({ email: `${userId}@example.com` }, secret, {
    subject: userId,
    expiresIn: "1m",
    issuer: "ai-project-management",
    audience: "api",
  });
}

function createSocket() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const socket = {
    data: { identity: { userId: "user-a", email: "user-a@example.com" } },
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(event, handler),
    ),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  };
  registerRoomHandlers(socket as unknown as Socket);
  return { handlers, socket };
}

describe("realtime socket authentication and room authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUnique.mockResolvedValue({ disabledAt: null });
  });

  it("authenticates signed access tokens and rejects disabled accounts", async () => {
    await expect(authenticateSocketToken(accessToken())).resolves.toEqual({
      userId: "user-a",
      email: "user-a@example.com",
    });

    userFindUnique.mockResolvedValueOnce({ disabledAt: new Date() });
    await expect(authenticateSocketToken(accessToken())).rejects.toThrow(
      "User is unavailable",
    );
  });

  it("rejects invalid or expired access tokens", async () => {
    await expect(authenticateSocketToken("not-a-jwt")).rejects.toThrow();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("allows only active organization members to join an organization room", async () => {
    const { handlers, socket } = createSocket();
    const acknowledge = vi.fn();
    membershipFindFirst.mockResolvedValue({ id: "membership-a" });

    await handlers.get(REALTIME_CLIENT_EVENTS.joinOrganization)?.(
      "org-a",
      acknowledge,
    );

    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-a",
        userId: "user-a",
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true },
    });
    expect(socket.join).toHaveBeenCalledWith(organizationRoom("org-a"));
    expect(acknowledge).toHaveBeenCalledWith({ ok: true });
  });

  it("denies inactive users and invalid room identifiers", async () => {
    const { handlers, socket } = createSocket();
    const acknowledge = vi.fn();
    membershipFindFirst.mockResolvedValue(null);

    await handlers.get(REALTIME_CLIENT_EVENTS.joinOrganization)?.(
      "org-a",
      acknowledge,
    );
    expect(acknowledge).toHaveBeenCalledWith({
      ok: false,
      error: "FORBIDDEN",
    });
    expect(socket.join).not.toHaveBeenCalled();

    await handlers.get(REALTIME_CLIENT_EVENTS.joinProject)?.("", acknowledge);
    expect(acknowledge).toHaveBeenLastCalledWith({
      ok: false,
      error: "INVALID_ARGUMENT",
    });
  });

  it("authorizes project-room access through the owning organization", async () => {
    const { handlers, socket } = createSocket();
    const acknowledge = vi.fn();
    projectFindUnique.mockResolvedValue({ organizationId: "org-a" });
    membershipFindFirst.mockResolvedValue({ id: "membership-a" });

    await handlers.get(REALTIME_CLIENT_EVENTS.joinProject)?.(
      "project-a",
      acknowledge,
    );

    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-a",
        userId: "user-a",
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true },
    });
    expect(socket.join).toHaveBeenCalledWith(projectRoom("project-a"));
    expect(acknowledge).toHaveBeenCalledWith({ ok: true });
  });

  it("denies project rooms when the user is not active in its organization", async () => {
    const { handlers, socket } = createSocket();
    const acknowledge = vi.fn();
    projectFindUnique.mockResolvedValue({ organizationId: "org-b" });
    membershipFindFirst.mockResolvedValue(null);

    await handlers.get(REALTIME_CLIENT_EVENTS.joinProject)?.(
      "project-from-org-b",
      acknowledge,
    );

    expect(socket.join).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith({
      ok: false,
      error: "FORBIDDEN",
    });
  });

  it("leaves only the explicitly named organization or project room", async () => {
    const { handlers, socket } = createSocket();

    await handlers.get(REALTIME_CLIENT_EVENTS.leaveOrganization)?.("org-a");
    await handlers.get(REALTIME_CLIENT_EVENTS.leaveProject)?.("project-a");

    expect(socket.leave).toHaveBeenNthCalledWith(1, organizationRoom("org-a"));
    expect(socket.leave).toHaveBeenNthCalledWith(2, projectRoom("project-a"));
  });
});
