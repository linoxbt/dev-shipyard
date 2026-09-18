// Sending one kind of message: a code that proves somebody owns an address.
//
// Resend rather than SMTP: this host's outbound mail would be unauthenticated
// from a fresh IP and land in spam, and a plain HTTPS call needs no port open
// and no mail server to run. Without a key, this says so rather than
// pretending a code was sent.

export interface MailResult {
  ok: boolean;
  reason?: "not_configured" | "failed";
  message?: string;
}

const ENDPOINT = "https://api.resend.com/emails";

export function mailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.RESEND_API_KEY;
}

export async function sendMail(
  message: { to: string; subject: string; text: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<MailResult> {
  const key = env.RESEND_API_KEY ?? "";
  if (!key) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Email is not set up on this deployment yet.",
    };
  }
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.MAIL_FROM ?? "DevStation <noreply@devstation.online>",
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    // Resend's own words are useful here (an unverified sending domain, a
    // suppressed address), and none of it contains the key.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return {
      ok: false,
      reason: "failed",
      message: body?.message ?? `The mail service said ${res.status}.`,
    };
  } catch {
    return { ok: false, reason: "failed", message: "The mail service could not be reached." };
  }
}

/** The one message this sends. */
export function codeMessage(code: string): { subject: string; text: string } {
  return {
    subject: `${code} is your DevStation code`,
    text: [
      `${code} is your DevStation verification code.`,
      "",
      "It expires in 10 minutes and can be used once.",
      "If you did not ask to link this address to a DevStation wallet, ignore this email.",
    ].join("\n"),
  };
}
