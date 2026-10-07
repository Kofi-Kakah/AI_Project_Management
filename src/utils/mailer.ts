import nodemailer from "nodemailer";
import { env } from "../config/env";
import type { EmailJobData } from "../jobs/queues";
import { logger } from "./logger";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character]!;
  });
}

function emailContent(data: EmailJobData): {
  subject: string;
  text: string;
  html: string;
} {
  if (data.kind === "invitation") {
    const link = escapeHtml(data.invitationUrl);
    return {
      subject: `Invitation to ${data.organizationName}`,
      text: `${data.inviterName} invited you to join ${data.organizationName}. Accept the invitation: ${data.invitationUrl}`,
      html: `<p>Hello ${escapeHtml(data.inviteeName)},</p><p>${escapeHtml(data.inviterName)} invited you to join ${escapeHtml(data.organizationName)}.</p><p><a href="${link}">Accept invitation</a></p>`,
    };
  }

  const baseUrl = data.kind === "verify" ? env.APP_URL : env.FRONTEND_URL;
  const path =
    data.kind === "verify" ? "/auth/verify-email" : "/reset-password";
  const url = new URL(path, baseUrl);
  url.searchParams.set("token", data.token);
  const link = escapeHtml(url.toString());
  const subject =
    data.kind === "verify"
      ? "Verify your email address"
      : "Reset your password";
  const action =
    data.kind === "verify" ? "Verify your email" : "Reset your password";

  return {
    subject,
    text: `${action}: ${url.toString()}`,
    html: `<p>${action} using the following link:</p><p><a href="${link}">${action}</a></p>`,
  };
}

export async function deliverEmail(data: EmailJobData): Promise<void> {
  if (!env.EMAIL_HOST && !env.EMAIL_FROM) {
    if (env.NODE_ENV === "production") {
      throw new Error("Email delivery requires EMAIL_HOST and EMAIL_FROM");
    }
    logger.warn(
      { kind: data.kind, recipient: data.email },
      "Email not delivered because SMTP is not configured",
    );
    return;
  }

  if (!env.EMAIL_HOST || !env.EMAIL_FROM) {
    throw new Error("Email delivery requires both EMAIL_HOST and EMAIL_FROM");
  }
  if (Boolean(env.EMAIL_USERNAME) !== Boolean(env.EMAIL_PASSWORD)) {
    throw new Error("Email SMTP authentication requires username and password");
  }

  const transporter = nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT,
    secure: env.EMAIL_PORT === 465,
    ...(env.EMAIL_USERNAME && env.EMAIL_PASSWORD
      ? { auth: { user: env.EMAIL_USERNAME, pass: env.EMAIL_PASSWORD } }
      : {}),
  });
  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: data.email,
    ...emailContent(data),
  });
}
