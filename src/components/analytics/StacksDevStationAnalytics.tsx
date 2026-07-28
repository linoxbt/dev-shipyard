import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Package, Coins, Image as ImageIcon, Banknote, ShieldCheck, ExternalLink, Info, Rocket } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { loadStacksDeploys, type StacksDeploy } from "@/lib/stacks/deploy-history";
import { stacksExplorerLink, type StacksNetworkId } from "@/lib/stacks/chains";

const AMBER = "#f59e0b";
const KIND_COLOR: Record<string, string> = { token: "#14b8a6", nft: "#9945FF", payment: "#f59e0b", contract: "#5546FF" };

function dayKey(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function StacksDevStationAnalytics({ network }: { network: StacksNetworkId }) {
  const [all, setAll] = useState<StacksDeploy[]>([]);

  useEffect(() => {
    const refresh = () => setAll(loadStacksDeploys());
    refresh();
    window.addEventListener("devstation-stacks-deploys", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("devstation-stacks-deploys", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const deploys = useMemo(() => all.filter((d) => d.network === network), [all, network]);

  const { series, byType, kpis, covered } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of deploys) counts.set(dayKey(d.timestamp), (counts.get(dayKey(d.timestamp)) ?? 0) + 1);
    const series: Array<{ day: string; count: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date();
      dt.setUTCDate(dt.getUTCDate() - i);
      const k = dt.toISOString().slice(0, 10);
      series.push({ day: k.slice(5), count: counts.get(k) ?? 0 });
    }
    const tokens = deploys.filter((d) => d.kind === "token").length;
    const nfts = deploys.filter((d) => d.kind === "nft").length;
    const payments = deploys.filter((d) => d.kind === "payment").length;
    const byType = [
      { name: "Tokens", count: tokens, key: "token" },
      { name: "NFTs", count: nfts, key: "nft" },
      { name: "Payments", count: payments, key: "payment" },
    ].filter((x) => x.count > 0);
    const covered = deploys.filter((d) => d.coverage === "covered").length;
    return { series, byType, covered, kpis: { total: deploys.length, tokens, nfts, payments } };
  }, [deploys]);

  if (deploys.length === 0) {
    return (
      <div className="p-4 lg:p-6">
        <div className="mx-auto max-w-lg rounded border border-border bg-surface p-6 text-center">
          <Package className="mx-auto h-8 w-8 text-meta" />
          <h2 className="mt-3 font-mono text-sm font-bold text-foreground">No DevStation deploys yet</h2>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Deploy a Clarity contract on Stacks {network === "stacks-mainnet" ? "Mainnet" : "Testnet"} through
            DevStation and it will show up here, with its post-condition coverage verdict. Reflects
            deploys made in this browser (Stacks has no on-chain DevStation registry).
          </p>
          <Link
            to="/launchkit/templates"
            className="mt-4 inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs text-primary-foreground hover:bg-primary-hover"
          >
            <Rocket className="h-3.5 w-3.5" /> Deploy on Stacks
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Package} label="Total Deploys" value={kpis.total.toLocaleString()} />
        <Kpi icon={Coins} label="Tokens" value={kpis.tokens.toLocaleString()} />
        <Kpi icon={ImageIcon} label="NFTs" value={kpis.nfts.toLocaleString()} />
        <Kpi icon={Banknote} label="Payments" value={kpis.payments.toLocaleString()} />
      </div>

      <Card title="Deployments over time" subtitle="last 30 days">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="stxDepFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={AMBER} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1f2933" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} interval={4} />
              <YAxis width={28} allowDecimals={false} tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} deploys`, ""]} />
              <Area type="monotone" dataKey="count" stroke={AMBER} strokeWidth={2} fill="url(#stxDepFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Deployments by type" subtitle="token / NFT / payment">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byType} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="#1f2933" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fill: "#9ca3af", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff08" }} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {byType.map((b) => (
                    <Cell key={b.key} fill={KIND_COLOR[b.key]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Post-condition coverage" subtitle="DevStation's Stacks differentiator">
          <div className="p-2">
            <div className="mb-2 flex items-center gap-2 font-mono text-2xl font-bold text-foreground">
              <ShieldCheck className="h-6 w-6 text-success" />
              {kpis.total ? Math.round((covered / kpis.total) * 100) : 0}%
              <span className="font-mono text-xs font-normal text-meta">covered at deploy</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-success" style={{ width: `${kpis.total ? (covered / kpis.total) * 100 : 0}%` }} />
            </div>
            <p className="mt-2 font-mono text-[10px] text-meta">
              {covered} of {kpis.total} deployments passed the post-condition coverage audit with no
              uncovered transfer paths.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Recent deployments" subtitle={`${deploys.length} recorded on this network`}>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
          <span>Contract</span>
          <span className="hidden text-right sm:block">Coverage</span>
          <span className="text-right">When</span>
        </div>
        {deploys.slice(0, 12).map((d) => (
          <a
            key={d.contractName + (d.txid ?? "")}
            href={d.txid ? stacksExplorerLink(network, "txid", d.txid) : "#"}
            target="_blank"
            rel="noreferrer"
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
          >
            <span className="min-w-0">
              <span className="block truncate text-foreground">{d.contractName.split(".").pop()}</span>
              <span className="block truncate text-meta">{d.templateId ?? d.kind}</span>
            </span>
            <span
              className="hidden text-right sm:block"
              style={{ color: d.coverage === "covered" ? "#22c55e" : d.coverage === "unknown-risk" ? "#eab308" : "#ef4444" }}
            >
              {d.coverage ?? "—"}
            </span>
            <span className="inline-flex items-center gap-1 text-right text-meta">
              {new Date(d.timestamp * 1000).toLocaleDateString()}
              <ExternalLink className="h-3 w-3" />
            </span>
          </a>
        ))}
      </Card>

      <p className="flex items-center gap-1.5 font-mono text-[10px] text-meta">
        <Info className="h-3 w-3" /> Stacks has no on-chain DevStation registry, so this reflects
        deployments made through DevStation in this browser, with their audit verdicts.
      </p>
    </div>
  );
}

const tooltipStyle = {
  background: "#0a0e13",
  border: "1px solid #1f2933",
  borderRadius: 6,
  fontFamily: "monospace",
  fontSize: 11,
} as const;

function Kpi({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="font-mono text-xl font-bold text-foreground">{value}</div>
    </div>
  );
}
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-baseline justify-between border-b border-border px-4 py-2">
        <span className="font-mono text-xs font-bold text-foreground">{title}</span>
        {subtitle && <span className="font-mono text-[10px] text-meta">{subtitle}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}
