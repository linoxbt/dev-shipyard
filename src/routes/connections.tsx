import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConnectorsList } from "@/components/coding-agent/ConnectorsList";
import { PageShell } from "@/components/coding-agent/PageShell";
import { AuthSheet } from "@/components/coding-agent/AuthSheet";
import { useAuth } from "@/hooks/useAuth";
import { connectError, providerName } from "@/lib/coding-agent/account-client";

// Connected accounts, as a page: the accounts the agent may act as, each
// connected through the provider's own approval page (OAuth) and removable
// here. Connecting comes back to this page and says how it went.

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [{ title: "Connected accounts · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const ready = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    useAuth.getState().init();
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const failed = params.get("connect_error");
    if (!connected && !failed) return;
    const provider = params.get("provider");
    for (const k of ["connected", "connect_error", "provider"]) params.delete(k);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    if (connected)
      toast.success(`${providerName(connected)} is connected. The agent can use it now.`);
    else toast.error(connectError(failed!, provider));
  }, []);

  return (
    <PageShell
      title="Connected accounts"
      description="Connect an account and the agent can work on it for you: push to your repositories, deploy, manage databases. You approve access on the provider's own page and can remove it here at any time. DevStation never sees your password."
    >
      {!ready ? null : signedIn ? (
        <ConnectorsList />
      ) : (
        // Signed out there is nothing to list: asking would only fail.
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <p className="text-[14.5px]">Sign in with your email to connect your accounts.</p>
          <button
            onClick={() => setSigningIn(true)}
            className="mt-4 rounded-full bg-primary px-5 py-2 text-[14px] font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Sign in
          </button>
          {signingIn && <AuthSheet onClose={() => setSigningIn(false)} />}
        </div>
      )}
      <p className="mt-6 text-[12.5px] leading-5 text-meta">
        In a project you share with other builders, the agent does not use your connected accounts:
        their access never goes into a machine someone else can work in.
      </p>
    </PageShell>
  );
}
