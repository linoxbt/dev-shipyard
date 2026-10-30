import { createHash } from "node:crypto";

// A DevStation account, as the rest of the server knows it.
//
// Everything downstream of sign-in (the session cookie, workspace ownership on
// the runner, builders added to a workspace, rate limits, the GitHub link)
// identifies a person by a 0x-style id. With a wallet that id was the wallet's
// address. With email sign-in it is derived from the verified email address:
// the same email always gives the same id, so an owner can add a builder by
// email before that builder has ever signed in, and nothing downstream has to
// change.
//
// Derived from the email rather than Supabase's user id for exactly that
// reason. Only a verified email is ever passed in (lib/auth/supabase.server.ts).

export function accountAddress(email: string): string {
  const normal = email.trim().toLowerCase();
  return `0x${createHash("sha256").update(`devstation-account:${normal}`).digest("hex").slice(0, 40)}`;
}
