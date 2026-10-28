# Contract changes for a v2 deployment

The four contracts in this directory are deployed and source-verified, and their
bytecode matches this source (`scripts/check-contracts.ts` checks the committed
artifacts; the 2026-10-21 audit checked the chain). Changing these files would
break that match, so the fixes below were **not applied to them**; see the status below.
Each needs a new deployment, an address change in `src/lib/contracts.ts`, and a
migration plan for existing listings, labels and balances.

Until then, the docs describe the current behaviour (README, docs.selling,
docs.marketplace, docs.labels).

## Status: written as new contracts

The v1 files are untouched. The fixes are in two new contracts beside them,
`DevStationMarketplaceV2.sol` and `ContractLabelRegistryV2.sol`, tested in
`contracts/test/v2.test.ts` and deployed with the steps in
[`docs/CONTRACTS_V2_RUNBOOK.md`](../docs/CONTRACTS_V2_RUNBOOK.md). The app
detects a v2 marketplace through `version()` and uses its price-capped calls.

| Item                     | In v2                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Per-deploy pricing    | Partly. Every deploy through DevStation pays, and the recorded hash follows the latest paid version. Download access after the first payment is still not metered. |
| 2. Content swapped       | `purchasedContentHash(id, wallet)` records the version paid for.                                                                                                   |
| 3. Moderation            | Hiding stops new sales; buyers keep access.                                                                                                                        |
| 4. Price protection      | `buyAt`, `recordDeployAt` and `featureAt` take a maximum.                                                                                                          |
| 5. Inflated deploy count | A creator's own deploys are free and not counted.                                                                                                                  |
| 6. Roles and treasury    | Two-step owner and treasury moves, with `cancelTreasuryTransfer`. No built-in delay: make the owner a multisig behind a timelock (runbook).                        |
| 7. Fee-on-transfer       | Refused: the balance must rise by the full amount.                                                                                                                 |
| 8. Labels                | The owner can remove a label; text lengths are capped.                                                                                                             |
| 9. Auto-labelling        | Server relay (`src/lib/label-relay.server.ts`): creation proved on-chain, last 24 hours, once per contract, no reserved names, capped spend. Works with v1 and v2. |
| 10. Template ids         | Not addressed. ProjectRegistry is unchanged and its template ids remain self-reported.                                                                             |

## DevStationMarketplace

### 1. Per-deploy pricing is enforced by convention only

**Now:** `recordDeploy` takes payment and grants `_purchased`, and buyers then
receive the source. Nothing ties the payment to a deploy, so a buyer can deploy
the bytecode again elsewhere without paying.

**Change:** add a factory path. `deployFromListing(uint256 id, bytes calldata
initCode)` charges the fee, checks `keccak256(initCode)` against a
creator-registered bytecode hash, and deploys with `CREATE2`. Keep
`recordDeploy` for listings without a registered hash, and label them "honour
system" in the UI. Rename the model to make the difference visible.

### 2. A creator can swap content after a sale

**Now:** `updateContent` replaces `contentHash` for everyone, and the runner
serves only the current hash.

**Change:** store versions in `bytes32[] contentHistory` per listing, and record
`purchasedVersion[id][buyer] = contentHistory.length - 1` in `_grant`. Add
`contentHashFor(id, buyer)`. The runner then serves the version the buyer paid
for, plus any later version, if the creator opts into free updates.

### 3. Moderation revokes access buyers already paid for

**Now:** `hasAccess` returns false once a listing is `hidden`, so moderating a
listing takes files away from past buyers without a refund.

**Change:** `hasAccess` returns `_purchased[id][wallet]` whatever `hidden` is.
`hidden` blocks _new_ sales only. If moderation is for illegal content, add an
explicit `revoke(id)` that refunds from the creator's `pending` balance and
emits `Revoked`.

### 4. No price protection for buyers

**Now:** `buy`, `recordDeploy` and `feature` charge the current `price`. A
creator can raise the price between a buyer's quote and their transaction.
For QUSDC, any leftover allowance is then pulled at the new price.

**Change:** add `uint256 maxPrice` to `buy` and `recordDeploy`, and
`maxCost` to `feature`, with `require(l.price <= maxPrice, "Price changed")`.
The frontend passes the quoted price.

### 5. Creators can inflate their own deploy counts

**Now:** `recordDeploy` from the creator is free and still increments
`l.deploys`.

**Change:** only increment `deploys` when `due > 0`, or count creator deploys
separately in `creatorDeploys`.

### 6. Centralised roles and an immutable treasury

**Now:** one EOA is owner, treasury and (on the label registry) autoLabeler.
`treasury` is immutable.

**Change:** set the owner to a multisig behind a timelock. Make `treasury`
changeable by the owner with a delay (`proposeTreasury`, then
`acceptTreasury` after 48 hours) that emits events.

### 7. Fee-on-transfer tokens

**Now:** `_collect` credits `amount` without checking what arrived. This is
safe for today's QUSDC.

**Change:** compare `balanceOf(this)` before and after the `transferFrom`, and
credit the difference.

## ContractLabelRegistry

### 8. First-come labels, and no way to reject or remove one

**Now:** anyone can label any address first, including a predictable future
`CREATE` address. After that, only the submitter, the owner or the autoLabeler
can change it, and there is no reject or remove function.

**Change:**

- Add `rejectLabel(address)` and `removeLabel(address)` (owner or moderator
  role), each emitting an event.
- Let the contract's deployer, as recorded by `ProjectRegistry` or proven by
  the creation transaction through an attestation, override a community label.
- Expose `approved` in `getLabel` so clients don't have to infer it from
  `autoLabeled`.

### 9. Server-side auto-labelling

**Now:** only `autoLabeler` may submit `autoLabeled=true`. The app's deploy flows
submit community labels from the user's wallet instead.

**Change (no contract change):** a server relay holding the autoLabeler key
submits the auto-label after it checks the `ProjectRegistry` record for that
deployment.

## ProjectRegistry and TemplateRegistry

### 10. Self-reported template ids

**Now:** template deploy counts come from the `templateId` the deployer passes.
They show activity; they don't prove it.

**Change:** record template deploys from the factory in (1), so the count is
written by the contract that performed the deploy.
