import { createFileRoute, Outlet, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, ShieldCheck, ChevronDown, Check } from "lucide-react";
import { ChainLogo } from "@/lib/chain-logos";
import { useActiveChain } from "@/hooks/useActiveChain";
import { chainConfig } from "@/lib/chains";
import {
  isNetworkSlug,
  chainIdForSlug,
  networkLabel,
  familyForSlug,
  EXPLORER_NETWORK_OPTIONS,
  DEFAULT_NETWORK_SLUG,
  type NetworkSlug,
} from "@/lib/explorer/network";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/explorer/$network")({
  beforeLoad: ({ params }) => {
    if (!isNetworkSlug(params.network)) {
      throw redirect({ to: "/explorer/$network", params: { network: DEFAULT_NETWORK_SLUG } });
    }
  },
  head: ({ params }) => {
    const slug = (
      isNetworkSlug(params.network) ? params.network : DEFAULT_NETWORK_SLUG
    ) as NetworkSlug;
    return {
      meta: [
        { title: `${familyForSlug(slug).label} Explorer (${networkLabel(slug)}) - DevStation` },
      ],
    };
  },
  component: EvmExplorerLayout,
});

function EvmExplorerLayout() {
  const { network } = Route.useParams();
  const slug = (isNetworkSlug(network) ? network : DEFAULT_NETWORK_SLUG) as NetworkSlug;
  const { select } = useActiveChain();
  const chainId = chainIdForSlug(slug);
  const cfg = chainConfig(chainId);
  const family = familyForSlug(slug);
  const isMainnet = slug === family.mainnetSlug;
  // Keep the app-wide selected chain in sync with the URL being viewed.
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
            <ChainLogo family={family.label} size={18} /> {family.label} Explorer
          </Link>

          {/* Prominent network label so users always know which chain they are on */}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
              isMainnet
                ? "border-info/50 bg-info/10 text-info"
                : "border-warning/50 bg-warning/10 text-warning",
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", isMainnet ? "bg-info" : "bg-warning")}
            />
            {networkLabel(slug)}
          </span>

          <div className="ml-auto flex items-center gap-3">
            <Link
              to="/explorer/$network/verify"
              params={{ network: slug }}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Verify Contract
            </Link>

            <a
              href={cfg.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
              title={`The official ${family.label} explorer this data is sourced from`}
            >
              Data source <ExternalLink className="h-3 w-3" />
            </a>

            {/* Network dropdown: pick any chain + testnet/mainnet combination */}
            <NetworkDropdown slug={slug} />
          </div>
        </div>
      </div>

      <div className="py-4 lg:py-6 px-5 sm:px-8 lg:px-12">
        <Outlet />
      </div>
    </div>
  );
}

// Single dropdown for picking any chain + testnet/mainnet combination the
// explorer supports, e.g. "QIE Testnet", "BOT Chain Mainnet".
function NetworkDropdown({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const options = EXPLORER_NETWORK_OPTIONS.map((o) => ({
    slug: o.slug as string,
    label: o.label,
  }));
  const current = options.find((o) => o.slug === slug);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded border border-border bg-surface px-2.5 py-1.5 font-mono text-[11px] text-foreground transition hover:border-primary/50"
      >
        {current && <ChainLogo family={current.label} size={13} />}
        {current?.label ?? "Select network"}
        <ChevronDown className="h-3 w-3 text-meta" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-72 w-48 overflow-y-auto rounded border border-border bg-surface shadow-lg">
          {options.map((o) => (
            <button
              key={o.slug}
              onClick={() => {
                navigate({ to: "/explorer/$network", params: { network: o.slug } });
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-2 text-left font-mono text-[11px] transition hover:bg-surface-2",
                o.slug === slug ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ChainLogo family={o.label} size={13} />
              <span className="truncate">{o.label}</span>
              {o.slug === slug && <Check className="ml-auto h-3 w-3 text-success" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
