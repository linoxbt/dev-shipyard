// Demo of the QIE Wallet Kit: every component on one page.

import { render } from "preact";
import { html } from "htm/preact";
import { CHAIN, QUSDC } from "./contract.js";
import {
  AddressChip,
  BalanceBadge,
  ConnectButton,
  NetworkGuard,
  useWallet,
} from "./wallet-kit.js";

function App() {
  const wallet = useWallet();
  return html`
    <main>
      <header>
        <div>
          <h1>QIE Wallet Kit</h1>
          <p class="sub">Drop-in wallet components for ${CHAIN.name}.</p>
        </div>
        <${ConnectButton} wallet=${wallet} />
      </header>

      ${wallet.error && html`<p class="error">${wallet.error}</p>`}

      <section class="panel">
        <h2>NetworkGuard</h2>
        <${NetworkGuard} wallet=${wallet}>
          <p class="ok">${wallet.account ? `Connected on ${CHAIN.name}.` : "Connect a wallet to see the guard at work."}</p>
        </${NetworkGuard}>
      </section>

      <section class="panel">
        <h2>AddressChip and BalanceBadge</h2>
        ${wallet.account
          ? html`
              <div class="row">
                <${AddressChip} address=${wallet.account} />
                <${BalanceBadge} address=${wallet.account} />
                <${BalanceBadge} address=${wallet.account} token=${QUSDC} />
              </div>
            `
          : html`<p class="meta">Connect to show your address and live balances.</p>`}
      </section>

      <section class="panel">
        <h2>Use it</h2>
        <pre><code>${`import { useWallet, ConnectButton, NetworkGuard } from "./wallet-kit.js";

function Header() {
  const wallet = useWallet();
  return html\`<\${ConnectButton} wallet=\${wallet} />\`;
}`}</code></pre>
      </section>
    </main>
  `;
}

render(html`<${App} />`, document.getElementById("root"));
