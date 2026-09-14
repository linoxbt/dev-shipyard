# QIE Dashboard Kit

Dashboard components for preact + htm, and the code to feed them live QIE Mainnet data. Charts are plain SVG: no chart library to load, nothing that breaks in a sandboxed preview.

| Export | What it does |
| --- | --- |
| `<StatCard label value unit hint delta loading>` | A headline number, with an optional ▲/▼ percentage and a loading skeleton |
| `<Sparkline values width height>` | A trend line scaled to its own range |
| `<BarChart items format height>` | Bars from `[{ label, value }]`, with hover titles |
| `<DataTable columns rows initialSort emptyText>` | Sortable by any column; `format(value, row)` per column may return markup |
| `<Tabs tabs active onChange>` | Segmented tabs |
| `<Skeleton>`, `<EmptyState title body>` | Loading and empty states |
| `recentBlocks(count)` | The latest blocks from QIE Mainnet: number, time, transactions, gas |
| `useLiveBlocks({ count, refreshMs })` | The same, refreshed on an interval |
| `blockStats(blocks)` | Latest block, average block time, transactions per block, gas used % |
| `formatCompact`, `timeAgo` | Number and time helpers |

## Add it to an app

1. Copy `dashboard-kit.js`, `dashboard-kit.css` and `contract.js` into your app folder. An App Builder app already has `contract.js`: check it exports `CHAIN` and `viemChain`.
2. Add `<link rel="stylesheet" href="./dashboard-kit.css" />`.
3. Build the dashboard:

```js
import { StatCard, DataTable, useLiveBlocks, blockStats } from "./dashboard-kit.js";

function Overview() {
  const { blocks, loading } = useLiveBlocks({ count: 30 });
  const stats = blockStats(blocks);
  return html`
    <${StatCard} label="Block time" value=${stats?.avgBlockSeconds?.toFixed(1)} unit="s" loading=${loading} />
    <${DataTable} rows=${blocks} columns=${[{ key: "number", label: "Block" }, { key: "txCount", label: "Txs", align: "right" }]} />
  `;
}
```

Any data works: pass your own contract's reads (`publicClient.readContract`) to the same components.

## Theme

Set `--ds-brand`, `--ds-text`, `--ds-muted`, `--ds-surface`, `--ds-surface-2`, `--ds-border`, `--ds-up`, `--ds-down` or `--ds-radius` on `:root`.

## Demo

`app.js` is a live QIE Mainnet dashboard over the latest 24 blocks: stat cards, a sparkline, a gas bar chart and a sortable block table. In DevStation, **Clone into my apps** previews it.
