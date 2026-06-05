## DevStation Build Plan

This is a large spec. I'll build a **functional MVP frontend** of DevStation with realistic mocked data, so the full UX (templates, deploy wizard, terminal progress, Routebook tree decoder, label registry) is demoable end-to-end. Real on-chain integration (compile+deploy backend, RPC trace decoding) is scoped as a follow-up phase because it requires backend infra (solc, debug_traceTransaction support, explorer verify API) that can't be confirmed in this single build.

### Phase 1 — Shell & Design System (this build)
- Tailwind v4 tokens in `src/styles.css`: terminal black palette, amber accent, QIE teal, mono fonts (JetBrains Mono + Inter), 4px radius.
- Fixed left sidebar (240px) with branding, mock wallet chip, QIE Pass status, nav sections (LaunchKit / Routebook / Settings), network indicator.
- Shared components: `AddressChip`, `TxHashChip`, `StatusBadge`, `CodeBlock`, `TerminalOutput`, `OracleRateBadge`, empty/loading states.

### Phase 2 — Pages (mocked data)
1. **Overview** (`/`) — 4 stat cards (deployments, block height ticking, gas price, templates), recent deployments table, recent inspections, Quick Deploy + Quick Inspect cards, network status.
2. **Templates** (`/launchkit/templates`) — filter tabs, search, sort, grid of 8 seeded templates (SimpleERC20, SimpleERC721, MultiSigWallet, TokenVesting, SimpleStaking, TimelockController, SoulboundNFT, PaymentSplitter) with category badges + verified badge + deploy counts.
3. **Template Detail** (`/launchkit/templates/$id`) — info panel + syntax-highlighted Solidity viewer + ABI preview.
4. **Deploy Wizard** (`/launchkit/deploy`) — 3 steps: select → configure (dynamic form from constructor args, live gas/USD preview) → terminal progress (typewriter lines) → success screen with ENV download, submission copy, "Open in Routebook" card.
5. **Projects** (`/launchkit/projects`) — table of deployed contracts with detail side panel.
6. **Routebook Inspect** (`/routebook` and `/routebook/$txHash`) — search bar, 2 example demo tx buttons, overview card, recursive route tree (color-coded by call type, labeled addresses), token movements panel, approval detector, revert decoder, gas breakdown tab.
7. **Label Registry** (`/routebook/labels`) — stats, filter, table with AUTO/COMMUNITY/VERIFIED source badges, submit modal (with mocked QIE Stable fee notice).
8. **Settings** (`/settings`) — network config, oracle settings, display prefs, QIE Pass status, clear data.

### Phase 3 — Mock data layer
- `src/lib/mock/templates.ts`, `projects.ts`, `labels.ts`, `transactions.ts` (2 pre-decoded demo txs: a successful ERC-20 transfer with swap path + a reverted approval).
- Pre-seeded `ContractLabelRegistry` mock with 10+ QIE contracts (DEX Router, QIE Stable, Pass, Oracle, etc.).
- Mock wallet via Zustand store; connect/disconnect toggle + chain switch simulator.

### Out of scope (call out to user)
The following need backend infra and real contracts and are **not included** in this build — they're UI-mocked but not wired to chain:
- Real compile + deploy pipeline (solc-js, ethers tx submission)
- Real `debug_traceTransaction` decoding via QIE RPC
- Real ContractLabelRegistry / ProjectRegistry / TemplateRegistry contract reads
- Real QIE Pass verification and QIE Stable transfers
- Real verification submission to QIE explorer

Each integration point is structured behind a `lib/services/*.ts` module returning typed mock data, so swapping in real implementations later is a localized change.

### Tech notes
- TanStack Start file-based routing under `src/routes/`.
- Tailwind v4 with `@theme` tokens; semantic tokens only — no ad-hoc hex in components.
- Recursive `RouteNode` component for the Routebook tree.
- `react-syntax-highlighter` (or prism-react-renderer) for Solidity/JSON code blocks.

### Deliverable
A polished, fully navigable DevStation UI that demos every screen described in the spec with realistic data. Live on-chain wiring is a clearly-marked follow-up.

**Confirm and I'll start with Phase 1 (design system + shell) and proceed straight through.**
