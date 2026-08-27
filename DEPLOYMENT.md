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
- [Sponsored deploys (QIE mainnet & BOT Chain mainnet)](#sponsored-deploys-qie-mainnet--bot-chain-mainnet)
- [AI proxy setup](#ai-proxy-setup)

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

| Chain     | Network | RPC var                | Explorer var                | Chain ID var                | Default chain ID |
| --------- | ------- | ---------------------- | --------------------------- | --------------------------- | ---------------- |
| QIE       | Testnet | `VITE_QIE_TESTNET_RPC` | `VITE_QIE_TESTNET_EXPLORER` | `VITE_QIE_TESTNET_CHAIN_ID` | `1983`           |
| QIE       | Mainnet | `VITE_QIE_MAINNET_RPC` | `VITE_QIE_MAINNET_EXPLORER` | `VITE_QIE_MAINNET_CHAIN_ID` | `1990`           |
| BOT Chain | Testnet | `VITE_BOT_TESTNET_RPC` | `VITE_BOT_TESTNET_EXPLORER` | `VITE_BOT_TESTNET_CHAIN_ID` | `968`            |
| BOT Chain | Mainnet | `VITE_BOT_MAINNET_RPC` | `VITE_BOT_MAINNET_EXPLORER` | `VITE_BOT_MAINNET_CHAIN_ID` | `677`            |

Extras:

| Variable             | Purpose                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `VITE_QIE_DEX_URL`   | "Get QIE for gas" link (default `https://www.swap.dex.qie.digital/swap`)                   |
| `VITE_BOT_DEX_URL`   | "Get BOT for gas" link (default `https://dex.botchain.ai/#/swap`)                          |
| `VITE_QUSDC_ADDRESS` | QUSDC (QIE stablecoin) token address; when set, the wallet shows a read-only QUSDC balance |

### Explorer availability per chain

DevStation's built-in Explorer reads a chain's own Blockscout v2 API. Every
currently-active chain runs Blockscout:

| Chain          | Explorer backend | DevStation Explorer                             |
| -------------- | ---------------- | ----------------------------------------------- |
| QIE, BOT Chain | Blockscout       | Full dashboard (blocks, txs, addresses, tokens) |

Contract **verification** works on both chains, through each chain's own
Blockscout explorer.

---

## Registry contract addresses

Two dependency-free Solidity contracts (`contracts/ProjectRegistry.sol`,
`contracts/ContractLabelRegistry.sol`) back every chain's Projects page and
Label Registry. Each chain is a **separate deployment** — addresses are not
shared across chains. Configure them with the `VITE_{PROJECT,LABEL}_REGISTRY_ADDRESS_<FAMILY>_<NETWORK>`
vars (QIE keeps its legacy no-suffix names for backward compatibility).

| Chain     | Network        | ProjectRegistry                              | ContractLabelRegistry                        |
| --------- | -------------- | -------------------------------------------- | -------------------------------------------- |
| QIE       | Testnet `1983` | `0x75d7b39bc827367c409e1a2bf805bd5f337ca27b` | `0x177294293e6e785a83e036a95de1697e3cc04748` |
| QIE       | Mainnet `1990` | `0x673e3d4d7f6043d0384e95ce0c110f09e09ec708` | `0xb6075e4cad1f7e7e779e49dcf7df08949797ed81` |
| BOT Chain | Testnet `968`  | _not wired in_                               | _not wired in_                               |
| BOT Chain | Mainnet `677`  | `0xd7b68abdbae4496cb0bf5ce6c8684bc6f3dd9c9b` | `0x341b13cbab421cd318da7906d894ac1ba5b9fd3f` |

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

BOT Chain mainnet's pair above was deployed in two separate transactions
(the deployer wallet ran low on BOT mid-deploy), so the two contracts sit at
different block heights but share the same deployer/`autoLabeler` address —
functionally identical to a single-run deploy.

When an address is unset for a network, DevStation falls back to local
history and hides the registry-backed UI (Projects, Label Registry, ecosystem
stats) for that network — nothing crashes, those features are just inactive
until (re)deployed.

---

## Deploying registries to a new chain

```bash
bun run contracts:compile                             # compile both registries
bun run contracts:deploy <family> [testnet|mainnet]   # deploy + print addresses
bun run contracts:verify <family> [testnet|mainnet]   # source-verify on the explorer
```

`<family>` is one of `qie` (default) or `bot`. Requires `PRIVATE_KEY` (an unprefixed,
server-only var — **never** add it to a hosted deploy, the running app has no
use for it) set to a funded deployer key in `.env.local`.

After deploying, copy the printed addresses into the matching
`VITE_{PROJECT,LABEL}_REGISTRY_ADDRESS_<FAMILY>_<NETWORK>` vars (see the
[table above](#registry-contract-addresses)) in your host's env config, then
rebuild.

`contracts:verify` needs no private key — it reads the addresses back out of
`.env.local` (the same vars above) and recompiles from source to submit the
exact solc standard-JSON input to the chain's Blockscout explorer. Run it
after deploying (once the explorer has indexed the new address, usually
within a minute or two of the deploy tx confirming).

---

## Sponsored deploys (QIE mainnet & BOT Chain mainnet)

Optional, off by default, configured **per chain**. When that chain's sponsor
private key is set, DevStation can **top up a visitor's own wallet** with
just enough native gas token to cover a deploy — a "Gas-free deploy
(DevStation tops up your wallet)" checkbox appears in LaunchKit's deploy
wizard and the editor's Deploy panel, on that chain's **mainnet only**. The
client and server both hard-check the chain against a small eligible-chains
table (`SPONSOR_ELIGIBLE_CHAIN_IDS` in `src/lib/sponsor/pricing.ts`); this
never applies to testnet or any other chain family — every testnet here
already has a public faucet.

| Chain             | Sponsor key env var       | Budget env var             |
| ----------------- | ------------------------- | -------------------------- |
| QIE mainnet       | `SPONSOR_PRIVATE_KEY`     | `SPONSOR_DAILY_BUDGET_QIE` |
| BOT Chain mainnet | `SPONSOR_PRIVATE_KEY_BOT` | `SPONSOR_DAILY_BUDGET_BOT` |

**The sponsor wallet never broadcasts the deploy itself.** It sends a plain
native-token transfer to the requester's own connected wallet
(`src/routes/api.sponsor-topup.ts`), sized from a gas estimate of the actual
deploy plus the two registry writes that follow it (`ONCHAIN_WRITE_GAS` × 2,
from `src/lib/contracts.ts`), minus whatever balance that wallet already has.
The requester's wallet then signs and sends everything itself — the CREATE,
`ProjectRegistry.recordDeployment`, `ContractLabelRegistry.submitLabel` —
exactly like a normal self-paid deploy. That means the connected wallet is
**always** the genuine deployer of record: no ownership caveats, no
constructor-argument workarounds, no registry-misattribution risk to design
around.

**This is genuinely new infrastructure, not a config toggle to flip lightly.**
Unlike `PRIVATE_KEY` above — a one-off local CLI key used only to deploy
DevStation's own registries — each `SPONSOR_PRIVATE_KEY*` is held live by the
running server and spends real mainnet funds in response to requests. Treat
each like an exchange hot wallet, and use a separate dedicated wallet per
chain rather than reusing one key across chains.

**Abuse model (read before enabling) — this is a real token faucet, not just
a gas payer.** There is deliberately **no per-wallet or per-IP gate** — any
visitor can request a top-up for any wallet address, on any sponsor-eligible
chain. Because the native token lands directly in that wallet before any
deploy happens, nothing forces it to actually be spent on a deploy — a
requester can simply keep it. The only backstop is that chain's daily
budget var (default `5`): a rolling 24h spend ceiling per chain, computed by
summing that chain's sponsor wallet's own outgoing value _and_ gas fees from
the chain's explorer tx history (no separate database — consistent with the
rest of this app). Sponsorship stops once spend crosses **90% of this
value**, not 100% — the 10% headroom exists because this check isn't atomic
across concurrent requests; it reduces, not eliminates, the chance of a
burst of simultaneous requests overshooting the configured cap. Once a
chain's daily cap is hit, top-up requests on that chain start failing with
`budget_exhausted` until spend rolls off the 24h window — the other chain is
unaffected, since each has its own independent budget. The app can't lose
more than roughly the configured daily budget per chain per day; that whole
budget could still be drained by one actor within minutes if they choose to,
with nothing to show for it on DevStation's side (no deploy, no registry
record).

**A wallet that already has enough of the native token gets no top-up** —
the server checks the requester's current balance first and only sends the
shortfall, so sponsorship doesn't hand out free tokens to wallets that don't
need it.

Enable a chain by setting its sponsor private key (and optionally its daily
budget var) on the host and rebuilding — see `.env.example`.

**Open question for BOT Chain specifically:** the padding math in
`paddedTopupCost` (10x the gas estimate, 1.5x the gas price) was tuned
against a real undershoot observed on QIE, whose `eth_estimateGas` returns
meaningfully different numbers between two back-to-back calls for the same
transaction. Nothing has confirmed whether BOT Chain's estimator behaves the
same way — the same margin is reused there as the only data point available,
but watch the first few live sponsored BOT mainnet deploys closely.

---

## AI proxy setup

The "Code with AI" panel can either use each visitor's own key or route through
this app's `/api/ai` proxy on an operator-provided key. For the proxy, the
whole setup is **two variables**:

| Variable             | Value          | Notes                                                  |
| -------------------- | -------------- | ------------------------------------------------------ |
| `VITE_AI_PROXY`      | `true`         | Public flag — routes the browser through `/api/ai`.    |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | Server-only. One key serves every model in the picker. |

Optional: `OPENAI_MODEL` pins the default model (any OpenRouter id, e.g.
`anthropic/claude-sonnet-5`). Without it the code defaults to that same model.

### Two traps worth knowing

**1. Don't file an OpenRouter key under another provider's variable.** The
resolution order in `src/routes/api.ai.ts` is:

```
openaiKey = OPENAI_API_KEY || AI_API_KEY || OPENROUTER_API_KEY
provider  = AI_PROVIDER || (openaiKey ? "openai" : ANTHROPIC_API_KEY ? "anthropic" : "openai")
```

so a key sitting in `ANTHROPIC_API_KEY` sends the app down the Anthropic
branch — which then talks the Anthropic Messages protocol to whatever
`ANTHROPIC_ENDPOINT` points at. This happened in production: an OpenRouter key
was stored as `ANTHROPIC_API_KEY` with `ANTHROPIC_ENDPOINT` left pointing at an
unrelated project's router, and the only symptom was a bare
`401 Invalid API key or token`. `configProblem()` now catches that specific
shape and names the offending variable instead. If you use OpenRouter, leave
`ANTHROPIC_API_KEY`, `ANTHROPIC_ENDPOINT`, `OPENAI_API_KEY` and `AI_API_KEY`
unset.

**2. Env changes need a redeploy.** The proxy runs inside the Nitro server
function, which reads `process.env` from the environment captured at deploy
time. Editing a variable in the Netlify dashboard does **not** affect the
running function — trigger a redeploy afterwards, or the old value stays live.
