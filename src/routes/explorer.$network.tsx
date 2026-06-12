import { createFileRoute, Outlet, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Compass, ExternalLink, ShieldCheck } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { chainConfig } from "@/lib/chains";
import {
  isNetworkSlug,
  chainIdForSlug,
  networkLabel,
  type NetworkSlug,
} from "@/lib/explorer/network";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/explorer/$network")({
  beforeLoad: ({ params }) => {
    if (!isNetworkSlug(params.network)) {
      throw redirect({ to: "/explorer/$network", params: { network: "testnet" } });
    }
  },
  head: ({ params }) => ({
    meta: [
      {
        title: `QIE Explorer (${networkLabel((params.network as NetworkSlug) ?? "testnet")}) - DevStation`,
      },
    ],
  }),
  component: ExplorerNetworkLayout,
});

function ExplorerNetworkLayout() {
  const { network } = Route.useParams();
  const slug = (isNetworkSlug(network) ? network : "testnet") as NetworkSlug;
  const navigate = useNavigate();
  const { select } = useActiveChain();
  const chainId = chainIdForSlug(slug);
  const cfg = chainConfig(chainId);

  // Keep the app-wide selected chain in sync with the URL the user is viewing.
  useEffect(() => {
    select(chainId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);

  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <Link
            to="/explorer/$network"
            params={{ network: slug }}
            className="flex items-center gap-2 font-mono text-sm font-bold text-foreground"
          >
            <Compass className="h-4 w-4 text-primary" /> QIE Explorer
          </Link>

          {/* Prominent network label so users always know which chain they are on */}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
              slug === "mainnet"
                ? "border-info/50 bg-info/10 text-info"
                : "border-warning/50 bg-warning/10 text-warning",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                slug === "mainnet" ? "bg-info" : "bg-warning",
              )}
            />
            {networkLabel(slug)}
          </span>

          {/* Network switch — navigates to the same kind of page on the other chain */}
          <div className="inline-flex rounded border border-border bg-surface p-0.5">
            {(["testnet", "mainnet"] as NetworkSlug[]).map((n) => (
              <button
                key={n}
                onClick={() => navigate({ to: "/explorer/$network", params: { network: n } })}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-[11px] transition",
                  slug === n
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {networkLabel(n)}
              </button>
            ))}
          </div>

          <Link
            to="/explorer/$network/verify"
            params={{ network: slug }}
            className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Verify Contract
          </Link>

          <a
            href={cfg.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
            title="The official QIE explorer this data is sourced from"
          >
            Data source <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="p-4 lg:p-6">
        <Outlet />
      </div>
    </div>
  );
}
