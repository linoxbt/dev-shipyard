// Emails a DevStation sign-in code, in DevStation Labs branding.
//
// POST { email } -> 200 { sent: true }
//
// Supabase makes the code (auth.admin.generateLink, which sends nothing) and
// this function sends it through Resend, so the email's design lives in the
// repository and no dashboard template, SMTP or Site URL setting is involved.
// The browser then signs in with supabase.auth.verifyOtp({ type: "email" }).
// A new address gets an account and the welcome email; a known one gets the
// sign-in email.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   RESEND_API_KEY  required; without it the function answers 503
//   EMAIL_FROM      optional, default "DevStation <onboarding@resend.dev>"
//                   (Resend only delivers that sender to the Resend account's
//                   own address; set one on a verified domain for everyone)
//   SITE_URL        optional, default https://devstation-omega.vercel.app
//
// Floods are refused by public.claim_code_request: one code a minute and six
// an hour per address, thirty an hour per IP.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SIGN_IN, SIGN_UP } from "./templates.ts";

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://devstation-omega.vercel.app").replace(
  /\/+$/,
  "",
);
const FROM = Deno.env.get("EMAIL_FROM") ?? "DevStation <onboarding@resend.dev>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { message: "Use POST." });

  let email = "";
  try {
    email = String((await req.json())?.email ?? "")
      .trim()
      .toLowerCase();
  } catch {
    // Falls through to the check below.
  }
  if (!EMAIL.test(email) || email.length > 254) {
    return reply(400, { message: "Enter a valid email address." });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return reply(503, {
      code: "not_configured",
      message: "Sign-in emails are not set up on this deployment yet.",
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const { data: wait, error: limitError } = await admin.rpc("claim_code_request", {
    p_email_hash: await sha256(email),
    p_ip: ip,
  });
  if (limitError) {
    console.error("claim_code_request", limitError.message);
    return reply(500, { message: "Could not send a code. Try again in a minute." });
  }
  if (typeof wait === "number") {
    return reply(429, {
      wait,
      message:
        wait >= 3600
          ? "Too many codes for this address. Try again in an hour."
          : `A code was sent a moment ago. Wait ${wait} seconds, then ask for another.`,
    });
  }

  // Make the code. A new address may need its account made first, depending
  // on the Supabase version: try, and if it is unknown, create it and retry.
  let created = false;
  let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error && /not.?found|no user/i.test(link.error.message)) {
    const made = await admin.auth.admin.createUser({ email });
    if (made.error) {
      console.error("createUser", made.error.message);
      return reply(500, { message: "Could not make your account. Try again." });
    }
    created = true;
    link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  }
  const code = link.data?.properties?.email_otp;
  if (link.error || !code) {
    console.error("generateLink", link.error?.message ?? "no email_otp");
    return reply(500, { message: "Could not make a code. Try again." });
  }
  const isNew = created || link.data.properties.verification_type === "signup";

  const template = isNew ? SIGN_UP : SIGN_IN;
  const fill = (s: string, html: boolean) =>
    s
      .replaceAll("{{ .Token }}", code)
      .replaceAll("{{ .Email }}", html ? escapeHtml(email) : email)
      .replaceAll("{{ .SiteURL }}", SITE_URL);

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: template.subject,
      html: fill(template.html, true),
      text: fill(template.text, false),
    }),
  });
  if (!sent.ok) {
    console.error("resend", sent.status, await sent.text());
    return reply(502, { message: "The email could not be sent. Try again in a minute." });
  }
  return reply(200, { sent: true });
});
