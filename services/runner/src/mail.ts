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
  message: { to: string; subject: string; text: string; html?: string },
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
        // Both parts: the HTML for people, the text for clients that refuse it
        // and for spam filters, which distrust an HTML-only message.
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
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

// --- the one message this sends ---------------------------------------------
//
// Email is not a browser: no stylesheets, no flexbox, no web fonts. Tables and
// inline styles only, which is why this looks like 2005 HTML. The logo is a
// hosted PNG rather than the site's SVG, because Gmail and Outlook drop SVG,
// and the wordmark is live text beside it so the brand still reads when images
// are blocked -- which is the default in most clients for a first-time sender.

const BRAND = {
  amber: "#e67e22",
  teal: "#1294a9",
  ink: "#0b0e14",
  card: "#141a24",
  border: "#232b3a",
  text: "#e7ecf3",
  meta: "#6b7688",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

const LOGO = "https://devstation.online/icon-192.png";
const SITE = "https://devstation.online";

export function codeMessage(code: string): { subject: string; text: string; html: string } {
  const subject = `${code} is your DevStation code`;
  const text = [
    `${code} is your DevStation verification code.`,
    "",
    "It expires in 10 minutes and can be used once.",
    "If you did not ask to link this address to a DevStation wallet, ignore this email.",
    "",
    SITE,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.ink};">
<!-- The line clients show beside the subject, and nothing more. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your code is ${code}. It expires in 10 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.ink};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:100%;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;">
      <tr><td style="padding:24px 28px 18px 28px;border-bottom:1px solid ${BRAND.border};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-right:10px;" valign="middle">
              <img src="${LOGO}" width="34" height="34" alt="DevStation" style="display:block;border:0;border-radius:8px;">
            </td>
            <td valign="middle">
              <div style="font-family:${BRAND.mono};font-size:15px;font-weight:700;color:${BRAND.text};letter-spacing:-0.2px;">Dev<span style="color:${BRAND.amber};">Station</span></div>
              <div style="font-family:${BRAND.mono};font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:${BRAND.meta};padding-top:2px;">AI Developer OS</div>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:26px 28px 8px 28px;">
        <div style="font-family:${BRAND.mono};font-size:16px;font-weight:700;color:${BRAND.text};">Verify your email</div>
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#9aa6b8;padding-top:8px;">
          Enter this code in DevStation to link this address to your wallet.
        </div>
      </td></tr>
      <tr><td style="padding:14px 28px 6px 28px;">
        <div style="background:${BRAND.ink};border:1px solid ${BRAND.border};border-radius:10px;padding:18px 12px;text-align:center;font-family:${BRAND.mono};font-size:30px;font-weight:700;letter-spacing:9px;color:${BRAND.amber};">${code}</div>
      </td></tr>
      <tr><td style="padding:10px 28px 22px 28px;">
        <div style="font-family:${BRAND.mono};font-size:11px;color:${BRAND.meta};text-align:center;">
          Expires in 10 minutes <span style="color:${BRAND.teal};">&middot;</span> works once
        </div>
      </td></tr>
      <tr><td style="padding:16px 28px 22px 28px;border-top:1px solid ${BRAND.border};">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${BRAND.meta};">
          Did not ask for this? Ignore this email. Nothing is linked and nobody was told your address.
        </div>
        <div style="font-family:${BRAND.mono};font-size:11px;padding-top:12px;">
          <a href="${SITE}" style="color:${BRAND.amber};text-decoration:none;">devstation.online</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
