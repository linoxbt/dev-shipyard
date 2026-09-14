# QIE Transaction Kit

Send a transaction on QIE Mainnet, follow it, and report what really happened. A transaction can be mined and still revert; it then costs gas and changes nothing. So "success" in this kit means the receipt's status says success, not merely that a hash came back.

| Export | What it does |
| --- | --- |
| `sendTransaction(tx)` | Connects if needed, moves the wallet to QIE Mainnet, sends, returns the hash. `tx` is `{ to, value?, data?, gas? }`; bigints are fine |
| `waitForSuccess(hash)` | Resolves with the receipt on success; throws when it reverted |
| `useTransaction()` | `phase`: idle, signing, pending, success or failed. Also `hash`, `error`, `receipt`, `reset()`, `busy`, and `run(tx)`, which resolves with `{ receipt }`, `{ failed, error }` or `{ rejected }` |
| `<TxButton tx label onSuccess?>` | A button that runs the whole flow and shows its status. `tx` may be a function |
| `<TxStatus state>` | "Confirm in your wallet…", "Waiting…", "Confirmed in block N", or the error |
| `<Toaster />`, `toast(message, kind)` | Notifications: `ok`, `fail` or `info` |
| `<ExplorerLink hash or address>` | A link to the QIE explorer |

A wallet rejection returns to idle quietly: it is a choice, not an error.

## Add it to an app

1. Copy `tx-kit.js`, `tx-kit.css`, `wallet.js` and `contract.js` into your app folder. An App Builder app already has `wallet.js` and `contract.js`; make sure `contract.js` exports `CHAIN`, `viemChain`, `explorerTx` and `explorerAddress`.
2. Add `<link rel="stylesheet" href="./tx-kit.css" />`.
3. Render `<Toaster />` once, near the root, and use `TxButton` wherever something is sent.

```js
import { encodeFunctionData } from "viem";
import { TxButton } from "./tx-kit.js";

const claim = {
  to: "0xYourContract",
  data: encodeFunctionData({ abi, functionName: "claim", args: [] }),
  gas: 200000n,
};

html`<${TxButton} tx=${claim} label="Claim rewards" onSuccess=${reload} />`;
```

## Gas on QIE

`eth_estimateGas` on QIE returns too little for writes that touch storage. Pass `gas` for contract writes; plain QIE transfers can leave it out. Unused gas is refunded.

## Demo

`app.js` sends 0 QIE from your wallet to itself (it moves nothing and costs only gas), and shows the toasts.
