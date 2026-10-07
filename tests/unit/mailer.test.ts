import { beforeEach, describe, expect, it, vi } from "vitest";

const { emailEnv, createTransport, sendMail, warn } = vi.hoisted(() => ({
  emailEnv: {
    NODE_ENV: "test" as string,
    APP_URL: "http://localhost:4000",
    FRONTEND_URL: "http://localhost:3000",
    EMAIL_HOST: undefined as string | undefined,
    EMAIL_PORT: 587,
    EMAIL_USERNAME: undefined as string | undefined,
    EMAIL_PASSWORD: undefined as string | undefined,
    EMAIL_FROM: undefined as string | undefined,
  },
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../src/config/env", () => ({ env: emailEnv }));
vi.mock("../../src/utils/logger", () => ({ logger: { warn } }));
vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

const { deliverEmail } = await import("../../src/utils/mailer");

describe("email delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailEnv.NODE_ENV = "test";
    emailEnv.EMAIL_HOST = undefined;
    emailEnv.EMAIL_PORT = 587;
    emailEnv.EMAIL_USERNAME = undefined;
    emailEnv.EMAIL_PASSWORD = undefined;
    emailEnv.EMAIL_FROM = undefined;
    createTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({});
  });

  it("never logs verification bearer tokens when SMTP is not configured", async () => {
    const token = "sensitive-verification-token";
    await deliverEmail({ kind: "verify", email: "user@example.com", token });

    expect(warn).toHaveBeenCalledWith(
      { kind: "verify", recipient: "user@example.com" },
      expect.any(String),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("sends verification links through configured SMTP without logging tokens", async () => {
    emailEnv.EMAIL_HOST = "smtp.example.com";
    emailEnv.EMAIL_FROM = "noreply@example.com";
    const token = "sensitive-verification-token";

    await deliverEmail({ kind: "verify", email: "user@example.com", token });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        from: "noreply@example.com",
        text: expect.stringContaining(
          `http://localhost:4000/auth/verify-email?token=${token}`,
        ),
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("escapes untrusted invitation content in HTML emails", async () => {
    emailEnv.EMAIL_HOST = "smtp.example.com";
    emailEnv.EMAIL_FROM = "noreply@example.com";

    await deliverEmail({
      kind: "invitation",
      email: "invitee@example.com",
      inviteeName: "<script>alert(1)</script>",
      inviterName: "Owner & Admin",
      organizationName: "Example <Org>",
      invitationUrl: "https://app.example.com/invitations/token",
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.not.stringContaining("<script>"),
      }),
    );
  });

  it("fails explicitly when production SMTP is not configured", async () => {
    emailEnv.NODE_ENV = "production";

    await expect(
      deliverEmail({
        kind: "reset",
        email: "user@example.com",
        token: "sensitive-reset-token",
      }),
    ).rejects.toThrow("Email delivery requires EMAIL_HOST and EMAIL_FROM");
    expect(warn).not.toHaveBeenCalled();
  });
});
