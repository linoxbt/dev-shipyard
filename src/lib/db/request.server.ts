// Who is asking, for the account, connector and stats endpoints: the signed-in
// account from DevStation's own session cookie (set by /api/access/session
// after Supabase confirmed the email), and whether that account is an admin.

import { createHmac } from "node:crypto";
import {
  CLAIM_COOKIE,
  emailOf,
  openClaims,
  ownerOf,
  readCookie,
} from "@/lib/agent-access/claims.server";
import { accountAddress } from "@/lib/auth/account.server";

export function requestOwner(request: Request): string | null {
  return ownerOf(openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE)));
}

/** The signed-in account's email, when the session carries it. */
export function requestEmail(request: Request): string | null {
  return emailOf(openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE)));
}

/**
 * One person behind possibly many addresses: the email without
 * plus-addressing, and without the dots Gmail ignores, hashed with the
 * server's secret. Used so the launch credit is one per person.
 */
export function personOf(email: string, env: NodeJS.ProcessEnv = process.env): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const gmail = domain === "gmail.com" || domain === "googlemail.com";
  const base = local.split("+")[0];
  const normal = `${gmail ? base.replace(/\./g, "") : base}@${gmail ? "gmail.com" : domain}`;
  const key = env.SESSION_SECRET || env.RUNNER_TOKEN || "devstation";
  return createHmac("sha256", key).update(`person:${normal}`).digest("hex");
}

/** Admins are listed by email in ADMIN_EMAILS (comma separated) and matched by
 *  their account id, so the session cookie never has to carry an email. */
export function isAdmin(owner: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!owner) return false;
  return String(env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((email) => accountAddress(email) === owner);
}

export function fail(reason: string, message: string, status: number): Response {
  return Response.json({ ok: false, reason, message }, { status });
}
