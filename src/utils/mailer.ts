import { env } from "../config/env";
import type { EmailJobData } from "../jobs/queues";

export async function deliverEmail(data: EmailJobData): Promise<void> {
  if (data.kind === "invitation") {
    console.info(
      `[console-mailer] invitation email for ${data.email}: ${data.invitationUrl} (invited by ${data.inviterName} to ${data.organizationName}; invitee: ${data.inviteeName})`,
    );
    return;
  }

  const baseUrl = data.kind === "verify" ? env.APP_URL : env.FRONTEND_URL;
  const path =
    data.kind === "verify" ? "/auth/verify-email" : "/reset-password";
  const url = new URL(path, baseUrl);
  url.searchParams.set("token", data.token);
  console.info(
    `[console-mailer] ${data.kind} email for ${data.email}: ${url.toString()}`,
  );
}
