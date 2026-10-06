import { env } from "../config/env";

export async function sendAuthLink(kind: "verify" | "reset", email: string, token: string) {
  const url = new URL(kind === "verify" ? "/auth/verify-email" : "/auth/reset-password", env.APP_URL);
  url.searchParams.set("token", token);
  console.info(`[console-mailer] ${kind} email for ${email}: ${url.toString()}`);
}
