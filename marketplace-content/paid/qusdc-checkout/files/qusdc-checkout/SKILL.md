---
name: qusdc-checkout
description: Accept QUSDC payments on QIE Mainnet for orders from your app or store, with a tested checkout contract, the approve-then-pay frontend flow, server-side payment confirmation, and refunds.
---

# Take QUSDC payments on QIE

Use this skill when an app, store or service should charge in QUSDC on QIE Mainnet and know for certain which order was paid.

A plain token transfer cannot say what it was for: ERC-20 transfers carry no reference. This skill uses a small checkout contract instead. Every payment names an order id, can be made once, and is recorded on chain with an event.

## Files in this skill

| File | What it is |
| --- | --- |
| `src/QusdcCheckout.sol` | The contract: `pay(orderId, amount)`, owner-only `refund` and `withdraw`, two-step ownership. Rejects fee-on-transfer tokens and double payments |
| `test/QusdcCheckout.t.sol` | Foundry tests, including a fuzz test, with a 6-decimal mock token |

## QIE facts

- QUSDC on QIE Mainnet: `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`, **6 decimals**. 25 QUSDC is `25_000_000`.
- Chain ID 1990, RPC https://rpc1mainnet.qie.digital, explorer https://mainnet.qie.digital. Testnet: chain ID 1983, RPC https://rpc1testnet.qie.digital.
- Compile with `evmVersion` shanghai: QIE's EVM has no MCOPY.
- `eth_estimateGas` underestimates storage writes on QIE: send explicit gas limits.
- `eth_getLogs` on QIE only serves ranges of about 10,000 blocks. Page through history in chunks, or read `orders(orderId)` directly.

## Steps

1. **Add the contract.** Copy `src/QusdcCheckout.sol` and `test/QusdcCheckout.t.sol` into a Foundry project (`forge init` if there is none). Install the test library with `forge install foundry-rs/forge-std`. Set `evm_version = "shanghai"` in `foundry.toml`.
2. **Run the tests.** `forge test`. All must pass before anything is deployed.
3. **Deploy.**
   - Testnet first. QUSDC may not exist there: deploy the test's `MockQusdc` as a stand-in token, or any 6-decimal ERC-20.
   - Mainnet: `constructor(token, owner)` takes the QUSDC address and the wallet or multisig that will own revenue:
     ```
     forge create src/QusdcCheckout.sol:QusdcCheckout --rpc-url https://rpc1mainnet.qie.digital \
       --private-key $QIE_PRIVATE_KEY --broadcast --gas-limit 1500000 \
       --constructor-args 0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5 <OWNER_ADDRESS>
     ```
   - Confirm the receipt status, and verify the source on the explorer (see the `qie-deploy` skill).
4. **Create orders on your server.** Give each order a reference, such as `"order-1042"`, and an amount in QUSDC units (`parseUnits("25", 6)`). The on-chain id is `keccak256(toBytes("order-1042"))` (viem).
5. **Build the payment flow in the frontend.**
   1. Read `allowance(buyer, checkout)` on QUSDC.
   2. If it is short, `approve(checkout, amount)`, exactly the amount, with `gas: 120_000n`. Wait for the receipt and check its status.
   3. `pay(orderId, amount)` with `gas: 200_000n`. Wait for the receipt and check `status === "success"`.
   4. Show the explorer link, then tell your server the order may be paid.
6. **Confirm on the server; never trust the browser.** Read `orders(orderId)` from the RPC and check that `payer` is not zero and `amount` equals what the order costs. Only then mark it paid and fulfil it. To watch many orders, follow `OrderPaid` events in block ranges of at most 10,000.
7. **Refunds and revenue.** The owner calls `refund(orderId, amount)`, partial refunds allowed. Before `withdraw(to, amount)`, keep enough behind for refunds you may owe. Use a multisig as owner in production.

## Done means

- `forge test` passes.
- A test payment on Testnet is paid once, visible in `orders(orderId)`, and refundable.
- The server marks orders paid only from chain data.
- Amounts use 6 decimals end to end, and every write has an explicit gas limit and a receipt check.
