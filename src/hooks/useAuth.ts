import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { setGrantSession } from "@/lib/agent-access/grant";
import { supabase, supabaseConfigured } from "@/lib/auth/supabase";
import { useTheme } from "@/lib/theme";

// Who is signed in, for the whole app.
//
// Email sign-in through Supabase, with no passwords: we email a one-time code
// and the person types it in. The same two steps make an account the first
// time and sign in every time after. A session here is traded once for
// DevStation's own session cookie (/api/access/session), and every request
// that needs one gets it the same way a wallet signature used to.

export interface Account {
  id: string;
  email: string;
  /** What they asked to be called, chosen right after signing up. */
  name: string | null;
  /** The theme they picked, kept with the account so it follows them. */
  theme: "light" | "dark" | null;
}

interface AuthState {
  ready: boolean;
  configured: boolean;
  account: Account | null;
  init: () => void;
  /** Email a one-time code. Makes the account if the email is new. */
  sendCode: (email: string) => Promise<string | null>;
  /** Sign in with the code from that email. */
  verifyCode: (email: string, code: string) => Promise<string | null>;
  /** Save the name and/or theme on the account. */
  updateProfile: (patch: { name?: string; theme?: "light" | "dark" }) => Promise<string | null>;
  signOut: () => Promise<void>;
}

function accountOf(session: Session | null): Account | null {
  const user = session?.user;
  if (!user?.email) return null;
  const raw = user.user_metadata?.full_name ?? user.user_metadata?.name;
  const theme = user.user_metadata?.theme;
  return {
    id: user.id,
    email: user.email,
    name: typeof raw === "string" && raw.trim() ? raw.trim() : null,
    theme: theme === "light" || theme === "dark" ? theme : null,
  };
}

/** The first name, for "Hi Denis." */
export function firstName(account: Account | null): string | null {
  if (!account) return null;
  const from = account.name ?? account.email.split("@")[0];
  const first = from.split(/[\s._-]+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : null;
}

/** Two letters for an avatar: "Denis Alem" is DA, "denis@x" is DE. */
export function initials(account: Account | null): string {
  if (!account) return "";
  const words = (account.name ?? account.email.split("@")[0]).split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

const message = (e: { message?: string } | null | undefined) =>
  e ? e.message || "That did not work. Try again." : null;

let started = false;

export const useAuth = create<AuthState>((set) => ({
  ready: false,
  configured: supabaseConfigured,
  account: null,

  init: () => {
    if (started) return;
    started = true;
    const sb = supabase();
    if (!sb) {
      set({ ready: true });
      return;
    }
    const apply = (session: Session | null) => {
      const account = accountOf(session);
      set({ account, ready: true });
      // The account's theme wins over this browser's: it is what they chose.
      if (account?.theme && useTheme.getState().theme !== account.theme) {
        useTheme.getState().setTheme(account.theme);
      }
      setGrantSession(
        account
          ? async () => (await sb.auth.getSession()).data.session?.access_token ?? null
          : null,
      );
    };
    void sb.auth.getSession().then(({ data }) => apply(data.session));
    sb.auth.onAuthStateChange((event, session) => {
      apply(session);
      if (event === "SIGNED_OUT") {
        // The grant cookie is DevStation's, not Supabase's: clear it too.
        void fetch("/api/access/session", { method: "DELETE" }).catch(() => undefined);
      }
    });
  },

  sendCode: async (email) => {
    const sb = supabase();
    if (!sb) return "Email sign-in is not set up on this deployment.";
    // New emails get an account; the name and theme are asked for once they
    // are in (WelcomeSheet).
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error && (error.status === 429 || /rate|seconds/i.test(error.message))) {
      return "A code was sent a moment ago. Wait a minute, then ask for another.";
    }
    return message(error);
  },

  verifyCode: async (email, code) => {
    const sb = supabase();
    if (!sb) return "Email sign-in is not set up on this deployment.";
    const { error } = await sb.auth.verifyOtp({ email, token: code, type: "email" });
    if (!error) return null;
    if (/expired|invalid/i.test(error.message)) {
      return "That code is wrong or has expired. Check it, or send a new one.";
    }
    return message(error);
  },

  updateProfile: async (patch) => {
    const sb = supabase();
    if (!sb) return "Email sign-in is not set up on this deployment.";
    const data: Record<string, string> = {};
    if (patch.name !== undefined) data.full_name = patch.name.trim().slice(0, 80);
    if (patch.theme) data.theme = patch.theme;
    const { data: updated, error } = await sb.auth.updateUser({ data });
    if (error) return message(error);
    if (updated.user) {
      set((state) =>
        state.account
          ? {
              account: {
                ...state.account,
                ...(data.full_name !== undefined ? { name: data.full_name || null } : {}),
                ...(patch.theme ? { theme: patch.theme } : {}),
              },
            }
          : state,
      );
    }
    return null;
  },

  signOut: async () => {
    const sb = supabase();
    await sb?.auth.signOut();
    set({ account: null });
  },
}));
