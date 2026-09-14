# Review checklist

Work through each section for every contract in scope. Note where you checked, as well as what you found.

## Access control

- [ ] Every state-changing function has the restriction it needs. List the public and external functions that have none, and justify each.
- [ ] Owner, admin and role changes are two-step, or their risk is accepted and documented.
- [ ] Initializers can run once only, and cannot be front-run on an unprotected proxy.
- [ ] No `tx.origin` used for authorization.
- [ ] Privileged roles cannot move user funds beyond what the documentation says they can.

## External calls and reentrancy

- [ ] Checks-effects-interactions everywhere value or state changes around an external call.
- [ ] ReentrancyGuard (or an equivalent lock) on functions that send ETH/QIE or tokens and share state.
- [ ] Read-only reentrancy: view functions other protocols read cannot report stale state mid-call.
- [ ] Low-level `call` return values checked; calls to addresses without code handled.
- [ ] No unbounded `delegatecall` to user-supplied addresses.

## Tokens

- [ ] ERC-20 `transfer` and `transferFrom` results checked, or SafeERC20 used; tokens that return no value work.
- [ ] Fee-on-transfer and rebasing tokens: either handled (balance before and after), or explicitly refused.
- [ ] Decimals read from the token, not assumed. QUSDC on QIE has 6.
- [ ] `approve` race understood; no unlimited approvals to contracts that do not need them.
- [ ] ERC-721 and ERC-1155 receiver hooks cannot be used to re-enter.

## Arithmetic

- [ ] Rounding always favours the protocol (deposits round shares down, withdrawals round assets up).
- [ ] Division happens after multiplication.
- [ ] `unchecked` blocks cannot overflow or underflow.
- [ ] Casts to smaller integer types are bounds-checked.
- [ ] Share and price maths safe against first-depositor and donation attacks (virtual shares, minimum liquidity).

## Prices, oracles and MEV

- [ ] No spot price from a pool used where it can be moved within one transaction.
- [ ] Oracle staleness, zero and negative values handled.
- [ ] Slippage limits and deadlines on swaps, deposits and withdrawals.
- [ ] Commit-reveal, or equivalent, where front-running changes the outcome.

## Signatures

- [ ] EIP-712 domain includes chain ID and the verifying contract.
- [ ] Nonces or used-signature tracking prevent replay.
- [ ] `ecrecover` zero-address result rejected; signature malleability handled (OpenZeppelin ECDSA).
- [ ] Deadlines on signed permissions.

## Denial of service and gas

- [ ] No loops over arrays that users can grow without bound.
- [ ] Payments pulled by recipients rather than pushed in a loop.
- [ ] A reverting recipient cannot block others.
- [ ] Block gas limits respected for any batch operation.

## Upgradeability

- [ ] Storage layout compatible across versions; gaps reserved.
- [ ] Implementation contracts cannot be initialized or destroyed by others.
- [ ] Upgrade authority clear, and protected as the most powerful role.

## Events and accounting

- [ ] Every state change that off-chain systems track emits an event, with the values they need.
- [ ] Balances tracked internally match what the contract actually holds; stray transfers do not break accounting.

## Deployment and chain

- [ ] Constructor arguments and immutables are correct for the target chain.
- [ ] Compiled with `evmVersion` shanghai or earlier for QIE (no MCOPY).
- [ ] Off-chain transaction senders use explicit gas limits for storage writes on QIE.
- [ ] No hard-coded addresses from another chain.
