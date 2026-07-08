import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useExplorer } from "@/hooks/useExplorer";
import { Card, Spinner } from "@/components/explorer/ui";
import { withCommas } from "@/lib/explorer/format";
import { useExplorerNetwork, chainIdForSlug } from "@/lib/explorer/network";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { getChainPriceHistory } from "@/lib/api/chain.functions";

interface TxPoint {
  date: string;
  // Blockscout instances disagree on this field's name — QIE/BOT Chain send
  // "transaction_count", Arc/GOAT Network/the Arbitrum community mirror send
  // "transactions_count" (confirmed live against all of them). Read either.
  transaction_count?: number;
  transactions_count?: number;
}
interface MarketPoint {
  date: string;
  closing_price: string | null;
  market_cap: string | null;
}

const AMBER = "#e67e22";
const TEAL = "#1294a9";

function shortDate(d: string): string {
  // "2026-06-11" -> "Jun 11"
  const [, m, day] = d.split("-");
  const months = [
    "",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[Number(m)] ?? m} ${Number(day)}`;
}

const axisTick = { fontSize: 10, fill: "#7a8694", fontFamily: "monospace" };
const tooltipStyle = {
  background: "#0a0e13",
  border: "1px solid #1f2933",
  borderRadius: 6,
  fontSize: 11,
  fontFamily: "monospace",
};

// Two analytics charts for the explorer dashboard: daily transactions and the
// native coin's price, read from Blockscout's /stats/charts endpoints via the
// proxy. Client only (recharts touches the DOM) — wrap usage in <ClientOnly>.
export function ExplorerCharts({ symbol = "QIE" }: { symbol?: string }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <TransactionsChart />
      <PriceChart symbol={symbol} />
    </div>
  );
}

function TransactionsChart() {
  const { data } = useExplorer<{ chart_data?: TxPoint[] }>("/stats/charts/transactions", {
    refetchInterval: 60_000,
  });
  const points = (data?.chart_data ?? [])
    .slice(0, 30)
    .reverse()
    .map((p) => ({
      date: p.date,
      transaction_count: p.transaction_count ?? p.transactions_count ?? 0,
    }));

  return (
    <Card title="Daily Transactions (30d)">
      <div className="h-56 px-2 py-3">
        {!data ? (
          <Spinner />
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-xs text-meta">
            No transaction history available.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="txFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={AMBER} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1f2933" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={axisTick} minTickGap={24} />
              <YAxis tick={axisTick} width={44} tickFormatter={(v) => withCommas(v)} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={shortDate}
                formatter={(v: number) => [withCommas(v), "Txns"]}
              />
              <Area
                type="monotone"
                dataKey="transaction_count"
                stroke={AMBER}
                strokeWidth={2}
                fill="url(#txFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function PriceChart({ symbol = "QIE" }: { symbol?: string }) {
  const network = useExplorerNetwork();
  const chainId = chainIdForSlug(network);
  const isTestnet = SUPPORTED_CHAINS.find((c) => c.id === chainId)?.testnet ?? true;

  const { data } = useExplorer<{ chart_data?: MarketPoint[] }>("/stats/charts/market", {
    refetchInterval: 60_000,
    enabled: !isTestnet,
  });
  const explorerPoints = (data?.chart_data ?? [])
    .slice(0, 30)
    .reverse()
    .map((p) => ({ date: p.date, price: p.closing_price ? Number(p.closing_price) : null }))
    .filter((p): p is { date: string; price: number } => p.price != null);

  // Some chains' own explorer has no price-chart history at all (no oracle
  // configured — confirmed empty chart_data on BOT Chain/Arc/GOAT Network's
  // Blockscout, and Avalanche has no Blockscout to ask). Fall back to
  // CoinGecko's own history wherever a coin id is known, same chains that
  // already get a live price/market-cap fallback in StatsOverview.
  const needsFallback = !isTestnet && data != null && explorerPoints.length === 0;
  const { data: history } = useQuery({
    queryKey: ["chain-price-history", chainId],
    queryFn: () => getChainPriceHistory({ data: { chainId } }),
    enabled: needsFallback,
    staleTime: 5 * 60_000,
  });
  const fallbackPoints =
    history?.ok && history.points
      ? history.points
          .map((p) => ({ date: p.date, price: p.closing_price ? Number(p.closing_price) : null }))
          .filter((p): p is { date: string; price: number } => p.price != null)
      : [];

  const points = explorerPoints.length > 0 ? explorerPoints : fallbackPoints;
  const loading = isTestnet ? false : !data || (needsFallback && !history);

  return (
    <Card title={`${symbol} Price (30d)`}>
      <div className="h-56 px-2 py-3">
        {loading ? (
          <Spinner />
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-xs text-meta">
            No price history available.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="#1f2933" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={axisTick} minTickGap={24} />
              <YAxis
                tick={axisTick}
                width={56}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => `$${v.toFixed(3)}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={shortDate}
                formatter={(v: number) => [`$${v.toFixed(4)}`, symbol]}
              />
              <Line type="monotone" dataKey="price" stroke={TEAL} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
