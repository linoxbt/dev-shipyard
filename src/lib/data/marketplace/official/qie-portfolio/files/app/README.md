# QIE Portfolio

A wallet's holdings on QIE Mainnet, read straight from the chain: QIE, QUSDC and QIE ID tokens, for the connected wallet or any address.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page shell and the import map (preact, htm, viem) |
| `app.js` | The app |
| `contract.js` | QIE Mainnet settings, QUSDC and QIE ID addresses, the ERC-20 ABI |
| `wallet.js` | Wallet access: `window.ethereum`, or DevStation's preview bridge |
| `styles.css` | Styling |

## Run it

- In DevStation: clone it into your apps and it previews straight away.
- Anywhere else: serve the `app` folder over HTTP, for example `npx serve app`. Opening `index.html` from disk does not work, because browsers block ES modules from `file://`.

## Extend it

- Add a token: read `balanceOf` for its address in `holdings()` and add a `Card`.
- QIE ID's count includes the free, randomly named IDs QIE gives new wallets. To show names, see DevStation's `qie-dapp-frontend` skill.
