// QIE Dashboard Kit: dashboard components and live chain data for preact + htm.
//
//   <StatCard label value unit hint delta loading />
//   <Sparkline values />                       inline trend line (SVG)
//   <BarChart items format />                  labelled bars (SVG)
//   <DataTable columns rows initialSort />     sortable table
//   <Tabs tabs active onChange />
//   <Skeleton />, <EmptyState title body />
//   recentBlocks(count), useLiveBlocks(), blockStats(blocks)   QIE Mainnet data
//   formatCompact(n), timeAgo(seconds)
//
// No chart library: plain SVG, so nothing else to load and nothing to break in
// a sandboxed preview. Classes are prefixed `ds-`; theme in dashboard-kit.css.

import { html } from "htm/preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createPublicClient, http } from "viem";
import { CHAIN, viemChain } from "./contract.js";

export const publicClient = createPublicClient({ chain: viemChain, transport: http(CHAIN.rpcUrl) });

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatCompact(value) {
  return compact.format(typeof value === "bigint" ? Number(value) : value);
}

export function timeAgo(unixSeconds, now = Date.now() / 1000) {
  const s = Math.max(0, Math.round(now - Number(unixSeconds)));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// --- components ----------------------------------------------------------------

export function Skeleton({ width = "100%", height = "1em" }) {
  return html`<span class="ds-skeleton" style=${{ width, height }} />`;
}

export function StatCard({ label, value, unit, hint, delta, loading }) {
  const trend = typeof delta === "number" && delta !== 0 ? (delta > 0 ? "ds-up" : "ds-down") : "";
  return html`
    <div class="ds-card">
      <div class="ds-label">${label}</div>
      <div class="ds-value">
        ${loading ? html`<${Skeleton} width="60%" height="28px" />` : value}
        ${unit && !loading && html`<span class="ds-unit"> ${unit}</span>`}
      </div>
      ${(hint || trend) &&
      html`<div class="ds-hint">
        ${trend && html`<span class=${trend}>${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%</span> `}${hint}
      </div>`}
    </div>
  `;
}

/** A trend line scaled to its own min and max. Needs two points to draw. */
export function Sparkline({ values, width = 160, height = 40, label = "trend" }) {
  const points = useMemo(() => {
    const nums = values.map(Number);
    if (nums.length < 2) return "";
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    return nums
      .map((v, i) => {
        const x = (i / (nums.length - 1)) * (width - 2) + 1;
        const y = height - 1 - ((v - min) / span) * (height - 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values, width, height]);
  if (!points) return html`<span class="ds-hint">Not enough data yet</span>`;
  return html`
    <svg class="ds-spark" width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`} role="img" aria-label=${label}>
      <polyline points=${points} fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  `;
}

export function BarChart({ items, height = 160, format = (v) => formatCompact(v) }) {
  const max = Math.max(1, ...items.map((i) => Number(i.value)));
  const barWidth = 100 / Math.max(items.length, 1);
  return html`
    <div class="ds-bars">
      <svg width="100%" height=${height} viewBox=${`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label="bar chart">
        ${items.map((item, i) => {
          const h = (Number(item.value) / max) * (height - 4);
          return html`<rect x=${i * barWidth + barWidth * 0.15} y=${height - h} width=${barWidth * 0.7} height=${h} rx="1">
            <title>${item.label}: ${format(item.value)}</title>
          </rect>`;
        })}
      </svg>
      <div class="ds-bars-axis">
        <span>${items[0]?.label ?? ""}</span><span>${items[items.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  `;
}

/** columns: [{ key, label, align?, format?(value, row), sortable? }] */
export function DataTable({ columns, rows, initialSort, emptyText = "Nothing to show" }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      const order = x < y ? -1 : x > y ? 1 : 0;
      return dir === "asc" ? order : -order;
    });
  }, [rows, sort]);

  const toggle = (key) =>
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  if (rows.length === 0) return html`<${EmptyState} title=${emptyText} />`;
  return html`
    <div class="ds-table-wrap">
      <table class="ds-table">
        <thead>
          <tr>
            ${columns.map(
              (c) => html`<th class=${c.align === "right" ? "ds-right" : ""}>
                ${c.sortable === false
                  ? c.label
                  : html`<button class="ds-sort" onClick=${() => toggle(c.key)}>
                      ${c.label}${sort?.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>`}
              </th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${sorted.map(
            (row, i) => html`<tr key=${row.id ?? i}>
              ${columns.map(
                (c) => html`<td class=${c.align === "right" ? "ds-right" : ""}>${c.format ? c.format(row[c.key], row) : String(row[c.key])}</td>`,
              )}
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
  `;
}

export function Tabs({ tabs, active, onChange }) {
  return html`
    <div class="ds-tabs" role="tablist">
      ${tabs.map(
        (t) => html`<button role="tab" aria-selected=${active === t.id} class=${active === t.id ? "ds-tab ds-tab-on" : "ds-tab"} onClick=${() => onChange(t.id)}>${t.label}</button>`,
      )}
    </div>
  `;
}

export function EmptyState({ title, body }) {
  return html`<div class="ds-empty"><strong>${title}</strong>${body && html`<p>${body}</p>`}</div>`;
}

// --- QIE Mainnet data -------------------------------------------------------------

/** The latest `count` blocks, oldest first. */
export async function recentBlocks(count = 20, client = publicClient) {
  const latest = await client.getBlockNumber();
  const numbers = [];
  for (let i = 0n; i < BigInt(count) && latest - i >= 0n; i++) numbers.push(latest - i);
  const blocks = await Promise.all(numbers.map((blockNumber) => client.getBlock({ blockNumber })));
  return blocks
    .map((b) => ({
      id: b.number.toString(),
      number: Number(b.number),
      timestamp: Number(b.timestamp),
      txCount: b.transactions.length,
      gasUsed: Number(b.gasUsed),
      gasLimit: Number(b.gasLimit),
    }))
    .sort((a, b) => a.number - b.number);
}

/** Averages over a run of blocks, oldest first. */
export function blockStats(blocks) {
  if (blocks.length === 0) return null;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const spans = blocks.length - 1;
  return {
    latest: last.number,
    avgBlockSeconds: spans > 0 ? (last.timestamp - first.timestamp) / spans : null,
    avgTxs: blocks.reduce((n, b) => n + b.txCount, 0) / blocks.length,
    avgGasUsedPct: (blocks.reduce((n, b) => n + b.gasUsed / (b.gasLimit || 1), 0) / blocks.length) * 100,
  };
}

/** Recent blocks, refreshed on an interval. */
export function useLiveBlocks({ count = 20, refreshMs = 15000 } = {}) {
  const [state, setState] = useState({ blocks: [], loading: true, error: "" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const load = async () => {
      try {
        const blocks = await recentBlocks(count);
        if (alive.current) setState({ blocks, loading: false, error: "" });
      } catch (e) {
        if (alive.current)
          setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message.split("\n")[0] : "RPC error" }));
      }
    };
    void load();
    const timer = setInterval(load, refreshMs);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [count, refreshMs]);
  return state;
}
