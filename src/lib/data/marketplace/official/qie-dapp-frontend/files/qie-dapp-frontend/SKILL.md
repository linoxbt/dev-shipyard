---
name: qie-dapp-frontend
description: Wire a web app to QIE with viem or wagmi: chain definitions, adding the network to wallets, QUSDC's 6 decimals, QIE ID names, safe writes with explicit gas and receipt checks, and explorer links.
---

# Build a QIE frontend

Use this skill when a web app has to read from or write to QIE Mainnet or QIE Testnet: connecting wallets, showing balances, sending transactions, or showing `.qie` names.

## QIE facts

Checked against the live network.

| | QIE Mainnet | QIE Testnet |
| --- | --- | --- |
| Chain ID | 1990 | 1983 |
| RPC | https://rpc1mainnet.qie.digital | https://rpc1testnet.qie.digital, fallback https://testnet.qie.digital/api/eth-rpc |
| Explorer | https://mainnet.qie.digital | https://testnet.qie.digital |
| Native coin | QIE, 18 decimals | QIE |

On QIE Mainnet:

- **QUSDC** (stablecoin) is `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`. It has **6 decimals**, not 18.
- **QIE ID** (`.qie` names, an ERC-721) is `0x9aab56e7727af53A3131985BFB16d845319b7bdc`.

The RPCs accept requests from any web origin, so a browser app can read them directly. The explorer's API is meant for servers: call it from your backend, not from the page.

Chain ID 5656 ("QIE Blockchain" in public registries) is a different chain.

## Steps

1. **Define the chains.** Copy `chains.ts` from this skill's folder. It has viem `defineChain` objects for both networks, with the Testnet fallback RPC.
2. **Create clients.**
   - viem: `createPublicClient({ chain: qieMainnet, transport: http() })`.
   - wagmi: `createConfig({ chains: [qieMainnet, qieTestnet], transports: { [qieMainnet.id]: http(), [qieTestnet.id]: fallback(qieTestnet.rpcUrls.default.http.map((u) => http(u))) } })`.
3. **Put the wallet on the right network.** Try `wallet_switchEthereumChain` with `{ chainId: "0x7c6" }` (1990), or `"0x7bf"` (1983). On error code `4902`, call `wallet_addEthereumChain` with the chain ID, `chainName`, `nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 }`, `rpcUrls` and `blockExplorerUrls`. With wagmi, `switchChain({ chainId })` does both.
4. **Read token amounts with their real decimals.** Use `formatUnits(balance, 6)` for QUSDC and `parseUnits(input, 6)` for input. Never assume 18, and never do token maths in floating point: keep bigints until display.
5. **Write safely.**
   - QIE's `eth_estimateGas` is too low for writes that touch storage. Pass an explicit limit: roughly `gas: 150_000n` for an ERC-20 `transfer` or `approve`, and more for contract calls that write several slots.
   - After sending, `await publicClient.waitForTransactionReceipt({ hash })` and check `receipt.status === "success"`. A mined transaction can still have reverted.
   - Approve exactly the amount a contract needs. Show an unlimited approval as a deliberate, separate choice.
6. **Show QIE ID names honestly.** The contract has no resolver.
   - `balanceOf(owner)` and `tokenOfOwnerByIndex(owner, i)` say which name tokens a wallet holds now.
   - The name itself is in the calldata of the registration that minted the token. That is a `register(Order order, bool isFree)` call to the registrar, selector `0xbc96db3f`. The label is the string between the `qie` TLD strings; find the minting transaction through the explorer API, server-side.
   - Registrations with `isFree = true` are free, randomly generated names that QIE hands to new wallets (for example `ykhli97464.qie`). Do not present those as a person's identity.
   - When no registered name is found, show the address.
7. **Link to the explorer.** Use `https://mainnet.qie.digital/tx/<hash>`, `/address/<address>` and `/block/<number>`, or the Testnet host.
8. **Test in a real wallet on Testnet first.** Get QIE from https://qie.digital/faucet.

## Done means

- The app works when the wallet starts on another network: it offers to switch or add QIE.
- Every token amount on screen matches the explorer, to the token's own decimals.
- Every write has an explicit gas limit, and reports success only from the receipt.
- No `.qie` name is shown that the chain does not prove the wallet owns, and no free placeholder name is shown as an identity.
