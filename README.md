# DevStation — QIE Builder Console

A real, on-chain developer console for the [QIE blockchain](https://qie.digital). DevStation unifies two tools:

- **LaunchKit** — a Solidity contract editor + template gallery that **compiles in your browser** and **deploys to QIE** with your wallet.
- **Routebook** — a transaction inspector that turns any QIE transaction hash into a readable execution map (calls, token movements, approvals, revert reasons, gas).

It connects to **QIE Wallet** / MetaMask, includes an in-app password-encrypted dev wallet, reads live network data from QIE RPC, and records deployments + contract labels in on-chain registries.

> Built on the TanStack Start template (originally scaffolded with Lovable). Now fully wired to the chain — no mock data on the critical paths.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Quick start (local)](#quick-start-local)
- [Environment variables](#environment-variables) ← **read this before deploying**
- [On-chain registries (deployed addresses)](#on-chain-registries)
- [Deploying the registry contracts yourself](#deploying-the-registry-contracts-yourself)
- [Deploying the app](#deploying-the-app)
  - [Vercel](#vercel)
  - [Netlify](#netlify)
  - [Why "Page not found" / blank render happens (and the fix)](#why-page-not-found--blank-render-happens-and-the-fix)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Security notes](#security-notes)

---

## Features

### LaunchKit
- **Contract Editor** (`/launchkit/editor`) — Monaco editor with Solidity highlighting + autocomplete, a file explorer (workspace persisted to `localStorage`), a resizable terminal with colored compiler output, and **in-browser compilation** via a `solc` Web Worker (no backend needed). Pick any solc 0.7–0.8.26.
- **Deploy panel** — compile, fill constructor args from the ABI, and deploy with the connected wallet. Switch between QIE Testnet/Mainnet; deployments are recorded to the on-chain ProjectRegistry.
- **Template gallery** (`/launchkit/templates`) — ready-to-deploy contract templates with source + ABI viewers.
- **Projects** (`/launchkit/projects`) — your deployments, merged from the on-chain registry and local history.

### Routebook
- **Transaction inspector** (`/routebook`) — paste any QIE tx hash; it's decoded server-side via QIE RPC into an execution tree, ERC-20 transfers, approvals (with risk flags), and a human-readable revert reason on failure.
- **Label registry** (`/routebook/labels`) — human-readable names for contracts; submissions write to the on-chain ContractLabelRegistry.

### Wallet
- **QIE Wallet / MetaMask** via injected (EIP-6963) discovery — no SDK required.
- **In-app generated wallet** — a self-custody dev wallet whose mnemonic is **password-encrypted** (AES-GCM + PBKDF2, Web Crypto) and stored only in your browser. View the seed (behind your password), balance, and QUSDC balance in Settings.
- **Get QIE for gas** — when native balance is low, a link to the QIE DEX surfaces.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start + TanStack Router (SSR, file-based routing) |
| UI | React 19, Tailwind v4, shadcn/Radix |
| Web3 | viem + wagmi 2.x (injected/MetaMask connectors) |
| Editor | Monaco (`@monaco-editor/react`) + browser `solc` Web Worker |
| State / data | Zustand, TanStack Query, `localStorage` persistence |
| Build/runtime | Vite 7, Bun, Nitro (deploy-target presets) |

---

## Quick start (local)

Requires [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env.local   # optional — sensible defaults are built in
bun run dev                  # http://localhost:8080
```

Everything works with zero config against **QIE Testnet**. Set env vars (below) only to point at deployed registries, mainnet, or QUSDC.

```bash
bun run build      # production build (auto-detects Vercel/Netlify; else Vercel preset)
bun run lint
bun run format
```

---

## Environment variables

All client-readable vars use the **`VITE_`** prefix (Vite inlines them into the browser bundle at **build time** — so on hosted deploys you must set them in the host's dashboard and **rebuild**, not just at runtime).

Copy `.env.example` → `.env.local` for local dev. **`.env.local` is gitignored — never commit it.**

### Network (optional — defaults match QIE docs)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_QIE_TESTNET_RPC` | `https://rpc1testnet.qie.digital/` | QIE Testnet RPC endpoint |
| `VITE_QIE_TESTNET_EXPLORER` | `https://testnet.qie.digital` | Testnet explorer base URL |
| `VITE_QIE_TESTNET_CHAIN_ID` | `1983` | Testnet chain id |
| `VITE_QIE_MAINNET_RPC` | `https://rpc1mainnet.qie.digital/` | QIE Mainnet RPC endpoint |
| `VITE_QIE_MAINNET_EXPLORER` | `https://mainnet.qie.digital` | Mainnet explorer base URL |
| `VITE_QIE_MAINNET_CHAIN_ID` | `1990` | Mainnet chain id |
| `VITE_QIE_DEX_URL` | `https://www.swap.dex.qie.digital/swap` | "Get QIE for gas" link |

### DevStation registries (set after you deploy them — see below)

| Variable | Purpose |
| --- | --- |
| `VITE_PROJECT_REGISTRY_ADDRESS` | ProjectRegistry address. When set, Projects reads on-chain + deploys are recorded. Unset → localStorage fallback. |
| `VITE_LABEL_REGISTRY_ADDRESS` | ContractLabelRegistry address. When set, label submissions write on-chain. Unset → local/mock. |

### QIE ecosystem (optional)

| Variable | Purpose |
| --- | --- |
| `VITE_QUSDC_ADDRESS` | QUSDC (QIE stablecoin) token address. When set, the wallet shows a read-only QUSDC balance. Get it from <https://docs.stable.qie.digital> / the explorer. |
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional. Reserved for WalletConnect; injected wallets (QIE Wallet/MetaMask) work without it. |

### Server-only (NOT a `VITE_` var, NEVER committed or set on the host)

| Variable | Purpose |
| --- | --- |
| `PRIVATE_KEY` | Used **only** by `scripts/deploy.ts` to deploy the registry contracts from your machine. Lives in `.env.local`. **Do not** add this to Vercel/Netlify — the app never needs it. |

### Build-only (CI/host, optional)

| Variable | Purpose |
| --- | --- |
| `NITRO_PRESET` | Override the deploy target preset (`vercel`, `netlify`, `node-server`, `cloudflare-module`, `bun`). Auto-detected on Vercel/Netlify; defaults to `vercel` for manual builds. |

---

## On-chain registries

Currently deployed on **QIE Testnet (chain 1983)**:

| Contract | Address |
| --- | --- |
| ProjectRegistry | `0x75d7b39bc827367c409e1a2bf805bd5f337ca27b` |
| ContractLabelRegistry | `0x177294293e6e785a83e036a95de1697e3cc04748` |

Set these as `VITE_PROJECT_REGISTRY_ADDRESS` / `VITE_LABEL_REGISTRY_ADDRESS` to enable on-chain reads/writes. (Mainnet not yet deployed.)

---

## Deploying the registry contracts yourself

The two registries (`contracts/*.sol`) are dependency-free Solidity 0.8.x. See **[DEPLOY.md](./DEPLOY.md)** for full detail. Short version:

```bash
# 1. Put your funded deployer key in .env.local (gitignored):
#    PRIVATE_KEY=0x...
bun run contracts:compile      # solc → contracts/out/*.json + src/lib/abis/*.ts
bun run contracts:deploy       # testnet (chain 1983)
bun run contracts:deploy mainnet   # mainnet (chain 1990) — spends real QIE
```

The script prints the `VITE_*` address lines to paste into your env.

---

## Deploying the app

This is an **SSR app** (server-rendered routes), not a static SPA. The single most important thing: **every route must fall through to the SSR server function**, or deep links and refreshes return "Page not found".

The build auto-detects the host (`vite.config.ts`) and selects the matching Nitro preset, which emits the host's expected output + routing. Both hosts below are wired and tested.

> In CI with limited memory the build may need more heap: `NODE_OPTIONS=--max-old-space-size=4096 bun run build`. Vercel/Netlify builders have ample memory by default.

### Vercel

Config is in `vercel.json`. Vercel sets `VERCEL=1`, so the build uses the `vercel` Nitro preset and emits `.vercel/output` (static client + an SSR function with a catch-all route).

1. Import the repo at <https://vercel.com/new>.
2. Build command `bun run build`, install `bun install`, framework **Other** (set by `vercel.json`).
3. **Project → Settings → Environment Variables**: add the `VITE_*` vars you need (registry addresses, mainnet, QUSDC). **Do not** add `PRIVATE_KEY`.
4. Deploy. Because `VITE_*` vars are inlined at build time, **redeploy after changing them**.

### Netlify

Config is in `netlify.toml` + `public/_redirects`. Netlify sets `NETLIFY=true`, so the build uses the `netlify` preset (SSR function → `.netlify/functions-internal/server`, client → `dist/`). The `_redirects` rule rewrites every non-static path to the SSR function.

1. **New site from Git** at <https://app.netlify.com>.
2. These are picked up from `netlify.toml` automatically:
   - Build command: `bun run build`
   - Publish directory: `dist`
   - Functions directory: `.netlify/functions-internal`
3. **Site configuration → Environment variables**: add your `VITE_*` vars. **Do not** add `PRIVATE_KEY`.
4. If Bun isn't auto-detected, set env var `NETLIFY_USE_BUN=true` (or add a `.bun-version` file). Netlify supports Bun on recent build images.
5. Deploy, then **clear cache and redeploy** after changing any `VITE_*` var.

#### How to redeploy on Netlify

- **Easiest:** push a commit — Netlify auto-builds on every push to the production branch. After `git push`, a new deploy starts automatically.
- **From the dashboard:** **Deploys → Trigger deploy → Deploy site** (or **Clear cache and deploy site** — use this after changing env vars so the new `VITE_*` values are inlined).
- **CLI:** `netlify deploy --build --prod` (with the [Netlify CLI](https://docs.netlify.com/cli/get-started/) installed and the site linked via `netlify link`).

### Why "Page not found" / blank render happens (and the fix)

The Lovable base config defaults the build to a **Cloudflare Workers** output layout. On Vercel/Netlify that produces a static client with **no SSR function wired and no catch-all redirect** — so the host serves `dist/` (which has no `index.html` for an SSR app), every deep link / refresh 404s, and the app appears not to render.

The fix is in this repo:

- `vite.config.ts` selects the Nitro **`vercel`/`netlify` preset** based on the host's build env var.
- `vercel.json` (Vercel) and `netlify.toml` + `public/_redirects` (Netlify) wire the publish dir, functions dir, and the **catch-all route to the SSR function** so every path is server-rendered.

If you fork to a different host, set `NITRO_PRESET` and add that host's equivalent catch-all rewrite to the server function.

---

## Project structure

```
contracts/            ProjectRegistry.sol, ContractLabelRegistry.sol (+ out/ artifacts)
scripts/              compile.ts (solc), deploy.ts (viem)
src/
  routes/             file-based routes (TanStack). __root.tsx is the app shell.
  components/
    editor/           Monaco editor, terminal, deploy panel
    web3/             wallet provider, connect modal, generate-wallet dialog
    layout/ shared/   sidebar, app shell, logo, primitives
  lib/
    chains.ts         QIE testnet/mainnet viem chains + DEX URL
    contracts.ts      env-backed registry/QUSDC addresses
    wagmi.ts          wagmi config (injected/MetaMask/burner)
    burner/           in-app encrypted wallet (vault, connector, store)
    compiler*.ts      browser solc Web Worker + interface
    api/              server functions (network status, tx decode)
    abis/             generated registry ABIs + bytecode
  hooks/              useProjectRegistry, useContractLabels, useChainData, useQusdc, useWorkspace
vercel.json           Vercel SSR config
netlify.toml          Netlify SSR config
public/_redirects     Netlify SSR catch-all
```

---

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Dev server (http://localhost:8080) |
| `bun run build` | Production build (host-aware preset) |
| `bun run preview` | Preview the production build |
| `bun run lint` / `bun run format` | ESLint / Prettier |
| `bun run contracts:compile` | Compile registries → ABIs + artifacts |
| `bun run contracts:deploy [mainnet]` | Deploy registries (testnet default) |

---

## Security notes

- **`.env.local`, `.env*`, and `deployment-output.json` are gitignored.** The deployer private key never enters the repo, the client bundle, or the host env.
- The in-app generated wallet's mnemonic is **encrypted with your password** (AES-GCM + PBKDF2) before touching `localStorage`, and is only ever revealed behind a password prompt. Browser-stored keys are fine for testnet and small balances — for significant mainnet funds, use a hardware wallet via the injected connector instead.
- Never set `PRIVATE_KEY` in Vercel/Netlify env — the running app has no use for it.
```
