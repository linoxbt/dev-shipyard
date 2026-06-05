import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TxHashChip } from "@/components/shared/TxHashChip";
import { DEMO_TXS } from "@/lib/mock/transactions";

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
  const navigate = useNavigate();

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
                  placeholder="Paste a QIE Testnet transaction hash... 0x..."
                  className="w-full rounded border border-border bg-background py-3 pl-10 pr-3 font-mono text-sm text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
                />
              </div>
            </label>

            <button
              onClick={submit}
              className="mt-3 w-full rounded bg-primary px-4 py-2.5 font-mono text-sm font-bold text-primary-foreground hover:bg-primary-hover"
            >
              Decode Transaction
            </button>

            <div className="mt-6">
              <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
                Or try a pre-decoded demo
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {DEMO_TXS.map((tx) => (
                  <Link
                    key={tx.hash}
                    to="/routebook/$txHash"
                    params={{ txHash: tx.hash }}
                    className="rounded border border-border bg-background p-3 text-left transition hover:border-primary/40"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          tx.status === "SUCCESS" ? "bg-success" : "bg-danger"
                        }`}
                      />
                      <span className="font-mono text-xs text-foreground">{tx.toName}</span>
                      <span className="ml-auto font-mono text-[10px] text-meta">
                        {tx.status === "SUCCESS" ? "Swap demo" : "Revert demo"}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-meta">
                      <TxHashChip hash={tx.hash} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded border border-border bg-surface p-6 text-center font-mono text-xs text-meta">
            <div className="mb-2 text-2xl">{"{ }"}</div>
            Paste a transaction hash above to render its execution route.
          </div>
        </div>
      </div>
    </div>
  );
}
