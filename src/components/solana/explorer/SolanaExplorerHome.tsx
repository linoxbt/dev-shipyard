import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AreaChart, Area, ResponsiveContainer, CartesianGrid, YAxis, XAxis, Tooltip } from "recharts";
import { Search, DollarSign, Activity, Gauge, Boxes, FileText, Coins, Layers } from "lucide-react";
import {
  getSolanaPrice,
  getSolanaClusterStats,
  getSolanaLatestBlocks,
  getSolanaLatestTransactions,
  getSolanaWalletActivity,
} from "@/lib/api/solana-explorer.functions";
import { type SolanaCluster } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";

function age(blockTime: number | null): string {
  if (!blockTime) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - blockTime));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function fmtCompact(n: number): string {
  return n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
}
function fmtDuration(secs: number): string {
  if (secs <= 0) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `~${h ? `${h}h ` : ""}${m}m ${s}s`;
}
function fmtUtc(t: number | null): string {
  if (!t) return "—";
  return new Date(t * 1000).toUTCString().replace("GMT", "UTC");
}

export function SolanaExplorerHome({ cluster }: { cluster: SolanaCluster }) {
  const navigate = useNavigate();
  const price = useQuery({
    queryKey: ["sol-price", cluster],
    queryFn: () => getSolanaPrice({ data: { cluster } }),
    refetchInterval: 60_000,
  });
  const stats = useQuery({
    queryKey: ["sol-cluster", cluster],
    queryFn: () => getSolanaClusterStats({ data: { cluster } }),
    refetchInterval: 10_000,
  });
  const blocks = useQuery({
    queryKey: ["sol-blocks", cluster],
    queryFn: () => getSolanaLatestBlocks({ data: { cluster } }),
    refetchInterval: 10_000,
  });
  const txns = useQuery({
    queryKey: ["sol-txns", cluster],
    queryFn: () => getSolanaLatestTransactions({ data: { cluster } }),
    refetchInterval: 10_000,
  });
  const wallets = useQuery({
    queryKey: ["sol-wallet-activity", cluster],
    queryFn: () => getSolanaWalletActivity({ data: { cluster } }),
    refetchInterval: 30_000,
  });

  const [query, setQuery] = useState("");
  const p = price.data;
  const s = stats.data?.ok ? stats.data : null;
  const w = wallets.data?.ok ? wallets.data : null;

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const v = query.trim();
    if (!v) return;
    if (v.length >= 80) navigate({ to: "/explorer/$network/tx/$hash", params: { network: cluster, hash: v } });
    else navigate({ to: "/explorer/$network/address/$hash", params: { network: cluster, hash: v } });
  };

  return (
    <div className="space-y-6">
      {/* Search */}
      <form onSubmit={onSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for accounts, transactions, blocks…"
            className="w-full rounded border border-border bg-surface py-2 pl-9 pr-3 font-mono text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <button className="rounded bg-primary px-4 py-2 font-mono text-sm text-primary-foreground hover:bg-primary/90">
          Search
        </button>
      </form>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={DollarSign}
          label="SOL Price"
          value={p?.ok ? fmtUsd(p.usd) : "—"}
          sub={
            p?.ok && p.change24h !== null
              ? { text: `${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(2)}%`, positive: p.change24h >= 0 }
              : undefined
          }
        />
        <StatCard icon={Activity} label="Market Cap" value={p?.ok && p.marketCap !== null ? `$${fmtCompact(p.marketCap)}` : "—"} />
        <SupplyCard
          label="Circulating Supply"
          value={s ? `${fmtCompact(s.circulatingSol)} / ${fmtCompact(s.totalSupplySol)}` : "…"}
          pct={s ? s.circulatingPct : 0}
          caption={s ? `${(s.circulatingPct * 100).toFixed(1)}% is circulating` : ""}
        />
        <SupplyCard
          label="Active Stake"
          value={s ? `${fmtCompact(s.activeStakeSol)} / ${fmtCompact(s.totalStakeSol)}` : "…"}
          pct={s ? (s.totalStakeSol ? s.activeStakeSol / s.totalStakeSol : 0) : 0}
          caption={s ? `Delinquent stake: ${(s.delinquentPct * 100).toFixed(1)}%` : ""}
          color="#14b8a6"
        />
      </div>

      {/* TPS history chart */}
      <div className="rounded border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2 font-mono text-xs font-bold text-foreground">
          <Gauge className="h-3.5 w-3.5 text-primary" /> TPS History
          <span className="ml-auto font-normal text-meta">
            live · {s ? `${s.tps.toLocaleString()} TPS now` : "…"}
          </span>
        </div>
        <div className="h-40 w-full">
          {s && s.tpsHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={s.tpsHistory} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="tpsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#9945FF" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#9945FF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2933" vertical={false} />
                <XAxis dataKey="slot" hide />
                <YAxis
                  width={34}
                  tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0a0e13",
                    border: "1px solid #1f2933",
                    borderRadius: 6,
                    fontFamily: "monospace",
                    fontSize: 11,
                  }}
                  labelFormatter={(v) => `slot ${Number(v).toLocaleString()}`}
                  formatter={(v: number) => [`${v.toLocaleString()} TPS`, "tps"]}
                />
                <Area type="monotone" dataKey="tps" stroke="#9945FF" strokeWidth={2} fill="url(#tpsFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-meta">
              Loading TPS history…
            </div>
          )}
        </div>
      </div>

      {/* Live cluster stats + live transaction stats */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={Layers} title="Live Cluster Stats">
          <KV label="Slot" value={s ? s.slot.toLocaleString() : "…"} />
          <KV label="Block height" value={s ? s.blockHeight.toLocaleString() : "…"} />
          <KV label="Cluster time" value={s ? fmtUtc(s.clusterTime) : "…"} />
          <KV label="Slot time (avg)" value={s ? `${s.slotTimeMs}ms` : "…"} />
          <KV label="Epoch" value={s ? s.epoch.toLocaleString() : "…"} />
          <KV label="Epoch progress" value={s ? `${(s.epochProgress * 100).toFixed(1)}%` : "…"} />
          <KV label="Epoch time remaining" value={s ? fmtDuration(s.epochRemainingSecs) : "…"} />
          <KV
            label="Active wallets (recent sample)"
            value={w ? `${w.activeWallets.toLocaleString()}` : "…"}
          />
          <KV
            label="All-time / daily wallets"
            value="see Analytics"
            last
          />
        </Panel>
        <Panel icon={Coins} title="Live Transaction Stats">
          <KV label="Transaction count" value={s ? s.transactionCount.toLocaleString() : "…"} />
          <KV label="Transactions per second (TPS)" value={s ? s.tps.toLocaleString() : "…"} last />
        </Panel>
      </div>

      {/* Latest blocks + transactions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={Boxes} title="Latest Blocks">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
            <span>Slot</span>
            <span className="text-right">Txns</span>
            <span className="text-right">Age</span>
          </div>
          {blocks.data?.blocks.map((b) => (
            <Link
              key={b.slot}
              to="/explorer/$network/block/$height"
              params={{ network: cluster, height: String(b.slot) }}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
            >
              <span className="truncate text-primary">{b.slot.toLocaleString()}</span>
              <span className="text-right text-muted-foreground">{b.txCount}</span>
              <span className="text-right text-meta">{age(b.blockTime)}</span>
            </Link>
          ))}
          {!blocks.data && <Empty>Loading blocks…</Empty>}
        </Panel>

        <Panel icon={FileText} title="Latest Transactions">
          {txns.data?.transactions.map((t) => (
            <Link
              key={t.signature}
              to="/explorer/$network/tx/$hash"
              params={{ network: cluster, hash: t.signature }}
              className="flex items-center gap-2 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
            >
              <FileText className="h-3 w-3 shrink-0 text-meta" />
              <span className="truncate text-primary">{truncateAddress(t.signature, 10, 10)}</span>
              <span className="ml-auto shrink-0 text-meta">slot {t.slot.toLocaleString()}</span>
            </Link>
          ))}
          {!txns.data && <Empty>Loading transactions…</Empty>}
        </Panel>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Layers;
  label: string;
  value: string;
  sub?: { text: string; positive: boolean };
}) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-lg font-bold text-foreground">{value}</span>
        {sub && <span className={`font-mono text-[11px] ${sub.positive ? "text-success" : "text-danger"}`}>{sub.text}</span>}
      </div>
    </div>
  );
}

function SupplyCard({
  label,
  value,
  pct,
  caption,
  color = "#9945FF",
}: {
  label: string;
  value: string;
  pct: number;
  caption: string;
  color?: string;
}) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-meta">{label}</div>
      <div className="font-mono text-sm font-bold text-foreground">{value}</div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
      </div>
      <div className="mt-1 font-mono text-[10px] text-meta">{caption}</div>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Layers;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" /> {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function KV({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2 font-mono text-xs ${last ? "" : "border-b border-border"}`}>
      <span className="text-meta">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3 font-mono text-xs text-meta">{children}</div>;
}
