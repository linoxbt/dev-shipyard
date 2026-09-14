# Token Desk

Inspect and operate any ERC-20 token on QIE Mainnet from one page.

- **Inspect:** name, symbol, decimals, total supply, and the connected wallet's balance, read from chain. Loads QUSDC to start; paste any token address.
- **Transfer:** checks the amount's decimals and that it does not exceed the balance.
- **Allowances:** check what a spender may take, approve an exact amount (or unlimited, deliberately one step removed), and revoke to zero.
- **Receipts:** every write waits for the chain and is reported done only if it succeeded. The session log links each transaction on the explorer.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page shell and the import map (preact, htm, viem) |
| `app.js` | The app |
| `contract.js` | QIE Mainnet settings, QUSDC, the ERC-20 ABI, `TOKEN_WRITE_GAS` |
| `wallet.js` | Wallet access: `window.ethereum`, or DevStation's preview bridge |
| `styles.css` | Styling |

## Run it

- In DevStation: **Clone into my apps**. It previews straight away and uses the wallet you connected to DevStation.
- Anywhere else: serve the `app` folder over HTTP, for example `npx serve app`.

## Why the explicit gas limit

QIE's `eth_estimateGas` returns too little for writes that touch storage, and a transaction that runs out of gas still costs its fee. `transfer` and `approve` send 150,000 gas; unused gas is refunded.

## Make it yours

- Set the default token in `app.js` (`useState(QUSDC.address)`).
- A token list is a `select` of addresses feeding `load()`.
- For another EVM chain, change `CHAIN` in `contract.js`.
