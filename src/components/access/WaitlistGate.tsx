import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Clock, LoaderCircle, LogOut } from "lucide-react";
import { LogoMark } from "@/components/shared/Logo";
import { useAuth } from "@/hooks/useAuth";
import { ensureGrant } from "@/lib/agent-access/grant";

// What someone sees after signing in while DevStation is closed or full: their
// place on the waitlist, instead of the app. The page asks again every minute
// (and on demand), so it opens by itself the moment an admin lets them in.

const RECHECK_MS = 60_000;

/** Pages anyone can read, waitlisted or not. */
const OPEN_PAGES = /^\/(docs|cookies|stats\/shared)(\/|$)/;

export function WaitlistGate() {
  const waitlist = useAuth((s) => s.waitlist);
  const signOut = useAuth((s) => s.signOut);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => useAuth.getState().init(), []);

  const check = async () => {
    setChecking(true);
    await ensureGrant();
    setChecking(false);
    setCheckedAt(Date.now());
  };

  useEffect(() => {
    if (!waitlist) return;
    const t = setInterval(
      () => void ensureGrant().then(() => setCheckedAt(Date.now())),
      RECHECK_MS,
    );
    const onFocus = () => void ensureGrant();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [waitlist]);

  if (!waitlist || OPEN_PAGES.test(pathname)) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-background px-4 py-10"
      role="dialog"
      aria-modal
      aria-labelledby="waitlist-title"
    >
      <div className="w-full max-w-md text-center">
        <LogoMark className="mx-auto h-11 w-11" />
        <h1 id="waitlist-title" className="mt-6 text-[26px] font-semibold tracking-tight">
          You&apos;re on the waitlist
        </h1>
        <p className="mt-3 text-[15.5px] leading-7 text-muted-foreground">
          DevStation is letting people in a few at a time. Your place is saved, and this page opens
          the app by itself as soon as you&apos;re in.
        </p>

        <div className="mt-7 rounded-2xl border border-border bg-surface px-5 py-5">
          <p className="text-[12.5px] font-medium uppercase tracking-wider text-meta">
            Your place in line
          </p>
          <p className="mt-1 text-[44px] font-semibold tabular-nums leading-none">
            {waitlist.place}
          </p>
          {waitlist.email && (
            <p className="mt-3 text-[13.5px] text-muted-foreground">
              Signed in as <span className="text-foreground">{waitlist.email}</span>
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            onClick={() => void check()}
            disabled={checking}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-70"
          >
            {checking ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Clock className="h-4 w-4" />
            )}
            Check again
          </button>
          {checkedAt && !checking && (
            <p className="text-[12.5px] text-meta">
              Still waiting. Checked at{" "}
              {new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
            </p>
          )}
          <button
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
