// Holder Gate: a members area for wallets that hold the right things on QIE.
//
// 1. The visitor connects and signs a sign-in message, which proves they
//    control the wallet (anyone can paste an address; only its owner can sign).
// 2. Their balances are read from QIE Mainnet and checked against config.js.
// 3. When the rules pass, content.js is shown.
//
// No transaction is sent and nothing costs gas.

import { render } from "preact";
import { useState } from "preact/hooks";
import { html } from "htm/preact";
import { createPublicClient, formatUnits, http, parseUnits, toHex, verifyMessage } from "viem";
import { CHAIN, ERC20_ABI, viemChain } from "./contract.js";
import { connect, currentAccount, request } from "./wallet.js";
import { GATE } from "./config.js";
import { MembersContent } from "./content.js";

const client = createPublicClient({ chain: viemChain, transport: http(CHAIN.rpcUrl) });

export function signInMessage(account, issuedAt, nonce) {
  return [
    `Sign in to ${GATE.title}`,
    "",
    "This proves you control this wallet. It is free and sends no transaction.",
    "",
    `Wallet: ${account}`,
    `Chain: ${CHAIN.name} (${CHAIN.id})`,
    `Issued: ${issuedAt}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

async function checkRule(rule, account) {
  const balance = await client.readContract({
    address: rule.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
  const needed = rule.kind === "erc20" ? parseUnits(rule.min, rule.decimals) : BigInt(rule.min);
  const shown =
    rule.kind === "erc20" ? `${formatUnits(balance, rule.decimals)} held` : `${balance} held`;
  return { ...rule, passed: balance >= needed, shown };
}

function App() {
  const [state, setState] = useState("start");
  const [account, setAccount] = useState(null);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");

  const signIn = async () => {
    setError("");
    try {
      setState("connecting");
      const address = (await currentAccount()) ?? (await connect());
      if (!address) throw new Error("Connect a wallet to sign in.");

      setState("signing");
      const nonce = crypto.getRandomValues(new Uint32Array(2)).join("");
      const message = signInMessage(address, new Date().toISOString(), nonce);
      const signature = await request("personal_sign", [toHex(message), address]);
      if (!(await verifyMessage({ address, message, signature }))) {
        throw new Error("That signature is not from this wallet.");
      }
      setAccount(address);

      setState("checking");
      const checked = await Promise.all(GATE.rules.map((rule) => checkRule(rule, address)));
      setResults(checked);
      const passed =
        GATE.mode === "any" ? checked.some((r) => r.passed) : checked.every((r) => r.passed);
      setState(passed ? "member" : "denied");
    } catch (e) {
      setState("start");
      setError(e instanceof Error ? e.message.split("\n")[0] : "Sign-in did not finish.");
    }
  };

  const busy = ["connecting", "signing", "checking"].includes(state);
  return html`
    <main>
      <header>
        <div>
          <h1>${GATE.title}</h1>
          <p class="sub">For wallets that meet ${GATE.mode === "any" ? "any" : "all"} of these on ${CHAIN.name}.</p>
        </div>
      </header>

      <section class="panel">
        <h2>Requirements</h2>
        <ul class="log">
          ${(results.length ? results : GATE.rules).map(
            (rule) => html`<li class=${rule.passed === undefined ? "" : rule.passed ? "ok" : "error"}>
              ${rule.passed === undefined ? "" : rule.passed ? "✓ " : "✗ "}${rule.label}${rule.shown ? ` (${rule.shown})` : ""}
            </li>`,
          )}
        </ul>
        ${state !== "member" && html`
          <button onClick=${signIn} disabled=${busy}>
            ${state === "connecting" ? "Connecting…" : state === "signing" ? "Sign the message in your wallet…" : state === "checking" ? "Checking holdings…" : "Sign in with wallet"}
          </button>`}
        ${state === "denied" && html`<p class="warn">This wallet does not meet the requirements yet.</p>`}
        ${error && html`<p class="error">${error}</p>`}
      </section>

      ${state === "member" && html`<${MembersContent} account=${account} />`}
    </main>
  `;
}

render(html`<${App} />`, document.getElementById("root"));
