# Moving a network to the v2 contracts

`DevStationMarketplaceV2` and `ContractLabelRegistryV2` carry the fixes in
[`contracts/V2_CHANGES.md`](../contracts/V2_CHANGES.md). Both are compiled,
checked against their artifacts in CI, and covered by behaviour tests
(`contracts/test/v2.test.ts`). Nothing in the app has to change to use them:
it reads `version()` from the configured marketplace and sends the
price-protected calls when it answers 2.

What follows needs the deployer key and, for the multisig steps, the
multisig's signers. It cannot be done from CI.

## 1. Before you start

- A multisig (Safe or equivalent) on the target network for the owner and
  treasury roles. One EOA holding every role is what v2 is meant to end.
- A dedicated, low-balance key for auto-labels, if you want trusted labels
  on deploys (see `AUTOLABELER_PRIVATE_KEY` in `.env.example`).
- `bun run scripts/compile.ts` and `bun run scripts/check-contracts.ts` pass.

## 2. Deploy

```bash
TREASURY_ADDRESS=0xMultisig OWNER_ADDRESS=0xMultisig AUTOLABELER_ADDRESS=0xLabelerKeyAddress \
  bun run scripts/deploy.ts mainnet --only DevStationMarketplaceV2 --only ContractLabelRegistryV2
```

- The treasury is set at deploy. Ownership is offered to `OWNER_ADDRESS`;
  the multisig must call `acceptOwnership()` on each contract to finish it.
- Verify both on the explorer: `bun run scripts/verify.ts`.
- The script prints the `VITE_MARKETPLACE_ADDRESS_*` and
  `VITE_LABEL_REGISTRY_ADDRESS_*` lines for the new addresses.

## 3. Decide how to move existing data

The v1 contracts stay where they are; nothing on them is lost. But the app
reads one marketplace and one label registry per network, so switching the
setting changes what it shows.

- **Label registry.** Labels on v1 are not copied. Either re-submit the ones
  worth keeping from the auto-labeler (it may overwrite any label), or keep
  pointing the app at v1 and use v2 only on networks without labels yet.
- **Marketplace.** Listings, purchases and balances on v1 stay on v1, and
  creators withdraw from v1 as before. Before switching a network that has
  paid listings, ask their creators to republish on v2, and keep the v1
  address noted: a v1 buyer's access is checked against v1, so the files of
  a v1 listing must stay downloadable for its buyers. On QIE Mainnet today
  that is the six paid listings m-3 to m-8.

The cleanest order for a live network: deploy v2, have creators republish,
switch the app's setting, leave v1 untouched for withdrawals and existing
buyers.

## 4. Switch the app

Set the new addresses in the host's environment and redeploy. Then check:

- `GET /api/health` returns 200.
- The marketplace page loads, and a test purchase on a cheap listing asks
  the wallet for `buyAt`, not `buy`.
- A test deploy through DevStation logs "Labelled by DevStation (verified
  deploy)" when `AUTOLABELER_PRIVATE_KEY` is set.
