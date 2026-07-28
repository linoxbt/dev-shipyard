import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search, Layers, Activity, Boxes, FileText } from "lucide-react";
import {
  getStacksNetworkStatus,
  getStacksBlocks,
  getStacksLatestTxns,
  resolveStacksBns,
} from "@/lib/api/stacks-explorer.functions";
import type { StacksNetworkId } from "@/lib/stacks/chains";
import { truncateAddress } from "@/lib/wallet";

function age(t: number | null): string {
  if (!t) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function StacksExplorerHome({ network }: { network: StacksNetworkId }) {
  const navigate = useNavigate();
  const status = useQuery({ queryKey: ["stx-status", network], queryFn: () => getStacksNetworkStatus({ data: { network } }), refetchInterval: 15_000 });
  const blocks = useQuery({ queryKey: ["stx-blocks", network], queryFn: () => getStacksBlocks({ data: { network } }), refetchInterval: 15_000 });
  const txns = useQuery({ queryKey: ["stx-txns", network], queryFn: () => getStacksLatestTxns({ data: { network } }), refetchInterval: 15_000 });
  const [q, setQ] = useState("");
  const s = status.data?.ok ? status.data : null;

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if ((v.startsWith("0x") && v.length > 40) || /^[0-9a-fA-F]{64}$/.test(v)) {
      navigate({ to: "/explorer/$network/tx/$hash", params: { network, hash: v } });
    } else if (/^\d+$/.test(v)) {
      navigate({ to: "/explorer/$network/block/$height", params: { network, height: v } });
    } else if (v.includes(".") && !/^S[PT]/i.test(v)) {
      // Looks like a BNS name (e.g. muneeb.btc) — resolve to its owner.
      const r = await resolveStacksBns({ data: { network, name: v } });
      navigate({ to: "/explorer/$network/address/$hash", params: { network, hash: r.ok ? r.address : v } });
    } else {
      navigate({ to: "/explorer/$network/address/$hash", params: { network, hash: v } });
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={search} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a transaction, block height, address, or contract (SP….name)"
            className="w-full rounded border border-border bg-surface py-2 pl-9 pr-3 font-mono text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <button className="rounded bg-primary px-4 py-2 font-mono text-sm text-primary-foreground hover:bg-primary/90">Search</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat icon={Layers} label="Stacks tip height" value={s ? s.stacksTipHeight.toLocaleString() : "…"} />
        <Stat icon={Activity} label="Bitcoin block" value={s ? s.burnBlockHeight.toLocaleString() : "…"} />
        <Stat icon={Boxes} label="Network" value={network === "stacks-mainnet" ? "Mainnet" : "Testnet"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={Boxes} title="Latest Blocks" viewAll={{ to: "/explorer/$network/blocks", network }}>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
            <span>Height</span>
            <span className="text-right">Txns</span>
            <span className="text-right">Age</span>
          </div>
          {(blocks.data?.blocks ?? []).slice(0, 8).map((b) => (
            <Link
              key={b.hash}
              to="/explorer/$network/block/$height"
              params={{ network, height: String(b.height) }}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
            >
              <span className="text-primary">#{b.height.toLocaleString()}</span>
              <span className="text-right text-muted-foreground">{b.txCount}</span>
              <span className="text-right text-meta">{age(b.time)}</span>
            </Link>
          ))}
          {!blocks.data && <Empty>Loading blocks…</Empty>}
        </Panel>

        <Panel icon={FileText} title="Latest Transactions" viewAll={{ to: "/explorer/$network/txns", network }}>
          {(txns.data?.txns ?? []).slice(0, 8).map((t) => (
            <Link
              key={t.txid}
              to="/explorer/$network/tx/$hash"
              params={{ network, hash: t.txid }}
              className="flex items-center gap-2 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
            >
              <span className={t.status === "success" ? "text-success" : "text-danger"}>●</span>
              <span className="truncate text-primary">{truncateAddress(t.txid, 8, 6)}</span>
              <span className="text-meta">· {t.type}</span>
              {t.fnName && <span className="text-muted-foreground">· {t.fnName}</span>}
            </Link>
          ))}
          {!txns.data && <Empty>Loading transactions…</Empty>}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Layers; label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="font-mono text-lg font-bold text-foreground">{value}</div>
    </div>
  );
}
function Panel({
  icon: Icon,
  title,
  viewAll,
  children,
}: {
  icon: typeof Layers;
  title: string;
  viewAll: { to: "/explorer/$network/blocks" | "/explorer/$network/txns"; network: StacksNetworkId };
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" /> {title}
        <Link to={viewAll.to} params={{ network: viewAll.network }} className="ml-auto font-normal text-primary hover:underline">
          View all →
        </Link>
      </div>
      <div>{children}</div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3 font-mono text-xs text-meta">{children}</div>;
}
