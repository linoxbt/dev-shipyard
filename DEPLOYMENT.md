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
- [Sponsored deploys (QIE mainnet)](#sponsored-deploys-qie-mainnet)
- [X Layer (temporarily disabled)](#x-layer-temporarily-disabled)

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
available. One chain doesn't run Blockscout and gets a different path instead:

| Chain | Explorer backend | DevStation Explorer |
| --- | --- | --- |
| QIE, BOT Chain, Arc, GOAT Network, Arbitrum | Blockscout | Full dashboard (blocks, txs, addresses, tokens) |
| Avalanche | Snowtrace (Routescan API) | Full dashboard, via a Routescan adapter (`src/lib/api/routescan.functions.ts`) that maps Routescan's data into the same shapes the Blockscout pages already render |

Contract **verification**, however, works on all 6 active chains:
Blockscout-backed chains verify through their own explorer; Avalanche
verifies through [Sourcify](https://sourcify.dev) instead (a free, keyless,
public verification service that recompiles from source and matches onchain
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
| QIE | Mainnet `1990` | `0x673e3d4d7f6043d0384e95ce0c110f09e09ec708` | `0xb6075e4cad1f7e7e779e49dcf7df08949797ed81` |
| BOT Chain | Testnet `968` | _not wired in_ | _not wired in_ |
| BOT Chain | Mainnet `677` | _not yet deployed_ | _not yet deployed_ |
| Arc | Testnet | _not yet deployed_ | _not yet deployed_ |
| Avalanche | Testnet / Mainnet | _not yet deployed_ | _not yet deployed_ |
| GOAT Network | Testnet / Mainnet | _not yet deployed_ | _not yet deployed_ |
| Arbitrum | Testnet / Mainnet | _not yet deployed_ | _not yet deployed_ |

QIE mainnet was redeployed separately from testnet (v2 contract source — see
`contracts/ContractLabelRegistry.sol`'s `@dev` note — plus this is a distinct
deployer nonce sequence), so the two networks now have **different**
addresses, unlike the earlier coincidental match. Both `VITE_PROJECT_REGISTRY_ADDRESS_MAINNET`
and `VITE_LABEL_REGISTRY_ADDRESS_MAINNET` **must** be set wherever the app
runs against QIE mainnet (including on the hosting dashboard, then rebuild) —
without them, the app silently falls back to the old testnet-era default
address, which is still live but does not have the v2 access-control fix.

BOT Chain testnet previously had a deployed, source-verified pair
(ProjectRegistry `0x4d6267f8...`, ContractLabelRegistry `0xe36ca612...`, still
live on `scan.bohr.life` — a deployed contract can't be un-deployed from an
immutable chain), but their addresses have been removed from local config, so
DevStation no longer reads or writes them. Redeploy with the steps below and
set the two `VITE_..._BOT_TESTNET` vars again to bring that back.

When an address is unset for a network, DevStation falls back to local
history and hides the registry-backed UI (Projects, Label Registry, ecosystem
stats) for that network — nothing crashes, those features are just inactive
until (re)deployed.

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

---

## Sponsored deploys (QIE mainnet)

Optional, off by default. When `SPONSOR_PRIVATE_KEY` is set, DevStation can
broadcast a contract-deployment transaction from a server-held wallet instead
of the visitor's own — a "Gas-free deploy (DevStation pays)" checkbox appears
in LaunchKit's deploy wizard and the editor's Deploy panel, **QIE mainnet
only**. The client and server both hard-check the chain; this never applies
to testnet or any other chain family.

**This is genuinely new infrastructure, not a config toggle to flip lightly.**
Unlike `PRIVATE_KEY` above — a one-off local CLI key used only to deploy
DevStation's own registries — `SPONSOR_PRIVATE_KEY` is held live by the
running server and spends real QIE mainnet funds in response to requests.
Treat it like an exchange hot wallet.

**Abuse model (read before enabling):** there is deliberately **no
per-wallet or per-IP gate** — any visitor can request a sponsored deploy.
The only backstop is a budget model, enforced server-side on every request
(`src/routes/api.sponsor-deploy.ts`):

- `SPONSOR_MAX_GAS_PER_DEPLOY` (default `4000000`) — a hard per-deploy gas
  ceiling. The server estimates gas, pads it 4x (QIE's `eth_estimateGas` is
  documented above to lowball storage-writing calls, and a constructor is
  exactly that shape), and refuses to broadcast anything over this ceiling —
  so one deploy can't itself exceed the daily budget.
- `SPONSOR_DAILY_BUDGET_QIE` (default `5`) — a rolling 24h spend ceiling,
  computed by summing the sponsor wallet's own gas costs from the chain's
  explorer tx history (no separate database — consistent with the rest of
  this app). Sponsorship stops once spend crosses **90% of this value**,
  not 100% — the 10% headroom exists because this check isn't atomic across
  concurrent requests; it reduces, not eliminates, the chance of a burst of
  simultaneous requests overshooting the configured cap.
- Once the daily cap is hit, sponsorship auto-disables (the checkbox's
  requests start failing with `budget_exhausted`) until spend rolls off the
  24h window. The app can't lose more than roughly the configured daily
  budget per day; that whole budget could still be drained by one actor
  within minutes if they choose to.

**Ownership caveat:** the deployed contract's owner/admin is whoever the
constructor names, not automatically the requester. DevStation's own
LaunchKit templates (`src/lib/mock/templates.ts`) and AI-agent-generated
contracts (`src/lib/ai-agent.ts`) are written to take an explicit
`initialOwner`/`initialHolder`-style constructor argument set to the
requester's connected wallet — never `msg.sender`, since under sponsorship
`msg.sender` is the *sponsor* wallet, not the user. Hand-written or pasted
source has no such guarantee; the editor's Deploy panel shows a warning when
sponsoring a non-template deploy for exactly this reason.

**Registry writes are still self-paid.** Only the (expensive) contract
*creation* is sponsored — the subsequent `ProjectRegistry.recordDeployment`
and `ContractLabelRegistry.submitLabel` calls are still sent from the
requester's own wallet, same as any deploy. This is deliberate: both
registries attribute writes to `msg.sender`, so having the sponsor call them
would misattribute every sponsored deployment to the sponsor's own bucket
and break the per-wallet Projects page. In practice this is not a hard
blocker for a zero-balance visitor — both calls are already non-blocking
(`recordDeployment` is fire-and-forget, `submitLabel` failure is caught and
logged as a warning) — so a zero-balance sponsored deploy still succeeds and
shows correctly, just without an on-chain registry record until the deployer
has a little QIE for that one small follow-up write.

Enable it by setting `SPONSOR_PRIVATE_KEY` (and optionally
`SPONSOR_DAILY_BUDGET_QIE` / `SPONSOR_MAX_GAS_PER_DEPLOY`) on the host and
rebuilding — see `.env.example`.

---

## X Layer (temporarily disabled)

X Layer (OKX's L2) is **not currently active** in DevStation — it's commented
out of `src/lib/chains.ts`'s `SUPPORTED_CHAINS` and `src/lib/explorer/network.ts`'s
slug maps, not deleted, so it doesn't appear in the wallet's network switcher
or the Explorer dropdown. Reason: its explorer (OKLink) requires a registered
`OK-ACCESS-KEY` API key DevStation doesn't have (confirmed: OKLink's API
401s without one), so the only thing it could offer today is a minimal
RPC-only page — commented out rather than shipped as a half-working chain.

| Property | Testnet | Mainnet |
| --- | --- | --- |
| Chain ID | `1952` | `196` |
| Native token | OKB | OKB |
| RPC | `testrpc.xlayer.tech/terigon` | `rpc.xlayer.tech` |
| Explorer | `oklink.com/xlayer-testnet` | `oklink.com/xlayer` |
| Env vars | `VITE_XLAYER_TESTNET_{RPC,EXPLORER,CHAIN_ID}` | `VITE_XLAYER_MAINNET_{RPC,EXPLORER,CHAIN_ID}` |

To re-enable once an OKLink key is available: uncomment `xlayerTestnet`/
`xlayerMainnet` in `SUPPORTED_CHAINS` (`chains.ts`) and the matching import,
`NetworkSlug` entries, `SLUG_CHAIN_ID` entries, and `EXPLORER_CHAIN_FAMILIES`
entry in `network.ts` — each spot has a comment marking exactly what to
restore. Verification (Sourcify) and the registry-deploy script already
support X Layer unchanged, since neither depends on it being in
`SUPPORTED_CHAINS`.
