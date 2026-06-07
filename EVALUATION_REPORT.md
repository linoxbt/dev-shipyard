# DevStation (dev-shipyard) — Technical Evaluation Report

**Repository:** `github.com/linoxbt/dev-shipyard`
**Reviewed:** `main` @ `d8d3fef`, 2026-06-07
**Scope:** Full codebase after the on-chain rebuild + AI assistant + editor
features + global network switching.

> ⚠️ This report supersedes the earlier review (commit `6aa663d`, 2026-06-05),
> which graded the app a "front-end-only MVP … nothing touches a blockchain."
> That is **no longer true.** Every one of that review's core criticisms —
> no chain, no wallet library, fake deploys, no persistence — has since been
> resolved. The notes below describe the app as it stands today.

---

## 1. Executive Summary

DevStation is a **working, on-chain developer console for the QIE blockchain**
(EVM L1; Testnet 1983 / Mainnet 1990), combining two products and an AI layer:

- **LaunchKit** — a Solidity contract editor that **compiles in the browser**
  (a `solc` Web Worker, OpenZeppelin imports resolved from CDN), **deploys with
  the user's wallet** (wagmi/viem), runs a **static-analysis inspector**, and
  offers a **post-deploy read/write contract interaction** panel.
- **Routebook** — a **live** transaction inspector that decodes any QIE tx hash
  server-side via RPC into a call tree, token transfers, approvals, and revert
  reasons, with an on-chain contract-label registry.
- **AI assistant ("Code with AI")** — a streaming chat embedded in the editor
  and a standalone page: write/explain/debug Solidity, one-click "Fix with AI"
  from compiler errors, and diff-gated "apply to file."

The hard 80% — chain integration, in-browser compilation, a real wallet,
persistence, deployed registries — is built and **verified on Testnet**. What
remains is hardening (tests/CI), the Mainnet registry rollout, and polish.

| Dimension | Rating | Note |
| --- | --- | --- |
| Build / type safety | ★★★★★ | `tsc --noEmit`, `eslint`, and `vite build` all clean |
| Real functionality | ★★★★☆ | On-chain deploy, live decode, real wallet, AI — all working |
| Architecture | ★★★★☆ | Single sources of truth (network, chains, storage); clean hooks |
| Design system | ★★★★☆ | Cohesive terminal/amber/teal theme, semantic tokens |
| Testing | ☆☆☆☆☆ | No unit/integration tests, no CI |
| Production readiness | ★★★☆☆ | Testnet-ready; Mainnet registry + tests pending |

---

## 2. What the App Does

### LaunchKit
- **Contract Editor** (`/launchkit/editor`) — Monaco + Solidity highlighting, a
  localStorage-persisted workspace, browser `solc` (0.7–0.8.26), a colored
  terminal, and **auto-compile** 800 ms after typing.
- **OpenZeppelin imports** — `import "@openzeppelin/contracts/..."` resolves
  recursively from the jsDelivr CDN (pinned v5.0.2), cached, with
  resolved/failed feedback in the terminal. No backend needed.
- **Static Analysis Inspector** — after a successful compile, 12 regex checks
  (SA001–SA012: SPDX, floating pragma, `tx.origin`, `selfdestruct`, unchecked
  low-level calls, reentrancy, precision loss, zero-address, pre-0.8 overflow,
  unbounded loops, hardcoded amounts, missing events). Results appear both as
  `[Inspector]` terminal lines and as clickable cards in an **Inspector tab**
  that jump to the offending line in Monaco.
- **Deploy** — compile → constructor form from the ABI → `useDeployContract`
  → receipt → recorded to the on-chain `ProjectRegistry` (+ localStorage).
- **Contract Interaction** — post-deploy (and from the Projects page), a
  read/write/events UI generated from the ABI: reads via `useReadContract`,
  writes via `useWriteContract` + receipt tracking, typed per-parameter inputs,
  and formatted results (address/uint(+≈ether)/bool/bytes/tuple).
- **Templates** (`/launchkit/templates`) and **Projects** (`/launchkit/projects`,
  on-chain + local, with Testnet/Mainnet badges).

### Routebook
- **Inspector** (`/routebook/$txHash`) — live decode across both chains via a
  `createServerFn` over QIE RPC: call tree, ERC-20 movements, approval risk,
  human-readable revert reasons.
- **Label registry** (`/routebook/labels`) — writes to the on-chain
  `ContractLabelRegistry`.

### AI assistant
- Three modes (`src/lib/ai.ts` + `ai-settings.ts`): **server proxy** (`/api/ai`,
  key stays server-side, set `VITE_AI_PROXY` + a server key), **direct Claude**
  (Messages API), and **direct OpenAI-compatible** (BYO key). Token streaming
  (SSE) for all; persisted multi-session chat history; "Fix with AI" pipes
  compile errors + source into chat; "use code" applies behind a real line diff.

