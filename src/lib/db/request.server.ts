// Who is asking, for the account, connector and stats endpoints: the signed-in
// account from DevStation's own session cookie (set by /api/access/session
// after Supabase confirmed the email), and whether that account is an admin.

import { CLAIM_COOKIE, openClaims, ownerOf, readCookie } from "@/lib/agent-access/claims.server";
import { accountAddress } from "@/lib/auth/account.server";

export function requestOwner(request: Request): string | null {
  return ownerOf(openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE)));
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
