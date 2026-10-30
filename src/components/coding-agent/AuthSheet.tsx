import { useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, LoaderCircle, MailCheck } from "lucide-react";
import { LogoMark } from "@/components/shared/Logo";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Modal } from "./primitives";

// Sign up, sign in, forgotten password and choosing a new one, in one sheet.
// Email and password through Supabase; the account's email must be confirmed
// before DevStation will open a session for it.

export type AuthView = "signin" | "signup" | "forgot" | "newpassword";

const field =
  "w-full rounded-xl border border-border bg-background px-3.5 py-3 text-[14px] text-foreground placeholder:text-meta focus:border-primary focus:outline-none";

export function AuthSheet({
  initial = "signin",
  onClose,
}: {
  initial?: AuthView;
  onClose: () => void;
}) {
  const auth = useAuth();
  const [view, setView] = useState<AuthView>(auth.recovering ? "newpassword" : initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<null | "confirm" | "reset">(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let problem: string | null = null;
    if (view === "signup") {
      problem = await auth.signUp(email.trim(), password);
      if (!problem) setSent("confirm");
    } else if (view === "signin") {
      problem = await auth.signIn(email.trim(), password);
      if (!problem) onClose();
    } else if (view === "forgot") {
      problem = await auth.resetPassword(email.trim());
      if (!problem) setSent("reset");
    } else {
      problem = await auth.updatePassword(password);
      if (!problem) onClose();
    }
    setBusy(false);
    setError(problem);
  };

  const titles: Record<AuthView, string> = {
    signin: "Welcome back",
    signup: "Create your account",
    forgot: "Reset your password",
    newpassword: "Choose a new password",
  };
  const blurbs: Record<AuthView, string> = {
    signin: "Sign in to build with the agent. Your projects stay in this browser.",
    signup: "One account for the agent, publishing and invites. It costs nothing.",
    forgot: "We will email you a link to choose a new password.",
    newpassword: "Pick a new password for your account.",
  };

  if (sent) {
    return (
      <Modal onClose={onClose}>
        <div className="py-4 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <MailCheck className="h-7 w-7" />
          </span>
          <p className="mt-4 text-[17px] font-semibold text-foreground">Check your email</p>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-6 text-muted-foreground">
            {sent === "confirm"
              ? `We sent a link to ${email}. Open it to confirm your address, and you are in.`
              : `If ${email} has an account, a link to choose a new password is on its way.`}
          </p>
          <button
            onClick={() => {
              setSent(null);
              setView("signin");
            }}
            className="mt-6 text-[13px] text-primary hover:underline"
          >
            Back to sign in
          </button>
        </div>
      </Modal>
    );
  }

  const needsPassword = view !== "forgot";
  const needsEmail = view !== "newpassword";

  return (
    <Modal onClose={onClose}>
      {view === "forgot" && (
        <button
          onClick={() => setView("signin")}
          className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      <div className="flex flex-col items-center pb-2 pt-1 text-center">
        <LogoMark className="h-11 w-11" />
        <p className="mt-3 text-[19px] font-semibold tracking-tight text-foreground">
          {titles[view]}
        </p>
        <p className="mt-1 max-w-xs text-[12.5px] leading-5 text-muted-foreground">
          {blurbs[view]}
        </p>
      </div>

      {!auth.configured ? (
        <p className="mt-4 rounded-xl bg-warning/10 px-4 py-3 text-[12.5px] text-warning">
          Email sign-in is not set up on this deployment yet.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          {needsEmail && (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              required
              className={field}
            />
          )}
          {needsPassword && (
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={view === "signin" ? "Password" : "Password (8 characters or more)"}
                autoComplete={view === "signin" ? "current-password" : "new-password"}
                required
                minLength={view === "signin" ? 1 : 8}
                className={cn(field, "pr-11")}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-meta hover:text-foreground"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          )}
          {view === "signin" && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setView("forgot");
              }}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Forgot your password?
            </button>
          )}
          {error && <p className="text-[12px] leading-5 text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[14px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {view === "signup"
              ? "Create account"
              : view === "signin"
                ? "Sign in"
                : view === "forgot"
                  ? "Send reset link"
                  : "Save new password"}
          </button>
        </form>
      )}

      {(view === "signin" || view === "signup") && (
        <p className="mt-5 text-center text-[12.5px] text-muted-foreground">
          {view === "signin" ? "New to DevStation? " : "Already have an account? "}
          <button
            onClick={() => {
              setError(null);
              setView(view === "signin" ? "signup" : "signin");
            }}
            className="font-medium text-primary hover:underline"
          >
            {view === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      )}
    </Modal>
  );
}
