import { useCallback, useEffect, useState } from "react";
import { Check, Github, Loader2, Mail, Unlink } from "lucide-react";
import { toast } from "sonner";
import { fetchWithGrant } from "@/lib/agent-access/grant";

// What this wallet is linked to: one GitHub account, one verified email.
//
// Owner-only, and it says so by living behind the dashboard's `owner` flag: the
// same component renders the public profile at /dev/$address, where somebody
// else's email is nobody's business. The server enforces the same thing — every
// read here is for the wallet that signed, whatever address the page shows.

interface Account {
  wallet: string;
  github: { id: number; login: string; linkedAt: number } | null;
  email: { address: string; verifiedAt: number } | null;
  pendingEmail: string | null;
}

interface GithubStatus {
  configured: boolean;
  user: { login: string } | null;
  link?: { linked: boolean; linkedLogin: string | null; mismatch: boolean };
}

/** Enough of an address to recognise, not enough to harvest. */
function maskEmail(address: string): string {
  const [name, domain] = address.split("@");
  if (!domain) return address;
  const head = name.slice(0, 2);
  return `${head}${name.length > 2 ? "…" : ""}@${domain}`;
}

export function AccountPanel({ returnTo = "/activity" }: { returnTo?: string }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [mailReady, setMailReady] = useState(true);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const read = useCallback(async () => {
    const [mine, gh] = await Promise.all([
      fetchWithGrant("/api/account").catch(() => null),
      fetch("/api/github").catch(() => null),
    ]);
    const body = (await mine?.json().catch(() => null)) as {
      ok?: boolean;
      account?: Account;
      mailConfigured?: boolean;
    } | null;
    if (body?.ok && body.account) {
      setAccount(body.account);
      setMailReady(body.mailConfigured !== false);
    }
    setGithub(((await gh?.json().catch(() => null)) as GithubStatus | null) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const act = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    const res = await fetchWithGrant("/api/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      account?: Account;
      message?: string;
    } | null;
    setBusy(null);
    if (!data?.ok) {
      toast.error(data?.message ?? "That did not work.");
      return false;
    }
    if (data.account) setAccount(data.account);
    return true;
  };

  const sendCode = async () => {
    if (await act("send", { action: "email_start", email: email.trim() })) {
      toast.success("Code sent. It expires in 10 minutes.");
      setCode("");
    }
  };

  const verify = async () => {
    if (await act("verify", { action: "email_verify", code: code.trim() })) {
      toast.success("Email verified.");
      setCode("");
      setEmail("");
    }
  };

  const unlinkGithub = async () => {
    if (await act("github", { action: "unlink_github" })) {
      toast.success("GitHub unlinked. You can connect a different account now.");
      void read();
    }
  };

  const linkedLogin = account?.github?.login ?? null;
  const signedInAs = github?.user?.login ?? null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-foreground">
        <Check className="h-3.5 w-3.5 text-primary" /> Your account
      </h2>

      {loading ? (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-meta">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading your links…
        </p>
      ) : (
        <div className="space-y-4">
          {/* GitHub */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex w-24 shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
              <Github className="h-3 w-3" /> GitHub
            </span>
            {linkedLogin ? (
              <>
                <a
                  href={`https://github.com/${linkedLogin}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-foreground hover:underline"
                >
                  @{linkedLogin}
                </a>
                <button
                  onClick={() => void unlinkGithub()}
                  disabled={busy === "github"}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-danger hover:text-danger disabled:opacity-40"
                >
                  <Unlink className="h-3 w-3" /> Unlink
                </button>
              </>
            ) : github?.configured === false ? (
              <span className="font-mono text-[11px] text-meta">
                GitHub sign-in is not set up on this deployment.
              </span>
            ) : (
              <a
                href={`/api/github?start=1&return=${encodeURIComponent(returnTo)}`}
                className="rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-primary"
              >
                Connect GitHub
              </a>
            )}
          </div>
          {signedInAs && signedInAs !== linkedLogin && (
            <p className="font-mono text-[10px] text-warning">
              This browser is signed in to @{signedInAs}, which is not linked to this wallet.
              {linkedLogin
                ? ` Pushes use @${linkedLogin}.`
                : " Connect GitHub to link it to this wallet."}
            </p>
          )}

          {/* Email */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex w-24 shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
              <Mail className="h-3 w-3" /> Email
            </span>
            {account?.email ? (
              <>
                <span className="inline-flex items-center gap-1 font-mono text-xs text-foreground">
                  <Check className="h-3 w-3 text-success" /> {maskEmail(account.email.address)}
                </span>
                <button
                  onClick={() => void act("email", { action: "unlink_email" })}
                  disabled={busy === "email"}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-danger hover:text-danger disabled:opacity-40"
                >
                  <Unlink className="h-3 w-3" /> Remove
                </button>
              </>
            ) : !mailReady ? (
              <span className="font-mono text-[11px] text-meta">
                Email verification is not set up on this deployment yet.
              </span>
            ) : account?.pendingEmail ? (
              <>
                <span className="font-mono text-[11px] text-muted-foreground">
                  Code sent to {account.pendingEmail}
                </span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  placeholder="6-digit code"
                  aria-label="Verification code"
                  className="w-28 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                />
                <button
                  onClick={() => void verify()}
                  disabled={busy !== null || code.length < 6}
                  className="rounded bg-primary px-2.5 py-1 font-mono text-[10px] font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {busy === "verify" ? "Checking…" : "Verify"}
                </button>
                <button
                  onClick={() =>
                    void act("send", { action: "email_start", email: account.pendingEmail ?? "" })
                  }
                  disabled={busy !== null}
                  className="font-mono text-[10px] text-meta hover:text-foreground disabled:opacity-40"
                >
                  Resend
                </button>
              </>
            ) : (
              <>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="you@example.com"
                  aria-label="Email address"
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                />
                <button
                  onClick={() => void sendCode()}
                  disabled={busy !== null || !email.includes("@")}
                  className="rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  {busy === "send" ? "Sending…" : "Send code"}
                </button>
              </>
            )}
          </div>

          <p className="font-mono text-[10px] leading-4 text-meta">
            One GitHub account per wallet, and one wallet per GitHub account. Your email is only
            ever shown to you.
          </p>
        </div>
      )}
    </section>
  );
}
