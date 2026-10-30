// Checking a Supabase session on the server.
//
// The browser signs in with Supabase and hands its access token to
// /api/access/session once. That token is not trusted as it stands: Supabase
// itself is asked who it belongs to (GET /auth/v1/user), and only an account
// whose email has been confirmed is accepted. The answer becomes DevStation's
// own httpOnly session cookie, so the token is never stored server-side and
// every other route keeps working off that cookie.

export interface SupabaseAccount {
  id: string;
  email: string;
  name: string | null;
}

/** The project's URL and publishable key. Both are public by design; the
 *  VITE_ names are the ones the browser build uses, read here too. */
export function supabaseConfig(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  key: string;
} | null {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  return url && key ? { url, key } : null;
}

export async function verifySupabaseToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SupabaseAccount | null> {
  const cfg = supabaseConfig(env);
  if (!cfg || !token || token.length > 8192) return null;
  try {
    const res = await fetchImpl(`${cfg.url}/auth/v1/user`, {
      headers: { apikey: cfg.key, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as {
      id?: unknown;
      email?: unknown;
      email_confirmed_at?: unknown;
      user_metadata?: { full_name?: unknown; name?: unknown };
    };
    if (typeof user.id !== "string" || typeof user.email !== "string") return null;
    // An unconfirmed address could be anybody's: no session until it is.
    if (!user.email_confirmed_at) return null;
    const rawName = user.user_metadata?.full_name ?? user.user_metadata?.name;
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 80) : null;
    return { id: user.id, email: user.email.toLowerCase(), name };
  } catch {
    return null;
  }
}
