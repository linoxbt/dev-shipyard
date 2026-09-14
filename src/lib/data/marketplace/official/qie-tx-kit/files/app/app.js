// Demo of the QIE Transaction Kit.
//
// The button sends 0 QIE from your wallet to itself: a real transaction on
// QIE Mainnet that moves no funds and costs only its gas, a tiny fraction of a
// QIE. It shows every state a transaction goes through.

import { render } from "preact";
import { html } from "htm/preact";
import { CHAIN } from "./contract.js";
import { currentAccount, connect } from "./wallet.js";
import { Toaster, TxButton, toast } from "./tx-kit.js";

async function selfTransfer() {
  const from = (await currentAccount()) ?? (await connect());
  if (!from) throw new Error("Connect a wallet first.");
  return { to: from, value: 0n };
}

function App() {
  return html`
    <main>
      <header>
        <div>
          <h1>QIE Transaction Kit</h1>
          <p class="sub">Send, follow and report transactions on ${CHAIN.name}.</p>
        </div>
      </header>

      <section class="panel">
        <h2>TxButton</h2>
        <p class="meta">Sends 0 QIE to your own wallet. It moves nothing and costs only gas.</p>
        <${TxButton} tx=${selfTransfer} label="Send a test transaction" />
      </section>

      <section class="panel">
        <h2>Toasts</h2>
        <div class="row">
          <button class="ghost" onClick=${() => toast("Saved", "ok")}>Success toast</button>
          <button class="ghost" onClick=${() => toast("Something went wrong", "fail")}>Failure toast</button>
          <button class="ghost" onClick=${() => toast("Heads up", "info")}>Info toast</button>
        </div>
      </section>

      <section class="panel">
        <h2>Use it</h2>
        <pre><code>${`import { TxButton, Toaster } from "./tx-kit.js";
import { encodeFunctionData } from "viem";

const tx = {
  to: CONTRACT,
  data: encodeFunctionData({ abi, functionName: "claim", args: [] }),
  gas: 200000n, // explicit: QIE's estimate is low for storage writes
};

html\`<\${TxButton} tx=\${tx} label="Claim" /><\${Toaster} />\``}</code></pre>
      </section>
      <${Toaster} />
    </main>
  `;
}

render(html`<${App} />`, document.getElementById("root"));
