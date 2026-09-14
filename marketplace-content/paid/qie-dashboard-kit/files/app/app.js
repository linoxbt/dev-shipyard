// Demo of the QIE Dashboard Kit: a live QIE Mainnet dashboard from the latest
// blocks, refreshed every 15 seconds. Every number comes from the RPC.

import { render } from "preact";
import { useState } from "preact/hooks";
import { html } from "htm/preact";
import { CHAIN, explorerAddress } from "./contract.js";
import {
  BarChart,
  DataTable,
  EmptyState,
  Sparkline,
  StatCard,
  Tabs,
  blockStats,
  formatCompact,
  timeAgo,
  useLiveBlocks,
} from "./dashboard-kit.js";

function App() {
  const { blocks, loading, error } = useLiveBlocks({ count: 24 });
  const [tab, setTab] = useState("chart");
  const stats = blockStats(blocks);

  return html`
    <main>
      <header>
        <div>
          <h1>${CHAIN.name} live</h1>
          <p class="sub">The latest ${blocks.length || 24} blocks, straight from the RPC.</p>
        </div>
      </header>

      ${error && html`<p class="error">${error}</p>`}

      <div class="grid" style=${{ marginTop: "16px" }}>
        <${StatCard} label="Latest block" value=${stats ? stats.latest.toLocaleString("en-US") : ""} loading=${loading} />
        <${StatCard}
          label="Block time"
          value=${stats?.avgBlockSeconds != null ? stats.avgBlockSeconds.toFixed(1) : "…"}
          unit="s"
          hint="Average over these blocks"
          loading=${loading}
        />
        <${StatCard} label="Transactions" value=${stats ? stats.avgTxs.toFixed(1) : ""} unit="per block" loading=${loading} />
        <${StatCard} label="Gas used" value=${stats ? stats.avgGasUsedPct.toFixed(2) : ""} unit="% of limit" loading=${loading} />
      </div>

      <section class="panel">
        <div class="row">
          <h2>Activity</h2>
          <${Tabs}
            tabs=${[{ id: "chart", label: "Chart" }, { id: "table", label: "Blocks" }]}
            active=${tab}
            onChange=${setTab}
          />
        </div>
        ${blocks.length === 0
          ? html`<${EmptyState} title=${loading ? "Loading blocks…" : "No blocks"} />`
          : tab === "chart"
            ? html`
                <div class="row">
                  <span class="meta">Transactions per block</span>
                  <${Sparkline} values=${blocks.map((b) => b.txCount)} width=${220} />
                </div>
                <${BarChart}
                  items=${blocks.map((b) => ({ label: `#${b.number}`, value: b.gasUsed }))}
                  format=${(v) => `${formatCompact(v)} gas`}
                />
              `
            : html`
                <${DataTable}
                  initialSort=${{ key: "number", dir: "desc" }}
                  rows=${blocks}
                  columns=${[
                    {
                      key: "number",
                      label: "Block",
                      format: (v) => html`<a href=${`${CHAIN.explorerUrl}/block/${v}`} target="_blank" rel="noreferrer">${v.toLocaleString("en-US")}</a>`,
                    },
                    { key: "timestamp", label: "Time", format: (v) => timeAgo(v) },
                    { key: "txCount", label: "Txs", align: "right" },
                    { key: "gasUsed", label: "Gas used", align: "right", format: (v) => formatCompact(v) },
                  ]}
                />
              `}
      </section>
      <p class="meta">Explorer: <a href=${explorerAddress("0x0000000000000000000000000000000000000000").replace(/\/address\/.*/, "")} target="_blank" rel="noreferrer">${CHAIN.explorerUrl}</a></p>
    </main>
  `;
}

render(html`<${App} />`, document.getElementById("root"));
