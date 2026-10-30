import { useState, type FormEvent } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { LogoMark } from "@/components/shared/Logo";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Modal } from "./primitives";

// Right after an account is made: what to call you, then light or dark.
// Sign-up itself asks only for an email and a password; this comes once you
// are in, and both answers are saved with the account so they follow you.

type Step = "name" | "theme";

export function WelcomeSheet({
  only,
  onClose,
}: {
  /** Ask one thing only (changing your name later from the account sheet). */
  only?: Step;
  onClose: () => void;
}) {
  const account = useAuth((s) => s.account);
  const updateProfile = useAuth((s) => s.updateProfile);
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const [step, setStep] = useState<Step>(only ?? "name");
  const [name, setName] = useState(account?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const problem = await updateProfile({ name });
    setBusy(false);
    if (problem) return setError(problem);
    setError(null);
    if (only) onClose();
    else setStep("theme");
  };

  const finish = async () => {
    setBusy(true);
    const problem = await updateProfile({ theme });
    setBusy(false);
    if (problem) return setError(problem);
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      {!only && (
        <div className="mb-4 flex justify-center gap-1.5">
          {(["name", "theme"] as Step[]).map((s) => (
            <span
              key={s}
              className={cn(
                "h-1.5 rounded-full transition-all",
                s === step ? "w-6 bg-primary" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>
      )}
      <div className="flex flex-col items-center text-center">
        <LogoMark className="h-11 w-11" />
        <p className="mt-3 text-[19px] font-semibold tracking-tight text-foreground">
          {step === "name" ? "What should we call you?" : "Choose your look"}
        </p>
        <p className="mt-1 max-w-xs text-[13px] leading-5 text-muted-foreground">
          {step === "name"
            ? "This is how DevStation greets you, and how builders you invite see you."
            : "Light or dark. You can change it any time from your account."}
        </p>
      </div>

      {step === "name" ? (
        <form onSubmit={saveName} className="mt-5 space-y-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            maxLength={80}
            className="w-full rounded-xl border border-border bg-background px-3.5 py-3 text-[14px] text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
          />
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[14px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {only ? "Save" : "Continue"}
          </button>
        </form>
      ) : (
        <div className="mt-5">
          <div className="grid grid-cols-2 gap-3">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                className={cn(
                  "overflow-hidden rounded-2xl border-2 text-left transition",
                  theme === t ? "border-primary" : "border-border hover:border-primary/40",
                )}
              >
                {/* A small picture of the app in that theme. */}
                <div
                  className={cn("space-y-1.5 p-3", t === "light" ? "bg-[#f6f5f2]" : "bg-[#0f1318]")}
                >
                  <div
                    className={cn(
                      "h-2 w-10 rounded",
                      t === "light" ? "bg-[#1f2328]" : "bg-[#e6e8eb]",
                    )}
                  />
                  <div
                    className={cn(
                      "h-1.5 w-16 rounded",
                      t === "light" ? "bg-[#c9c6bf]" : "bg-[#3a414a]",
                    )}
                  />
                  <div
                    className={cn(
                      "mt-2 h-8 rounded-lg border",
                      t === "light" ? "border-[#e2dfd8] bg-white" : "border-[#262c34] bg-[#161b22]",
                    )}
                  />
                  <div className="flex justify-end">
                    <div className="h-3 w-6 rounded-full bg-[#e67e22]" />
                  </div>
                </div>
                <div className="flex items-center justify-between bg-surface px-3 py-2">
                  <span className="text-[13px] font-medium capitalize text-foreground">{t}</span>
                  {theme === t && <Check className="h-4 w-4 text-primary" />}
                </div>
              </button>
            ))}
          </div>
          {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
          <button
            onClick={() => void finish()}
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[14px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {only ? "Save" : "Start building"}
          </button>
        </div>
      )}
    </Modal>
  );
}
