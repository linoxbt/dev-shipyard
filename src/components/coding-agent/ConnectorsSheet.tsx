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
  type ConnectorState,
  type ConnectorId,
} from "@/lib/coding-agent/account-client";
import { Modal } from "./primitives";

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

export function ConnectorsSheet({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<ConnectorState | null>(null);
  const [going, setGoing] = useState<ConnectorId | null>(null);

  const load = () => void fetchConnectors().then(setState);
  useEffect(load, []);

  const remove = async (id: ConnectorId) => {
    const r = await disconnect(id);
    if (!r.ok) return toast.error(r.message);
    load();
  };

  return (
    <Modal onClose={onClose} title="Connected accounts">
      <p className="-mt-1 mb-3 px-1 text-[12.5px] leading-5 text-muted-foreground">
        Connect an account and the agent can work on it for you. You approve access on the
        provider&apos;s own page and can remove it here at any time. DevStation never sees your
        password.
      </p>
      {state && !state.available && (
        <p className="mb-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Connected accounts open soon.
        </p>
      )}
      <div className="space-y-1">
        {PROVIDERS.map((p) => {
          const on = state?.connected.find((c) => c.provider === p.id);
          const ready = !!state?.available && !!state.configured[p.id];
          return (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
            >
              <span
                aria-hidden
                className="inline-flex h-5 w-5 shrink-0 text-foreground [&>svg]:h-full [&>svg]:w-full"
                style={p.color ? { color: p.color } : undefined}
                dangerouslySetInnerHTML={{ __html: p.logo }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-foreground">{p.name}</p>
                <p className="truncate text-[11.5px] text-meta">
                  {on
                    ? `Connected: ${on.label || "yes"}`
                    : state && !ready
                      ? "Coming soon"
                      : p.does}
                </p>
              </div>
              {on ? (
                <button
                  onClick={() => void remove(p.id)}
                  title={`Disconnect ${p.name}`}
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
                  Connect
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
