# Deploying the DevStation Registries

DevStation uses two on-chain contracts:

| Contract                | Purpose                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `ProjectRegistry`       | Records every contract deployed through DevStation (powers the Projects page + on-chain audit trail). |
| `ContractLabelRegistry` | Human-readable names for contracts, so Routebook shows labels instead of hex.                         |

Both are dependency-free Solidity 0.8.x and already compiled to `contracts/out/`.

> **QIEPassVerifier is intentionally NOT included** — QIE Pass was removed from the app.

---

## Security first

- Your private key goes in **`.env.local` only** — that file is gitignored. **Never** commit it or paste it anywhere.
- `deployment-output.json` (written after deploy) is also gitignored.
- Deploy to **testnet first**, verify the app works, then mainnet.

---

## 1. Add your funded key

Create / edit `.env.local` in the repo root:

```
PRIVATE_KEY=0xYOUR_TEST_FUNDED_PRIVATE_KEY
```

(The deployer needs a small amount of test QIE for gas — get it from the QIE faucet.)

## 2. (Optional) recompile

Artifacts are already committed, but to regenerate:

```
bun run contracts:compile
```

This writes `contracts/out/*.json` and `src/lib/abis/*.ts` (the ABIs the frontend imports).

## 3. Deploy to QIE Testnet (chain 1983)

```
bun run contracts:deploy
```

It prints each address and the env lines to copy. Example output:

```
=== DONE — paste these into .env.local ===

VITE_PROJECT_REGISTRY_ADDRESS=0x....
VITE_LABEL_REGISTRY_ADDRESS=0x....
```

## 4. Paste the addresses into `.env.local`

```
VITE_PROJECT_REGISTRY_ADDRESS=0x....
VITE_LABEL_REGISTRY_ADDRESS=0x....
```

Restart `bun run dev`. The Projects page now shows **"Reading from on-chain ProjectRegistry"**, deployments from the Contract Editor are recorded on-chain, and label submissions write to the registry.

## 5. Deploy to QIE Mainnet (chain 1990)

When you're ready for mainnet (spends **real** QIE):

```
bun run contracts:deploy mainnet
```

There's an 8-second abort window before it broadcasts. Then put the mainnet addresses in your production env (`.env.production` / host env vars) using the same `VITE_*` keys.

---

## How the app behaves before vs after deploy

- **Before** (addresses unset): Projects + Labels fall back to localStorage / mock data; everything still works for demos.
- **After** (addresses set): reads come from chain, writes send wallet transactions, with a localStorage mirror for instant UI.

No code change needed — it's all driven by the `VITE_*` env values.

---

## (Optional) QUSDC balance + DEX

- `VITE_QUSDC_ADDRESS=0x...` enables the read-only QUSDC balance line in the sidebar/settings. Get the address from <https://docs.stable.qie.digital> or the explorer.
- `VITE_QIE_DEX_URL` defaults to the QIE DEX swap; override only if it changes.
