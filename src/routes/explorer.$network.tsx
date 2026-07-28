import {
  createFileRoute,
  Outlet,
  Link,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
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
  isLimitedExplorerSlug,
  EXPLORER_NETWORK_OPTIONS,
  DEFAULT_NETWORK_SLUG,
  type NetworkSlug,
} from "@/lib/explorer/network";
import { cn } from "@/lib/utils";
import { LimitedExplorer } from "@/components/explorer/LimitedExplorer";
import { isSolanaSlug } from "@/lib/chain-family";
import { solanaChain, SOLANA_CHAINS, type SolanaCluster } from "@/lib/solana/chains";
import { SolanaExplorerNav } from "@/components/solana/explorer/SolanaExplorerNav";
import { isStacksNetwork, STACKS_CHAINS, stacksChain, type StacksNetworkId } from "@/lib/stacks/chains";
import { StacksExplorerNav } from "@/components/stacks/explorer/StacksExplorerNav";
import { useActiveFamily } from "@/lib/active-network";
import { useSolanaPref } from "@/lib/solana/active-solana";
import { useStacksPref } from "@/lib/stacks/active-stacks";

export const Route = createFileRoute("/explorer/$network")({
  beforeLoad: ({ params }) => {
    if (
      !isNetworkSlug(params.network) &&
      !isSolanaSlug(params.network) &&
      !isStacksNetwork(params.network)
    ) {
      throw redirect({ to: "/explorer/$network", params: { network: DEFAULT_NETWORK_SLUG } });
    }
  },
  head: ({ params }) => {
    if (isSolanaSlug(params.network)) {
      const net = params.network === "solana-mainnet" ? "Mainnet" : "Devnet";
      return { meta: [{ title: `Solana Explorer (${net}) - DevStation` }] };
    }
    if (isStacksNetwork(params.network)) {
      const net = params.network === "stacks-mainnet" ? "Mainnet" : "Testnet";
      return { meta: [{ title: `Stacks Explorer (${net}) - DevStation` }] };
    }
    const slug = (
      isNetworkSlug(params.network) ? params.network : DEFAULT_NETWORK_SLUG
    ) as NetworkSlug;
    return {
      meta: [
        { title: `${familyForSlug(slug).label} Explorer (${networkLabel(slug)}) - DevStation` },
      ],
    };
  },
  component: ExplorerNetworkLayout,
});

// Dispatcher: only reads the route param, then delegates to a family-specific
// layout so each keeps a stable hook order (an EVM↔Solana switch remounts the
// child, never changes a single component's hook sequence).
function ExplorerNetworkLayout() {
  const { network } = Route.useParams();
  if (isSolanaSlug(network)) return <SolanaExplorerLayout cluster={network as SolanaCluster} />;
  if (isStacksNetwork(network)) return <StacksExplorerLayout network={network as StacksNetworkId} />;
  return <EvmExplorerLayout />;
}

