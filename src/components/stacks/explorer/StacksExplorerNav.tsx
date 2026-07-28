import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Boxes, FileText, Clock, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StacksNetworkId } from "@/lib/stacks/chains";

const TABS = [
  { label: "Overview", to: "/explorer/$network", icon: LayoutDashboard, exact: true },
  { label: "Blocks", to: "/explorer/$network/blocks", icon: Boxes },
  { label: "Transactions", to: "/explorer/$network/txns", icon: FileText },
  { label: "Mempool", to: "/explorer/$network/mempool", icon: Clock },
  { label: "Tokens", to: "/explorer/$network/tokens", icon: Coins },
] as const;

export function StacksExplorerNav({ network }: { network: StacksNetworkId }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const base = `/explorer/${network}`;
  return (
    <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2 lg:px-6">
      {TABS.map((t) => {
        const href = t.to.replace("$network", network);
        const isExact = "exact" in t && t.exact;
        const active = isExact ? path === base || path === `${base}/` : path === href;
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            to={t.to}
            params={{ network }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] transition",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
