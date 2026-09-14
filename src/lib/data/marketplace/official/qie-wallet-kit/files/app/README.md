# QIE Wallet Kit

Wallet components for preact + htm apps on QIE Mainnet. They work in a published app through `window.ethereum`, and inside DevStation's preview through its wallet bridge.

| Export | What it does |
| --- | --- |
| `useWallet()` | Account, chain ID, `onChain`, `connect()`, `switchChain()`, errors. Kept current on wallet events, or by polling in the preview |
| `<ConnectButton wallet>` | A connect button, or the connected address once connected |
| `<NetworkGuard wallet>` | Renders its children on QIE Mainnet; otherwise a banner with a one-click switch that adds the network if the wallet lacks it |
| `<AddressChip address>` | Shortened address, explorer link, copy button |
| `<BalanceBadge address token?>` | Live QIE balance, or any ERC-20's with `token={{ address, symbol, decimals }}` |
| `publicClient` | One viem client for QIE Mainnet reads |
| `shortAddress`, `formatToken` | Helpers |

## Add it to an app

1. Copy `wallet-kit.js`, `wallet-kit.css`, `wallet.js` and `contract.js` into your app folder. A DevStation App Builder app already has `wallet.js` and `contract.js`: keep yours, and check that `contract.js` exports `CHAIN`, `ERC20_ABI`, `explorerAddress` and `viemChain`, or copy those exports across.
2. Link the styles: `<link rel="stylesheet" href="./wallet-kit.css" />`.
3. Use the components:

```js
import { html } from "htm/preact";
import { useWallet, ConnectButton, NetworkGuard, BalanceBadge } from "./wallet-kit.js";

export function Header() {
  const wallet = useWallet();
  return html`
    <header>
      <${ConnectButton} wallet=${wallet} />
    </header>
    <${NetworkGuard} wallet=${wallet}>
      <${BalanceBadge} address=${wallet.account} />
    </${NetworkGuard}>
  `;
}
```

## Theme

Set any of these on `:root`: `--ds-brand`, `--ds-on-brand`, `--ds-text`, `--ds-muted`, `--ds-surface`, `--ds-border`, `--ds-warn`, `--ds-radius`.

## Demo

`index.html` and `app.js` show every component. In DevStation, **Clone into my apps** previews it.
