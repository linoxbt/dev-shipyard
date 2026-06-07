import { createFileRoute } from "@tanstack/react-router";
import { Compass, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";
import { useActiveChain } from "@/hooks/useActiveChain";
import { qieTestnet, qieMainnet } from "@/lib/chains";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/explorer")({
  head: () => ({ meta: [{ title: "QIE Explorer — DevStation" }] }),
  component: ExplorerPage,
});

function ExplorerPage() {
  const { chain, config, select } = useActiveChain();

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "QIE Explorer"]}
        title="QIE Explorer"
        subtitle="Browse blocks, transactions, addresses, and tokens on QIE."
      />
      <div className="space-y-6 p-6">
        {/* Network switch — drives the app-wide selected network */}
        <div className="inline-flex rounded border border-border bg-surface p-0.5">
          {[qieTestnet, qieMainnet].map((c) => {
            const active = chain.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => select(c.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs transition",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", c.testnet ? "bg-warning" : "bg-info")}
                />
                {c.testnet ? "Testnet" : "Mainnet"}
              </button>
            );
          })}
        </div>

        <ComingSoon
          icon={Compass}
          title="QIE Explorer is coming soon"
          note={`A native block & transaction explorer for ${chain.name} — search blocks, addresses, and tokens without leaving DevStation. In the meantime, use the official QIE explorer.`}
        >
          <a
            href={config.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-primary px-3 py-1.5 font-mono text-xs text-primary hover:bg-primary/10"
          >
            Open {chain.name} Explorer <ExternalLink className="h-3 w-3" />
          </a>
        </ComingSoon>
      </div>
    </div>
  );
}