### Global network
- A single persisted preference (`useNetworkPref`/`useActiveChain`) is
  **selection-authoritative**: it drives every read regardless of the wallet's
  chain. A global Mainnet warning banner, a wallet-mismatch modal that blocks
  deploys on the wrong chain, and a network-aware "get QIE for gas" link
  (faucet on testnet, DEX on mainnet).

---

## 3. Technology Stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start + Router (SSR, file-based, server routes) |
| UI | React 19, Tailwind v4, shadcn/Radix |
| Web3 | viem + wagmi 2.x (injected/MetaMask/EIP-6963 + in-app burner) |
| Editor | Monaco + browser `solc` Web Worker |
| AI | OpenAI-compatible + native Anthropic, streaming via SSE |
| State | Zustand (network, chat, workspace, burner, UI), TanStack Query |
| Build | Vite 7, Bun, Nitro (host-aware Vercel/Netlify presets) |

~15k LOC under `src` (a large share is unused shadcn primitives in
`components/ui/`).

---

## 4. Verified Build Health

- `npx tsc --noEmit` → exit 0
- `npx eslint` → exit 0
- `NODE_OPTIONS=--max-old-space-size=4096 vite build` → exit 0 (host-aware SSR
  output; `/api/ai` server route registered)
- `grep -rn rpc1testnet src/` → only `src/lib/chains.ts` (no stray hardcoded
  endpoints)
- Static-analysis engine unit-checked directly (bun): unchecked `.call` → SA005,
  reentrancy → SA006, clean contract → no findings.

**Registries deployed + verified on QIE Testnet (1983):**
`ProjectRegistry 0x75d7…a27b`, `ContractLabelRegistry 0x1772…4748`.
Mainnet (1990) not yet deployed.

---

## 5. Architecture Notes

**Strengths**
- **Single sources of truth.** `chains.ts` (env-driven RPC/explorer/faucet/DEX),
  `useActiveChain` (network), `storage.ts` (persistence). The legacy hardcoded
  `chain.ts` singleton was removed.
- **Browser-only compile** is the right call for a Cloudflare-Workers host (no
  server-side `solc`); imports are pre-resolved into the solc input.
- **Honest key handling.** `.env.local`/`.env*` gitignored; the deployer key and
  AI keys never enter the repo or client bundle (server proxy path available for
  shared deploys).
- **SSR correctness.** Host-aware Nitro preset + catch-all so deep links don't
  404; stores hydrate post-mount to avoid hydration mismatches.

**Weaknesses / risks**
1. **No tests, no CI.** The single biggest gap for a tool that deploys contracts
   and signs transactions. At minimum, a GitHub Action running typecheck + lint
   + build on PR, plus unit tests for `staticAnalysis`, `abiArgParser`, `diff`,
   and the SSE parser.
2. **Mainnet registries not deployed.** Projects/labels fall back to localStorage
   on Mainnet until `contracts:deploy mainnet` is run.
3. **Client-side BYO keys by design.** Acceptable for a personal console; the
   server proxy mitigates for shared deploys. The in-app wallet is encrypted
   (AES-GCM + PBKDF2) — fine for testnet, not for large Mainnet balances.
4. **Wallet-dependent flows not automatically tested.** Deploy, network switch,
   and contract writes are wired and build-clean but require a real wallet to
   exercise end-to-end.
5. **Bundle weight.** Wallet SDKs (metamask-sdk ~622 KB) are pulled into the SSR
   bundle; could be trimmed by keeping wallet code client-only.

---

## 6. Recommendations (priority order)

1. **Add CI** — typecheck/lint/build on PR; then unit tests for the pure logic
   modules (`staticAnalysis`, `abiArgParser`, `diff`, SSE parsing) and the
   network-resolution rules.
2. **Deploy the Mainnet registries** and set the `VITE_*_REGISTRY_ADDRESS` vars.
3. **Manually verify the wallet flows** once (connect, switch network, deploy,
   read/write a deployed contract, mismatch modal) — these are the only paths a
   headless build can't cover.
4. **Trim the SSR bundle** by isolating wallet libraries to the client.
5. **Optional polish** — richer chat markdown, partial-hunk (not whole-file)
   apply, OpenZeppelin import autocomplete in Monaco.

---

## 7. Conclusion

DevStation is a **real, working QIE builder console** — and now an AI-native one.
The on-chain engine, in-browser compilation, real wallet, persistence, live
transaction decoding, contract interaction, and global network switching are all
implemented and verified on Testnet, with clean type-checking and builds. The
remaining distance to a hardened v1 is **tests + CI, the Mainnet rollout, and a
one-time manual pass over the wallet flows** — not unbuilt core features.