function EvmExplorerLayout() {
  const { network } = Route.useParams();
  const slug = (isNetworkSlug(network) ? network : DEFAULT_NETWORK_SLUG) as NetworkSlug;
  const { select } = useActiveChain();
  const setFamily = useActiveFamily((s) => s.setFamily);
  const chainId = chainIdForSlug(slug);
  const cfg = chainConfig(chainId);
  const family = familyForSlug(slug);
  const isMainnet = slug === family.mainnetSlug;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The verify form doesn't depend on Blockscout/Routescan browsing data (it
  // just submits to Sourcify for limited-explorer chains), so it stays
  // reachable even on chains whose block/tx/address dashboard is limited.
  const isVerifyRoute = pathname.endsWith("/verify");

  // Keep the app-wide selected chain + family in sync with the URL being viewed.
  useEffect(() => {
    select(chainId);
    setFamily("evm");
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

            {/* Network dropdown — pick any chain + testnet/mainnet combination */}
            <NetworkDropdown slug={slug} />
          </div>
        </div>
      </div>

      <div className="p-4 lg:p-6">
        {isLimitedExplorerSlug(slug) && !isVerifyRoute ? (
          <LimitedExplorer chainId={chainId} familyLabel={family.label} isMainnet={isMainnet} />
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  );
}

// Single dropdown for picking any chain + testnet/mainnet combination the
// explorer supports across BOTH families, e.g. "QIE Testnet", "BOT Chain
// Mainnet", "Solana Devnet".
const SOLANA_OPTIONS = SOLANA_CHAINS.map((c) => ({ slug: c.id as string, label: c.name }));
const STACKS_OPTIONS = STACKS_CHAINS.map((c) => ({ slug: c.id as string, label: c.name }));

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

  const evmOptions = EXPLORER_NETWORK_OPTIONS.map((o) => ({ slug: o.slug as string, label: o.label }));
  const groups: Array<{ heading: string; options: Array<{ slug: string; label: string }> }> = [
    { heading: "EVM", options: evmOptions },
    { heading: "Solana", options: SOLANA_OPTIONS },
    { heading: "Stacks", options: STACKS_OPTIONS },
  ];
  const current = [...evmOptions, ...SOLANA_OPTIONS, ...STACKS_OPTIONS].find((o) => o.slug === slug);

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
          {groups.map((g) => (
            <div key={g.heading}>
              <div className="px-2.5 pb-1 pt-2 font-mono text-[9px] uppercase tracking-wider text-meta">
                {g.heading}
              </div>
              {g.options.map((o) => (
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
          ))}
        </div>
      )}
    </div>
  );
}

// Solana explorer header + body. Mirrors the EVM layout's header shell but with
// Solana specifics (cluster label, Solana data-source link, no Sourcify verify).
function SolanaExplorerLayout({ cluster }: { cluster: SolanaCluster }) {
  const chain = solanaChain(cluster);
  const isMainnet = !chain.testnet;
  const setFamily = useActiveFamily((s) => s.setFamily);
  const setCluster = useSolanaPref((s) => s.setCluster);

  // Viewing the Solana explorer makes Solana the active family + cluster, so the
  // rest of the app (feature pages, sidebar wallet) follows.
  useEffect(() => {
    setFamily("solana");
    setCluster(cluster);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster]);

  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <Link
            to="/explorer/$network"
            params={{ network: cluster }}
            className="flex items-center gap-2 font-mono text-sm font-bold text-foreground"
          >
            <ChainLogo family="Solana" size={18} /> Solana Explorer
          </Link>

          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
              isMainnet
                ? "border-info/50 bg-info/10 text-info"
                : "border-warning/50 bg-warning/10 text-warning",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", isMainnet ? "bg-info" : "bg-warning")} />
            {isMainnet ? "Mainnet Beta" : "Devnet"}
          </span>

          <div className="ml-auto flex items-center gap-3">
            <a
              href={`${chain.explorerUrl}${chain.explorerClusterParam}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
              title="The public Solana explorer this data is sourced from"
            >
              Data source <ExternalLink className="h-3 w-3" />
            </a>
            <NetworkDropdown slug={cluster} />
          </div>
        </div>
        <SolanaExplorerNav cluster={cluster} />
      </div>

      <div className="p-4 lg:p-6">
        <Outlet />
      </div>
    </div>
  );
}

// Stacks explorer layout + body. Renders the Post-Condition-aware Stacks explorer
// directly (no sub-routes) — Hiro-API sourced, with the coverage audit.
function StacksExplorerLayout({ network }: { network: StacksNetworkId }) {
  const chain = stacksChain(network);
  const isMainnet = !chain.testnet;
  const setFamily = useActiveFamily((s) => s.setFamily);
  const setNetwork = useStacksPref((s) => s.setNetwork);

  useEffect(() => {
    setFamily("stacks");
    setNetwork(network);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <Link
            to="/explorer/$network"
            params={{ network }}
            className="flex items-center gap-2 font-mono text-sm font-bold text-foreground"
          >
            <ChainLogo family="Stacks" size={18} /> Stacks Explorer
          </Link>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
              isMainnet ? "border-info/50 bg-info/10 text-info" : "border-warning/50 bg-warning/10 text-warning",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", isMainnet ? "bg-info" : "bg-warning")} />
            {isMainnet ? "Mainnet" : "Testnet"}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <a
              href={`${chain.explorerUrl}${chain.explorerChainParam}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
              title="The Hiro explorer this data is sourced from"
            >
              Data source <ExternalLink className="h-3 w-3" />
            </a>
            <NetworkDropdown slug={network} />
          </div>
        </div>
        <StacksExplorerNav network={network} />
      </div>

      <div className="p-4 lg:p-6">
        <Outlet />
      </div>
    </div>
  );
}
