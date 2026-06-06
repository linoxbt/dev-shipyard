import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TxHashChip } from "@/components/shared/TxHashChip";
import { storage } from "@/lib/storage";

export const Route = createFileRoute("/routebook/")({
  head: () => ({
    meta: [
      { title: "Routebook — DevStation" },
      {
        name: "description",
        content: "Turn any QIE transaction hash into a human-readable execution map.",
      },
    ],
  }),
  component: RoutebookHome,
});

function RoutebookHome() {
  const [hash, setHash] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => setRecent(storage.loadInspections()), []);

  const submit = () => {
    if (!hash.trim()) return;
    navigate({ to: "/routebook/$txHash", params: { txHash: hash.trim() } });
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Routebook"]}
        title="Routebook — Transaction Inspector"
        subtitle="Turn any QIE transaction into a readable execution map."
      />
      <div className="p-6">
        <div className="mx-auto max-w-3xl">
          <div className="rounded border border-border bg-surface p-6">
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Transaction Hash
              </span>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" />
                <input
                  value={hash}
                  onChange={(e) => setHash(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Paste a QIE transaction hash... 0x..."
                  className="w-full rounded border border-border bg-background py-3 pl-10 pr-3 font-mono text-sm text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
                />
              </div>
            </label>

            <button
              onClick={submit}
              disabled={!hash.trim()}
              className="mt-3 w-full rounded bg-primary px-4 py-2.5 font-mono text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              Decode Transaction
            </button>

            {recent.length > 0 && (
              <div className="mt-6">
                <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
                  Recent inspections
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {recent.map((h) => (
                    <Link
                      key={h}
                      to="/routebook/$txHash"
                      params={{ txHash: h }}
                      className="rounded border border-border bg-background p-3 text-left transition hover:border-primary/40"
                    >
                      <TxHashChip hash={h} />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 rounded border border-border bg-surface p-6 text-center font-mono text-xs text-meta">
            <div className="mb-2 text-2xl">{"{ }"}</div>
            Paste any QIE Testnet or Mainnet transaction hash above to decode its execution route,
            token movements, and approvals — live from the chain.
          </div>
        </div>
      </div>
    </div>
  );
}
