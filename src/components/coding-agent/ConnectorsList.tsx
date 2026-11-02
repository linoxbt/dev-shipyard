import { useEffect, useState } from "react";
import { LoaderCircle, Plug, X } from "lucide-react";
import githubLogo from "@/assets/connector-logos/github.svg?raw";
import netlifyLogo from "@/assets/connector-logos/netlify.svg?raw";
import railwayLogo from "@/assets/connector-logos/railway.svg?raw";
import supabaseLogo from "@/assets/connector-logos/supabase.svg?raw";
import vercelLogo from "@/assets/connector-logos/vercel.svg?raw";
import { toast } from "sonner";
import {
  connect,
  disconnect,
  fetchConnectors,
  providerName,
  type ConnectorState,
  type ConnectorId,
} from "@/lib/coding-agent/account-client";

// Accounts the agent may act as. Connecting one goes to the provider to
// approve access (OAuth) and comes back; the grant is kept encrypted on
// DevStation's server and handed to the agent's sandbox for each message, so
// the agent can push to GitHub, deploy to Vercel or Netlify, run Railway
// services or manage Supabase projects as the person would.

const PROVIDERS: {
  id: ConnectorId;
  name: string;
  /** Bundled SVG text (Simple Icons), drawn in the brand colour when it has one. */
  logo: string;
  color?: string;
  /** What the agent can do with it, in a few words. */
  does: string;
}[] = [
  {
    id: "github",
    does: "Create repositories, push code, open pull requests",
    name: "GitHub",
    logo: githubLogo,
  },
  {
    id: "vercel",
    does: "Deploy projects, set environment variables and domains",
    name: "Vercel",
    logo: vercelLogo,
  },
  {
    id: "netlify",
    does: "Deploy sites and manage their settings",
    name: "Netlify",
    logo: netlifyLogo,
    color: "#00C7B7",
  },
  {
    id: "railway",
    does: "Deploy services and databases",
    name: "Railway",
    logo: railwayLogo,
  },
  {
    id: "supabase",
    does: "Create projects, run migrations, manage databases",
    name: "Supabase",
    logo: supabaseLogo,
    color: "#3FCF8E",
  },
];

/** The accounts, each with its state and a button to connect or remove it. */
export function ConnectorsList() {
  const [state, setState] = useState<ConnectorState | null>(null);
  const [going, setGoing] = useState<ConnectorId | null>(null);
  const [confirming, setConfirming] = useState<ConnectorId | null>(null);
  const [removing, setRemoving] = useState<ConnectorId | null>(null);

  const load = () => void fetchConnectors().then(setState);
  useEffect(load, []);

  const remove = async (id: ConnectorId) => {
    setRemoving(id);
    const r = await disconnect(id);
    setRemoving(null);
    setConfirming(null);
    if (!r.ok) return toast.error(r.message);
    toast.success(`${providerName(id)} is disconnected. The agent can no longer use it.`);
    load();
  };

  return (
    <>
      {state && !state.available && (
        <p className="mb-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Connected accounts open soon.
        </p>
      )}
      {!state && (
        <p className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading your accounts
        </p>
      )}
      <div className="space-y-2">
        {PROVIDERS.map((p) => {
          const on = state?.connected.find((c) => c.provider === p.id);
          const ready = !!state?.available && !!state.configured[p.id];
          return (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5"
            >
              <span
                aria-hidden
                className="inline-flex h-6 w-6 shrink-0 text-foreground [&>svg]:h-full [&>svg]:w-full"
                style={p.color ? { color: p.color } : undefined}
                dangerouslySetInnerHTML={{ __html: p.logo }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-medium text-foreground">{p.name}</p>
                <p
                  className={
                    on?.needsReconnect
                      ? "truncate text-[11.5px] text-warning"
                      : "truncate text-[11.5px] text-meta"
                  }
                >
                  {on
                    ? on.needsReconnect
                      ? `${on.label || p.name}: no longer accepted. Connect again.`
                      : `Connected: ${on.label || "yes"}`
                    : state && !ready
                      ? "Coming soon"
                      : p.does}
                </p>
              </div>
              {on && confirming === p.id ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setConfirming(null)}
                    className="rounded-full px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                  >
                    Keep
                  </button>
                  <button
                    onClick={() => void remove(p.id)}
                    disabled={removing === p.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-danger px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
                  >
                    {removing === p.id && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    Disconnect
                  </button>
                </div>
              ) : on && !on.needsReconnect ? (
                <button
                  onClick={() => setConfirming(p.id)}
                  title={`Disconnect ${p.name}`}
                  aria-label={`Disconnect ${p.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-meta hover:bg-surface-2 hover:text-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={() => {
                    setGoing(p.id);
                    connect(p.id);
                  }}
                  disabled={!ready || going !== null}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground hover:border-primary/50 disabled:opacity-50"
                >
                  {going === p.id ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plug className="h-3.5 w-3.5" />
                  )}
                  {on?.needsReconnect ? "Reconnect" : "Connect"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
