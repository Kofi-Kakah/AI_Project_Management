import { env } from "../config/env";

export async function sendAuthLink(kind: "verify" | "reset", email: string, token: string) {
  const baseUrl = kind === "verify" ? env.APP_URL : env.FRONTEND_URL;
  const path = kind === "verify" ? "/auth/verify-email" : "/reset-password";
  const url = new URL(path, baseUrl);
  url.searchParams.set("token", token);
  console.info(`[console-mailer] ${kind} email for ${email}: ${url.toString()}`);
}
