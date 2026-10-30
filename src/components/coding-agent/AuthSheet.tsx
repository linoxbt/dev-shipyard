import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { LogoMark } from "@/components/shared/Logo";
import { useAuth } from "@/hooks/useAuth";
import { Modal } from "./primitives";

// Sign in, or make an account, with no password: your email, then the code
// we send to it. The same two steps work the first time and every time after.

type Step = "email" | "code";

/** Supabase lets a project send codes of 6 to 10 digits. */
const CODE_MIN = 6;
const CODE_MAX = 10;
/** Supabase sends at most one code a minute to the same address. */
const RESEND_AFTER = 60;

const field =
  "w-full rounded-xl border border-border bg-background px-3.5 py-3 text-[14px] text-foreground placeholder:text-meta focus:border-primary focus:outline-none";

export function AuthSheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setBusy(true);
    setError(null);
    const problem = await auth.sendCode(email.trim());
    setBusy(false);
    if (problem) return setError(problem);
    setCode("");
    setStep("code");
    setWait(RESEND_AFTER);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (step === "email") return send();
    setBusy(true);
    setError(null);
    const problem = await auth.verifyCode(email.trim(), code);
    setBusy(false);
    if (problem) return setError(problem);
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      {step === "code" && (
        <button
          onClick={() => {
            setError(null);
            setStep("email");
          }}
          className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Use a different email
        </button>
      )}
      <div className="flex flex-col items-center pb-2 pt-1 text-center">
        <LogoMark className="h-11 w-11" />
        <p className="mt-3 text-[19px] font-semibold tracking-tight text-foreground">
          {step === "email" ? "Sign in to DevStation" : "Check your email"}
        </p>
        <p className="mt-1 max-w-xs text-[12.5px] leading-5 text-muted-foreground">
          {step === "email" ? (
            "Enter your email and we will send you a code. New here? The same code makes your account."
          ) : (
            <>
              We sent a code to <span className="font-medium text-foreground">{email.trim()}</span>.
              Enter it below.
            </>
          )}
        </p>
      </div>

      {!auth.configured ? (
        <p className="mt-4 rounded-xl bg-warning/10 px-4 py-3 text-[12.5px] text-warning">
          Email sign-in is not set up on this deployment yet.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          {step === "email" ? (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              autoFocus
              required
              className={field}
            />
          ) : (
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_MAX))}
              placeholder="Code"
              aria-label="Code from the email"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              className={`${field} text-center font-mono text-[20px] tracking-[0.4em] placeholder:font-sans placeholder:text-[14px] placeholder:tracking-normal`}
            />
          )}
          {error && <p className="text-[12px] leading-5 text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy || (step === "code" && code.length < CODE_MIN)}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[14px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {step === "email" ? "Send code" : "Continue"}
          </button>
        </form>
      )}

      {step === "code" && (
        <p className="mt-5 text-center text-[12.5px] text-muted-foreground">
          Nothing yet? Check your spam folder, or{" "}
          {wait > 0 ? (
            <span className="text-meta">send a new code in {wait}s</span>
          ) : (
            <button
              onClick={() => void send()}
              disabled={busy}
              className="font-medium text-primary hover:underline"
            >
              send a new code
            </button>
          )}
        </p>
      )}
    </Modal>
  );
}
