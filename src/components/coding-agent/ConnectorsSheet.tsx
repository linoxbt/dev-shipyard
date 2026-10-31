import { useEffect, useState, type FormEvent } from "react";
import {
  Database,
  ExternalLink,
  Github,
  Globe,
  LoaderCircle,
  Plug,
  TrainFront,
  Triangle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  connect,
  disconnect,
  fetchConnectors,
  type Connected,
  type ConnectorId,
} from "@/lib/coding-agent/account-client";
import { Modal } from "./primitives";

// Accounts the agent may act as. Each is a token the person creates with the
// provider; it is checked with the provider, kept encrypted on DevStation's
// server, and handed to the agent's sandbox for each message, so the agent can
// push to GitHub, deploy to Vercel or Netlify, run Railway services or manage
// Supabase projects as the person would.

const PROVIDERS: {
  id: ConnectorId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  tokenUrl: string;
  hint: string;
}[] = [
  {
    id: "github",
    name: "GitHub",
    icon: Github,
    tokenUrl: "https://github.com/settings/personal-access-tokens/new",
    hint: "A fine-grained token with the repositories and permissions you want the agent to have.",
  },
  {
    id: "vercel",
    name: "Vercel",
    icon: Triangle,
    tokenUrl: "https://vercel.com/account/settings/tokens",
    hint: "A token scoped to the team the agent should deploy to.",
  },
  {
    id: "netlify",
    name: "Netlify",
    icon: Globe,
    tokenUrl: "https://app.netlify.com/user/applications#personal-access-tokens",
    hint: "A personal access token.",
  },
  {
    id: "railway",
    name: "Railway",
    icon: TrainFront,
    tokenUrl: "https://railway.com/account/tokens",
    hint: "An account token (or a team token for one workspace).",
  },
  {
    id: "supabase",
    name: "Supabase",
    icon: Database,
    tokenUrl: "https://supabase.com/dashboard/account/tokens",
    hint: "An access token for the Supabase Management API.",
  },
];

export function ConnectorsSheet({ onClose }: { onClose: () => void }) {
  const [connected, setConnected] = useState<Connected[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [open, setOpen] = useState<ConnectorId | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    void fetchConnectors().then((r) => {
      setConnected(r.connected);
      setAvailable(r.available);
    });
  useEffect(load, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!open || !token.trim()) return;
    setBusy(true);
    const r = await connect(open, token.trim());
    setBusy(false);
    if (!r.ok) return toast.error(r.message);
    toast.success(`Connected as ${r.data.label}.`);
    setToken("");
    setOpen(null);
    load();
  };

  const remove = async (id: ConnectorId) => {
    const r = await disconnect(id);
    if (!r.ok) return toast.error(r.message);
    load();
  };

  return (
    <Modal onClose={onClose} title="Connected accounts">
      <p className="-mt-1 mb-3 px-1 text-[12.5px] leading-5 text-muted-foreground">
        The agent uses these to work on your accounts: push to your repositories, deploy, run
        services and manage databases, with the permissions each token has. Tokens are kept
        encrypted and never shown again.
      </p>
      {!available && (
        <p className="mb-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Connected accounts open soon.
        </p>
      )}
      <div className="space-y-1">
        {PROVIDERS.map((p) => {
          const on = connected?.find((c) => c.provider === p.id);
          const Icon = p.icon;
          return (
            <div key={p.id} className="rounded-xl border border-border">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Icon className="h-5 w-5 shrink-0 text-foreground/80" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-foreground">{p.name}</p>
                  <p className="truncate text-[11.5px] text-meta">
                    {on ? `Connected: ${on.label ?? "yes"}` : "Not connected"}
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
                      setOpen(open === p.id ? null : p.id);
                      setToken("");
                    }}
                    disabled={!available}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground hover:border-primary/50 disabled:opacity-50"
                  >
                    <Plug className="h-3.5 w-3.5" /> Connect
                  </button>
                )}
              </div>
              {open === p.id && (
                <form onSubmit={save} className="space-y-2 border-t border-border px-3 py-3">
                  <p className="text-[11.5px] leading-5 text-muted-foreground">
                    {p.hint}{" "}
                    <a
                      href={p.tokenUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-0.5 text-primary hover:underline"
                    >
                      Create one <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={`${p.name} token`}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] text-foreground placeholder:font-sans placeholder:text-meta focus:border-primary focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy || !token.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                  >
                    {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    Check and connect
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
