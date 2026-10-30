import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The browser's Supabase client, for email sign-in with a one-time code. Null when the
// deployment has no Supabase project configured, so the page can say so
// instead of failing on first use.
//
// The project URL and publishable key are public by design: what an account
// can do is decided by Supabase's own rules and by DevStation's server, which
// checks every session it is handed (lib/auth/supabase.server.ts).

const URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const KEY = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!URL || !KEY || typeof window === "undefined") return null;
  client ??= createClient(URL, KEY, {
    auth: {
      // Sign-in is by a code typed in (useAuth.verifyCode), not a link. PKCE
      // stays for any link Supabase does send (an invite, a change of
      // email): only the browser that asked can exchange it.
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export const supabaseConfigured = Boolean(URL && KEY);
