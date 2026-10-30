import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { setGrantSession } from "@/lib/agent-access/grant";
import { supabase, supabaseConfigured } from "@/lib/auth/supabase";

// Who is signed in, for the whole app.
//
// Email sign-in through Supabase replaces the wallet: a session here is traded
// once for DevStation's own session cookie (/api/access/session), and every
// request that needs one gets it the same way a wallet signature used to.

export interface Account {
  id: string;
  email: string;
  /** What they asked to be called when they signed up. */
  name: string | null;
}

interface AuthState {
  ready: boolean;
  configured: boolean;
  account: Account | null;
  /** Arrived from a password reset email: show "choose a new password". */
  recovering: boolean;
  init: () => void;
  signUp: (name: string, email: string, password: string) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

function accountOf(session: Session | null): Account | null {
  const user = session?.user;
  if (!user?.email) return null;
  const raw = user.user_metadata?.full_name ?? user.user_metadata?.name;
  return {
    id: user.id,
    email: user.email,
    name: typeof raw === "string" && raw.trim() ? raw.trim() : null,
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
  recovering: false,

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
      setGrantSession(
        account
          ? async () => (await sb.auth.getSession()).data.session?.access_token ?? null
          : null,
      );
    };
    void sb.auth.getSession().then(({ data }) => apply(data.session));
    sb.auth.onAuthStateChange((event, session) => {
      apply(session);
      if (event === "PASSWORD_RECOVERY") set({ recovering: true });
      if (event === "SIGNED_OUT") {
        // The grant cookie is DevStation's, not Supabase's: clear it too.
        void fetch("/api/access/session", { method: "DELETE" }).catch(() => undefined);
      }
    });
  },

  signUp: async (name, email, password) => {
    const sb = supabase();
    if (!sb) return "Email sign-in is not set up on this deployment.";
    const { error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    return message(error);
  },

  signIn: async (email, password) => {
    const sb = supabase();
    if (!sb) return "Email sign-in is not set up on this deployment.";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error && /confirm/i.test(error.message)) {
      return "Confirm your email first: open the link we sent you, then sign in.";
    }
    return error ? "That email and password do not match an account." : null;
  },

  resetPassword: async (email) => {
    const sb = supabase();
    if (!sb) return "Email sign-in is not set up on this deployment.";
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });
    return message(error);
  },

  updatePassword: async (password) => {
    const sb = supabase();
    if (!sb) return "Email sign-in is not set up on this deployment.";
    const { error } = await sb.auth.updateUser({ password });
    if (!error) set({ recovering: false });
    return message(error);
  },

  signOut: async () => {
    const sb = supabase();
    await sb?.auth.signOut();
    set({ account: null });
  },
}));
