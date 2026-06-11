# DevStation

**The developer console for QIE Blockchain.** Deploy. Debug. Analyze. Inspect.

DevStation is a complete, onchain developer console for the [QIE blockchain](https://qie.digital). It brings the everyday work of a smart-contract developer into one place: write and compile Solidity in the browser, deploy audited templates, generate and deploy contracts with an AI agent, decode any transaction, browse the chain with a built-in block explorer, and label contracts onchain. Everything runs against the live QIE network, and the records that matter (your deployments and the contract label registry) live onchain, not in a private database.

- **Live app:** <https://devstation.online>
- **Networks:** QIE Testnet (chain `1983`) and QIE Mainnet (chain `1990`)

> Originally scaffolded on a TanStack Start template. Now fully wired to the chain: real RPC reads, real deployments, real onchain registries, no mock data on the critical paths.

---

## Table of contents

- [What's inside](#whats-inside)
- [Feature tour](#feature-tour)
  - [LaunchKit](#launchkit)
  - [Routebook](#routebook)
  - [QIE Explorer](#qie-explorer)
  - [AI assistant](#ai-assistant)
  - [Wallets](#wallets)
- [Onchain registries](#onchain-registries)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Known limitations](#known-limitations)
- [License](#license)

---

## What's inside

| Area | What it does |
| --- | --- |
| **LaunchKit** | Deploy audited contract templates, write and compile Solidity in the browser, and generate, audit, and deploy contracts with an AI agent. |
| **Routebook** | Decode any QIE transaction into a readable call tree with internal calls, events, and onchain contract labels. |
| **QIE Explorer** | A native, Etherscan-style block explorer for blocks, transactions, addresses, tokens, and holders, on both networks. |
| **Onchain registries** | A ProjectRegistry records every deployment, and a ContractLabelRegistry gives contracts human-readable names. |
| **Docs** | A built-in, multi-page documentation section at `/docs`. |

---

## Feature tour

### LaunchKit

- **Template gallery** (`/launchkit/templates`): self-contained, audited templates (ERC20, ERC721, Soulbound NFT, MultiSig, Timelock, Vesting, Staking, Payment Splitter) with source and ABI viewers. Each card shows its real onchain deploy count, read from the ProjectRegistry's transaction history.
- **Contract Editor** (`/launchkit/editor`): a Monaco editor with Solidity highlighting, a file workspace persisted to `localStorage`, a colored compiler terminal with an interactive command prompt, and **in-browser compilation** via a `solc` Web Worker (no backend). Picks any solc 0.7 to 0.8.26 and resolves external imports (for example OpenZeppelin) from a CDN.
- **Code with AI** (`/launchkit/ai`): two modes. In **Chat**, the assistant writes secure, production-grade Solidity and audits contracts you paste, graded by severity; generated code blocks open straight in the Contract Editor. In **Agent** mode it goes autonomous: describe a contract, and it generates the source, compiles it in the browser, fixes its own compiler errors (up to five attempts), then deploys with your connected wallet, showing a constructor-argument form to review before you sign. See [AI assistant](#ai-assistant).
- **Deploy** (`/launchkit/deploy`): a guided flow generated from a template's constructor. DevStation validates and encodes the arguments, compiles in a browser worker, sends the creation transaction through your wallet, and records the deployment onchain. The success screen links straight into Routebook and the DevStation explorer.
- **Projects** (`/launchkit/projects`): a per-wallet history of everything you have deployed through DevStation, read from the onchain ProjectRegistry and merged with local history. Scoped to the connected wallet.

### Routebook

- **Transaction inspector** (`/routebook`): paste any QIE transaction hash and it decodes the call into a tree of internal calls, decoded arguments, ERC-20 transfers, approvals (with risk flags), events, and a human-readable revert reason on failure.
- **Label Registry** (`/routebook/labels`): human-readable names for contracts, stored onchain in the ContractLabelRegistry. Deploys through DevStation are auto-labeled (pre-approved); community submissions await approval.

### QIE Explorer

A native block explorer that reads the live QIE Blockscout API, scoped to the network in the URL so a link always names its chain:

- `/explorer/testnet` and `/explorer/mainnet` (the bare `/explorer` redirects to your selected network).
- **Dashboard:** QIE price, market cap, average block time, total blocks and transactions, gas price, network utilization, plus live latest-blocks and latest-transactions feeds and a universal search (address, transaction hash, or block number).
- **Transaction page:** status, block and confirmations, timestamp, from and to, token transfers, value, fee, gas price, gas usage, EIP-1559 fees, nonce, event logs, and decoded or raw input data.
- **Block page:** height with prev/next, miner, reward, gas used and limit, base fee, burnt fees, size, hashes, and the block's transactions.
- **Address page:** balance and fiat value, counters, creator, and tabs for Transactions, Token Transfers, Tokens held, Internal Txns, Logs, and (for contracts) verified Contract source.
- **Token page:** supply, holders, transfers, decimals, with ranked holders and ownership percentages.

A prominent Testnet/Mainnet badge in the header makes the active chain unmistakable. Every in-app explorer reference points to this built-in explorer.

### AI assistant

The Solidity assistant works in two modes, resolved from Settings:

- **Server proxy** (`/api/ai`): the provider key stays server-side and never reaches the browser. Preferred for shared deployments.
- **Direct, bring-your-own-key:** you paste a key in the UI; it is stored only in your browser.

Supported providers (pick one, paste a key, save):

| Provider | Format | Notes |
| --- | --- | --- |
| OpenAI | OpenAI | `gpt-4o`, `gpt-4.1`, `o4-mini`, and more. |
| Claude (Anthropic) | Anthropic native | `claude-opus-4-x`, `claude-sonnet-4-x`, `claude-haiku-4-x`. |
| OpenRouter | OpenAI-compatible | Access many models with one key. |

### Wallets

- **QIE Wallet / MetaMask** via injected (EIP-6963) discovery, no SDK required.
- **In-app generated wallet:** a self-custody dev wallet whose mnemonic is **password-encrypted** (AES-GCM + PBKDF2, Web Crypto) and stored only in your browser.
- Connections survive page refreshes and are cleared only on disconnect, browser-data clear, or closing the browser. The selected network (not the wallet's current chain) drives reads everywhere; write flows prompt you to switch when the two differ.
- A "get QIE for gas" link surfaces when the native balance is low.

---

## Onchain registries

Two dependency-free Solidity contracts back the app. They are deployed on **both** networks (the deployer's matching nonces produced identical addresses on each chain):

| Contract | Address | Networks |
| --- | --- | --- |
| ProjectRegistry | `0x75d7b39bc827367c409e1a2bf805bd5f337ca27b` | Testnet `1983`, Mainnet `1990` |
| ContractLabelRegistry | `0x177294293e6e785a83e036a95de1697e3cc04748` | Testnet `1983`, Mainnet `1990` |

- **ProjectRegistry** records every deployment against the deploying wallet and keeps a global `totalDeployments` counter. It powers the per-wallet Projects page, the ecosystem stats on the Overview (total deployments and total unique deployers), and per-template deploy counts.
- **ContractLabelRegistry** stores human-readable labels with a source (auto, community, or verified) and the submitter.

Registry writes use an explicit gas limit, because QIE's `eth_estimateGas` under-reports the gas a storage-writing call needs (it can return roughly 24k for a call that actually uses about 275k), which would otherwise run the write out of gas. At QIE's gas price this costs a negligible fraction of a QIE.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start + TanStack Router (SSR, file-based routing) |
| UI | React 19, Tailwind v4, Radix primitives |
| Web3 | viem + wagmi 2.x (injected/MetaMask + in-app burner connectors) |
| Editor | Monaco (`@monaco-editor/react`) + browser `solc` Web Worker |
| State / data | Zustand, TanStack Query, `localStorage` persistence |
| Explorer data | QIE Blockscout v2 API via a chain-scoped server proxy |
| Build / runtime | Vite 7, Bun, Nitro (host-aware deploy presets) |

---

## Quick start

Requires [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env.local   # optional: sensible defaults are built in
bun run dev                  # http://localhost:8080
```

Everything works with zero config against QIE Testnet. Set env vars (below) to point at deployed registries, enable mainnet onchain features, or configure AI.

```bash
bun run build      # production build (auto-detects Vercel/Netlify; else Vercel preset)
bun run lint
bun run format
```

---

## Configuration

All client-readable vars use the **`VITE_`** prefix. Vite inlines them into the browser bundle at **build time**, so on a hosted deploy you set them in the host dashboard and **rebuild** (changing them at runtime has no effect). Copy `.env.example` to `.env.local` for local dev. **`.env.local` is gitignored; never commit it.**

### Network (optional)

Defaults match the QIE docs, so these are only needed to override an endpoint.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_QIE_TESTNET_RPC` | `https://rpc1testnet.qie.digital/` | Testnet RPC |
| `VITE_QIE_TESTNET_EXPLORER` | `https://testnet.qie.digital` | Testnet explorer base |
| `VITE_QIE_TESTNET_CHAIN_ID` | `1983` | Testnet chain id |
| `VITE_QIE_MAINNET_RPC` | `https://rpc1mainnet.qie.digital/` | Mainnet RPC |
| `VITE_QIE_MAINNET_EXPLORER` | `https://mainnet.qie.digital` | Mainnet explorer base |
| `VITE_QIE_MAINNET_CHAIN_ID` | `1990` | Mainnet chain id |
| `VITE_QIE_DEX_URL` | `https://www.swap.dex.qie.digital/swap` | "Get QIE for gas" link |

### Registries (per network)

Registries are deployed separately per chain, so the addresses are per-network. The legacy single-value vars (no suffix) are still read as the testnet fallback.

| Variable | Purpose |
| --- | --- |
| `VITE_PROJECT_REGISTRY_ADDRESS_TESTNET` | ProjectRegistry on testnet |
| `VITE_PROJECT_REGISTRY_ADDRESS_MAINNET` | ProjectRegistry on mainnet |
| `VITE_LABEL_REGISTRY_ADDRESS_TESTNET` | ContractLabelRegistry on testnet |
| `VITE_LABEL_REGISTRY_ADDRESS_MAINNET` | ContractLabelRegistry on mainnet |

When an address is set for a network, that network's onchain features (Projects, Label Registry, ecosystem and template stats) are active; when unset, the app falls back to local history and hides the registry-backed UI.

### AI assistant (optional)

The AI provider, model, and key are chosen in the app's Settings and stored in the browser, so no env var is required for bring-your-own-key use. For the server-proxy mode, configure a server-side key and set:

| Variable | Purpose |
| --- | --- |
| `VITE_AI_PROXY` | `"true"` to route AI requests through the `/api/ai` server proxy |
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Server-side provider key for the proxy (no `VITE_` prefix, so it never ships to the browser) |

### QIE ecosystem (optional)

| Variable | Purpose |
| --- | --- |
| `VITE_QUSDC_ADDRESS` | QUSDC (QIE stablecoin) token address. When set, the wallet shows a read-only QUSDC balance. |

### Server-only

| Variable | Purpose |
| --- | --- |
| `PRIVATE_KEY` | Used **only** by `scripts/deploy.ts` to deploy the registry contracts from your machine. Lives in `.env.local`. **Never** add it to a host: the running app has no use for it. |
| `NITRO_PRESET` | Override the deploy-target preset (`vercel`, `netlify`, `node-server`, `cloudflare-module`, `bun`). Auto-detected on Vercel/Netlify. |

---

## How it works

- **Onchain by default.** Deployments are recorded in the ProjectRegistry and contract names live in the ContractLabelRegistry, so the data is auditable and portable rather than locked in a private database. The Projects page reads `getDeployments(yourWallet)`; the Overview reads the global counter and derives unique deployers from the registry's transaction history.
- **Compilation in the browser.** Solidity is compiled by a real `solc` build loaded in a Web Worker. There is no server compile step and nothing to install.
- **Explorer via a server proxy.** The QIE Explorer reads the Blockscout v2 API through a chain-scoped server function. Fetching server-side avoids browser CORS limits and keeps the explorer working under SSR. The proxy validates the request path against the known Blockscout namespace, so it cannot be used to fetch arbitrary URLs.
- **SSR everywhere.** Routes are server-rendered, so deep links and refreshes resolve correctly through the SSR server function.

---

## Project structure

```
contracts/              ProjectRegistry.sol, ContractLabelRegistry.sol (+ out/ artifacts)
scripts/                compile.ts (solc), deploy.ts (viem, per-network)
src/
  routes/               file-based routes (TanStack). __root.tsx is the app shell.
    explorer.$network.* network-scoped block explorer (dashboard, tx, block, address, token, lists)
    launchkit.*         templates, editor, AI, deploy, projects
    routebook.*         transaction inspector + label registry
    docs.*              multi-page documentation
  components/
    explorer/           explorer UI, lists, search, formatters
    editor/             Monaco editor, terminal, deploy panel, contract interactor
    ai/                 chat + autonomous agent surfaces
    deploy/             post-deploy verification + actions
    web3/ layout/ shared/ docs/  wallet, app shell, primitives, docs primitives
  lib/
    chains.ts           QIE testnet/mainnet viem chains + DEX URL
    contracts.ts        per-network registry addresses + write gas limit
    explorer/           network slug mapping, formatters, Blockscout types
    ai-settings.ts ai.ts ai-agent.ts  AI providers, endpoint resolution, streaming client, agent protocol
    burner/             in-app encrypted wallet (vault, connector, store)
    compiler*.ts        browser solc Web Worker + interface
    api/                server functions (network status, ecosystem stats, explorer proxy, verify, ai)
    abis/               generated registry ABIs + bytecode
  hooks/                useProjectRegistry, useContractLabels, useExplorer, useTemplateDeploys, useCodeAgent, ...
vercel.json             Vercel SSR config
netlify.toml            Netlify SSR config
public/_redirects       Netlify SSR catch-all
```

---

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Dev server (http://localhost:8080) |
| `bun run build` | Production build (host-aware preset) |
| `bun run preview` | Preview the production build |
| `bun run lint` / `bun run format` | ESLint / Prettier |
| `bun run contracts:compile` | Compile registries to ABIs + artifacts |
| `bun run contracts:deploy [mainnet]` | Deploy registries (testnet by default) |

---

## Known limitations

- **Contract verification** is implemented (the deploy flow and Projects page submit flattened source to the QIE explorer's Blockscout verifier), but the QIE explorer's verifier service may not always confirm a submission. When that happens the contract still works and is fully usable; the verification request is correct and completes once the explorer service accepts it.
- The QIE network's `eth_estimateGas` is unreliable for storage-writing calls; DevStation pins explicit gas limits on registry writes to work around it.

---

## License

DevStation is released under the [MIT License](./LICENSE).
