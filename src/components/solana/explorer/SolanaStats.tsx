import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, ResponsiveContainer, CartesianGrid, YAxis, XAxis, Tooltip } from "recharts";
import { Gauge, Coins, Server, Users, Info } from "lucide-react";
import { getSolanaClusterStats, getSolanaWalletActivity } from "@/lib/api/solana-explorer.functions";
import type { SolanaCluster } from "@/lib/solana/chains";

function fmtCompact(n: number): string {
  return n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
}

export function SolanaStats({ cluster }: { cluster: SolanaCluster }) {
  const stats = useQuery({
    queryKey: ["sol-cluster", cluster],
    queryFn: () => getSolanaClusterStats({ data: { cluster } }),
    refetchInterval: 10_000,
  });
  const wallets = useQuery({
    queryKey: ["sol-wallet-activity", cluster],
    queryFn: () => getSolanaWalletActivity({ data: { cluster } }),
    refetchInterval: 30_000,
  });

  const s = stats.data?.ok ? stats.data : null;
  const w = wallets.data?.ok ? wallets.data : null;

  return (
    <div className="space-y-6">
      <h1 className="font-mono text-lg font-bold text-foreground">Network Analytics</h1>

      {/* TPS chart */}
      <div className="rounded border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2 font-mono text-xs font-bold text-foreground">
          <Gauge className="h-3.5 w-3.5 text-primary" /> Transactions Per Second (last ~60 samples)
          <span className="ml-auto font-normal text-meta">{s ? `${s.tps.toLocaleString()} TPS now` : "…"}</span>
        </div>
        <div className="h-56 w-full">
          {s && s.tpsHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={s.tpsHistory} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="tpsFillStats" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#9945FF" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#9945FF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2933" vertical={false} />
                <XAxis dataKey="slot" hide />
                <YAxis width={38} tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#0a0e13", border: "1px solid #1f2933", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}
                  labelFormatter={(v) => `slot ${Number(v).toLocaleString()}`}
                  formatter={(v: number) => [`${v.toLocaleString()} TPS`, "tps"]}
                />
                <Area type="monotone" dataKey="tps" stroke="#9945FF" strokeWidth={2} fill="url(#tpsFillStats)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-meta">Loading TPS history…</div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Supply */}
        <Panel icon={Coins} title="Supply">
          <KV label="Total supply" value={s ? `◎${fmtCompact(s.totalSupplySol)}` : "…"} />
          <KV label="Circulating" value={s ? `◎${fmtCompact(s.circulatingSol)}` : "…"} />
          <KV label="Non-circulating" value={s ? `◎${fmtCompact(s.totalSupplySol - s.circulatingSol)}` : "…"} />
          <Bar pct={s ? s.circulatingPct : 0} caption={s ? `${(s.circulatingPct * 100).toFixed(1)}% circulating` : ""} />
        </Panel>

        {/* Stake */}
        <Panel icon={Server} title="Stake & Validators">
          <KV label="Active stake" value={s ? `◎${fmtCompact(s.activeStakeSol)}` : "…"} />
          <KV label="Total stake" value={s ? `◎${fmtCompact(s.totalStakeSol)}` : "…"} />
          <KV label="Delinquent stake" value={s ? `${(s.delinquentPct * 100).toFixed(2)}%` : "…"} />
          <KV label="Validators (active / delinquent)" value={s ? `${s.currentValidators} / ${s.delinquentValidators}` : "…"} />
          <Bar pct={s ? (s.totalStakeSol ? s.activeStakeSol / s.totalStakeSol : 0) : 0} caption="active stake" color="#14b8a6" />
        </Panel>
      </div>

      {/* Wallet activity */}
      <Panel icon={Users} title="Wallet Activity">
        <KV
          label="Active wallets (recent sample)"
          value={w ? `${w.activeWallets.toLocaleString()} unique fee-payers` : "…"}
        />
        <KV label="Sample size" value={w ? `${w.sampledTxns} txns @ slot ${w.sampledSlot.toLocaleString()}` : "…"} last />
        <div className="flex items-start gap-2 px-4 py-2.5 font-mono text-[10px] text-meta">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            All-time and daily-active wallet totals require a chain indexer (the public RPC exposes
            no such aggregate). The figure above is a live sample of unique fee-payers in the latest
            block.
          </span>
        </div>
      </Panel>
    </div>
  );
}

function Panel({ icon: Icon, title, children }: { icon: typeof Coins; title: string; children: React.ReactNode }) {
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
function Bar({ pct, caption, color = "#9945FF" }: { pct: number; caption: string; color?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
      </div>
      <div className="mt-1 font-mono text-[10px] text-meta">{caption}</div>
    </div>
  );
}
