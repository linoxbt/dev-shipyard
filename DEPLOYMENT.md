# Deployment & Network Reference

Hosting steps and the full per-chain network/registry configuration for
DevStation, split out of the [README](./README.md) so that stays focused on
what the app does. Come here for: deploying to Vercel/Netlify, every chain's
RPC/explorer/chain-id env vars, and the onchain registry addresses deployed
so far.

---

## Table of contents

- [Hosting](#hosting)
- [Network configuration](#network-configuration)
- [Registry contract addresses](#registry-contract-addresses)
- [Deploying registries to a new chain](#deploying-registries-to-a-new-chain)

---

## Hosting

DevStation is a TanStack Start (Nitro) SSR app. `bun run build` auto-detects
the host from the environment (Vercel, Netlify) and falls back to the Vercel
preset otherwise.

```bash
bun run build      # production build (host-aware preset)
bun run preview    # preview the production build locally
```

Override the target explicitly with `NITRO_PRESET` (`vercel`, `netlify`,
`node-server`, `cloudflare-module`, `bun`) if a host's build environment
doesn't set the auto-detection variable it needs.

### Vercel

`vercel.json` pins the build/install commands and disables Vercel's framework
auto-detection (it would otherwise misidentify the TanStack/Vite setup):

```json
{
  "buildCommand": "bun run build",
  "installCommand": "bun install",
  "framework": null
}
```

### Netlify

`netlify.toml` points Netlify at the Nitro SSR function output and static
client, since the default `dist/`-only assumption 404s every route on this
setup:

- `[build]` — `command = "bun run build"`, `publish = "dist"`.
- `[build.environment]` — `NODE_OPTIONS=--max-old-space-size=8192` (this
  app's dependency graph — wagmi, WalletConnect, Coinbase/MetaMask SDKs,
  Monaco — exceeds Node's default ~2 GB old-space heap during Nitro's final
  bundling step without this) and `NITRO_PRESET=netlify` (pinned so a stray
  build command can't fall back to the wrong preset).
- `[functions]` — `directory = ".netlify/functions-internal"`,
  `node_bundler = "none"` (the Nitro bundle ships its own deps; don't let
  Netlify re-bundle them).
- A long-cache header for hashed `/assets/*` files.

All client-readable env vars use the **`VITE_`** prefix — Vite inlines them
into the browser bundle at **build time**, so set them in the host dashboard
and **rebuild** (changing them at runtime has no effect).

---

## Network configuration

Every chain follows the same `VITE_<FAMILY>_<NETWORK>_{RPC,EXPLORER,CHAIN_ID}`
pattern. Defaults match each chain's own docs (confirmed live via direct RPC
calls when each chain was added), so these are only needed to override an
endpoint. QIE's vars have no family infix for backward compatibility.

| Chain | Network | RPC var | Explorer var | Chain ID var | Default chain ID |
| --- | --- | --- | --- | --- | --- |
| QIE | Testnet | `VITE_QIE_TESTNET_RPC` | `VITE_QIE_TESTNET_EXPLORER` | `VITE_QIE_TESTNET_CHAIN_ID` | `1983` |
| QIE | Mainnet | `VITE_QIE_MAINNET_RPC` | `VITE_QIE_MAINNET_EXPLORER` | `VITE_QIE_MAINNET_CHAIN_ID` | `1990` |
| BOT Chain | Testnet | `VITE_BOT_TESTNET_RPC` | `VITE_BOT_TESTNET_EXPLORER` | `VITE_BOT_TESTNET_CHAIN_ID` | `968` |
| BOT Chain | Mainnet | `VITE_BOT_MAINNET_RPC` | `VITE_BOT_MAINNET_EXPLORER` | `VITE_BOT_MAINNET_CHAIN_ID` | `677` |
| X Layer | Testnet | `VITE_XLAYER_TESTNET_RPC` | `VITE_XLAYER_TESTNET_EXPLORER` | `VITE_XLAYER_TESTNET_CHAIN_ID` | `1952` |
| X Layer | Mainnet | `VITE_XLAYER_MAINNET_RPC` | `VITE_XLAYER_MAINNET_EXPLORER` | `VITE_XLAYER_MAINNET_CHAIN_ID` | `196` |
| Arc | Testnet | `VITE_ARC_TESTNET_RPC` | `VITE_ARC_TESTNET_EXPLORER` | `VITE_ARC_TESTNET_CHAIN_ID` | `5042002` |
| Avalanche | Testnet (Fuji) | `VITE_AVALANCHE_TESTNET_RPC` | `VITE_AVALANCHE_TESTNET_EXPLORER` | `VITE_AVALANCHE_TESTNET_CHAIN_ID` | `43113` |
| Avalanche | Mainnet (C-Chain) | `VITE_AVALANCHE_MAINNET_RPC` | `VITE_AVALANCHE_MAINNET_EXPLORER` | `VITE_AVALANCHE_MAINNET_CHAIN_ID` | `43114` |
| GOAT Network | Testnet (Testnet3) | `VITE_GOAT_TESTNET_RPC` | `VITE_GOAT_TESTNET_EXPLORER` | `VITE_GOAT_TESTNET_CHAIN_ID` | `48816` |
| GOAT Network | Mainnet | `VITE_GOAT_MAINNET_RPC` | `VITE_GOAT_MAINNET_EXPLORER` | `VITE_GOAT_MAINNET_CHAIN_ID` | `2345` |
| Arbitrum | Sepolia | `VITE_ARBITRUM_TESTNET_RPC` | `VITE_ARBITRUM_TESTNET_EXPLORER` | `VITE_ARBITRUM_TESTNET_CHAIN_ID` | `421614` |
| Arbitrum | One (mainnet) | `VITE_ARBITRUM_MAINNET_RPC` | `VITE_ARBITRUM_MAINNET_EXPLORER` | `VITE_ARBITRUM_MAINNET_CHAIN_ID` | `42161` |

Extras:

| Variable | Purpose |
| --- | --- |
| `VITE_QIE_DEX_URL` | "Get QIE for gas" link (default `https://www.swap.dex.qie.digital/swap`) |
| `VITE_BOT_DEX_URL` | "Get BOT for gas" link (default `https://dex.botchain.ai/#/swap`) |
| `VITE_QUSDC_ADDRESS` | QUSDC (QIE stablecoin) token address; when set, the wallet shows a read-only QUSDC balance |

### Explorer availability per chain

DevStation's built-in Explorer reads a chain's own Blockscout v2 API where
available. Two chains don't run Blockscout and get a different path instead:

| Chain | Explorer backend | DevStation Explorer |
| --- | --- | --- |
| QIE, BOT Chain, Arc, GOAT Network, Arbitrum | Blockscout | Full dashboard (blocks, txs, addresses, tokens) |
| Avalanche | Snowtrace (Routescan API) | Full dashboard, via a Routescan adapter (`src/lib/api/routescan.functions.ts`) that maps Routescan's data into the same shapes the Blockscout pages already render |
| X Layer | OKLink (requires a registered API key DevStation doesn't have) | Minimal page: live block height/gas price via RPC, plus a link out to OKLink. Upgradeable to a full dashboard the same way Avalanche was, once a key is available |

Contract **verification**, however, works on all 7 chains: Blockscout-backed
chains verify through their own explorer; Avalanche and X Layer verify
through [Sourcify](https://sourcify.dev) instead (a free, keyless, public
verification service that recompiles from source and matches onchain
bytecode directly via its own RPC — no explorer API dependency).

---

## Registry contract addresses

Two dependency-free Solidity contracts (`contracts/ProjectRegistry.sol`,
`contracts/ContractLabelRegistry.sol`) back every chain's Projects page and
Label Registry. Each chain is a **separate deployment** — addresses are not
shared across chains. Configure them with the `VITE_{PROJECT,LABEL}_REGISTRY_ADDRESS_<FAMILY>_<NETWORK>`
vars (QIE keeps its legacy no-suffix names for backward compatibility).

| Chain | Network | ProjectRegistry | ContractLabelRegistry |
| --- | --- | --- | --- |
| QIE | Testnet `1983` | `0x75d7b39bc827367c409e1a2bf805bd5f337ca27b` | `0x177294293e6e785a83e036a95de1697e3cc04748` |
| QIE | Mainnet `1990` | `0x75d7b39bc827367c409e1a2bf805bd5f337ca27b` | `0x177294293e6e785a83e036a95de1697e3cc04748` |
| BOT Chain | Testnet `968` | `0x4d6267f89e32018b1caef34674bcaa90e7b890d2` | `0xe36ca612abf610825a9a9f06c073d40e543b0aa0` |
| BOT Chain | Mainnet `677` | _not yet deployed_ | _not yet deployed_ |
| X Layer | Testnet / Mainnet | _not yet deployed_ | _not yet deployed_ |
| Arc | Testnet | _not yet deployed_ | _not yet deployed_ |
| Avalanche | Testnet / Mainnet | _not yet deployed_ | _not yet deployed_ |
| GOAT Network | Testnet / Mainnet | _not yet deployed_ | _not yet deployed_ |
| Arbitrum | Testnet / Mainnet | _not yet deployed_ | _not yet deployed_ |

QIE's testnet and mainnet addresses happen to match because the deployer's
matching nonces produced identical addresses on each chain — this is a
coincidence of deploy order, not something to rely on for other chains.

BOT Chain's testnet registries are also **source-verified** on
`scan.bohr.life` (solc `0.8.26`, optimizer on / 200 runs, MIT), submitted via
DevStation's own flattened-code verification flow.

When an address is unset for a network, DevStation falls back to local
history and hides the registry-backed UI (Projects, Label Registry, ecosystem
stats) for that network — nothing crashes, those features are just inactive
until deployed.

---

## Deploying registries to a new chain

```bash
bun run contracts:compile                       # compile both registries
bun run contracts:deploy <family> [testnet|mainnet]   # deploy + print addresses
```

`<family>` is one of `qie` (default), `bot`, `xlayer`, `arc` (testnet only),
`avalanche`, `goat`, `arbitrum`. Requires `PRIVATE_KEY` (an unprefixed,
server-only var — **never** add it to a hosted deploy, the running app has no
use for it) set to a funded deployer key in `.env.local`.

After deploying, copy the printed addresses into the matching
`VITE_{PROJECT,LABEL}_REGISTRY_ADDRESS_<FAMILY>_<NETWORK>` vars (see the
[table above](#registry-contract-addresses)) in your host's env config, then
rebuild.
