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
import { useExplorer } from "@/hooks/useExplorer";
import { Card, Spinner } from "@/components/explorer/ui";
import { withCommas } from "@/lib/explorer/format";

interface TxPoint {
  date: string;
  transaction_count: number;
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

// Two analytics charts for the explorer dashboard: daily transactions and QIE
// price, read from Blockscout's /stats/charts endpoints via the proxy. Client
// only (recharts touches the DOM) — wrap usage in <ClientOnly>.
export function ExplorerCharts() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <TransactionsChart />
      <PriceChart />
    </div>
  );
}

function TransactionsChart() {
  const { data } = useExplorer<{ chart_data?: TxPoint[] }>("/stats/charts/transactions", {
    refetchInterval: 60_000,
  });
  const points = (data?.chart_data ?? []).slice(0, 30).reverse();

  return (
    <Card title="Daily Transactions (30d)">
      <div className="h-56 px-2 py-3">
        {!data ? (
          <Spinner />
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

function PriceChart() {
  const { data } = useExplorer<{ chart_data?: MarketPoint[] }>("/stats/charts/market", {
    refetchInterval: 60_000,
  });
  const points = (data?.chart_data ?? [])
    .slice(0, 30)
    .reverse()
    .map((p) => ({ date: p.date, price: p.closing_price ? Number(p.closing_price) : null }))
    .filter((p) => p.price != null);

  return (
    <Card title="QIE Price (30d)">
      <div className="h-56 px-2 py-3">
        {!data ? (
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
                formatter={(v: number) => [`$${v.toFixed(4)}`, "QIE"]}
              />
              <Line type="monotone" dataKey="price" stroke={TEAL} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
