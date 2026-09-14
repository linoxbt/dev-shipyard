# Holder Gate

A members area for wallets that hold the right things on QIE Mainnet.

1. **Sign in.** The visitor connects and signs a sign-in message. That proves they control the wallet: anyone can paste an address, but only its owner can sign for it. It is free and sends no transaction.
2. **Check holdings.** Their balances are read from QIE Mainnet and checked against the rules in `config.js`.
3. **Let them in.** When the rules pass, `content.js` is shown.

The default rules require a QIE ID and at least 1 QUSDC.

## Files

| File | What it is |
| --- | --- |
| `config.js` | **The rules.** Token and NFT contracts, minimums, `all` or `any` |
| `content.js` | **What members see.** Replace with your own |
| `app.js` | Sign-in, signature check, holdings check |
| `contract.js` | QIE Mainnet settings, QUSDC, QIE ID, the ERC-20 ABI |
| `wallet.js` | Wallet access: `window.ethereum`, or DevStation's preview bridge |
| `index.html`, `styles.css` | Page shell and styling |

## Rules

```js
{ label: "Holds a QIE ID", kind: "erc721", address: QIE_ID, min: "1" }
{ label: "Holds 100 QUSDC", kind: "erc20", address: QUSDC.address, decimals: 6, min: "100" }
```

Any ERC-20 or ERC-721 on QIE Mainnet works: add its address. QIE ID counts every `.qie` token a wallet holds, including the free, randomly named IDs QIE gives new wallets.

## Keeping content secret

This page runs in the browser, so anything in `content.js` can be read by anyone who opens the source. That is right for member perks and pages. For secret content (downloads, private links, API data), serve it from a server that repeats both checks:

```js
import { createPublicClient, http, parseUnits, verifyMessage } from "viem";

// POST /api/members  { address, message, signature }
export async function isMember({ address, message, signature }) {
  if (!(await verifyMessage({ address, message, signature }))) return false;
  const issued = Date.parse(/Issued: (.+)/.exec(message)?.[1] ?? "");
  if (!(Date.now() - issued < 5 * 60_000)) return false; // fresh sign-ins only
  // Also refuse a nonce you have seen before, so a signature cannot be replayed.
  const client = createPublicClient({ transport: http("https://rpc1mainnet.qie.digital/") });
  const qusdc = await client.readContract({
    address: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [address],
  });
  return qusdc >= parseUnits("1", 6);
}
```

## Run it

- In DevStation: **Clone into my apps**. It previews straight away.
- Anywhere else: serve the `app` folder over HTTP, for example `npx serve app`.
