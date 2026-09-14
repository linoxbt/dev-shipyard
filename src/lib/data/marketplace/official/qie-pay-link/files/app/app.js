// QIE Pay Link: request a payment in QIE or QUSDC with a link, and pay one.
//
// A request is only a link: ?to=<address>&amount=<number>&token=QIE|QUSDC&memo=
// Nothing is stored anywhere. Whoever opens it sees the request, connects a
// wallet and pays; the app waits for the receipt and checks that the
// transaction succeeded, not just that it was sent.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { html } from "htm/preact";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  toHex,
} from "viem";
import {
  CHAIN,
  ERC20_ABI,
  QUSDC,
  TOKEN_WRITE_GAS,
  explorerAddress,
  explorerTx,
  viemChain,
} from "./contract.js";
import { connect, currentAccount, currentChainId, request, switchToAppChain } from "./wallet.js";

const client = createPublicClient({ chain: viemChain, transport: http(CHAIN.rpcUrl) });
const TOKENS = { QIE: { symbol: "QIE", decimals: 18 }, QUSDC };

/** Reads a request from a link, a query string, or the page's own address. */
function parseRequest(text) {
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : text;
  const params = new URLSearchParams(query);
  const to = (params.get("to") ?? "").trim();
  const amount = (params.get("amount") ?? "").trim();
  const token = (params.get("token") ?? "QIE").toUpperCase();
  if (!isAddress(to) || !/^\d+(\.\d+)?$/.test(amount) || !TOKENS[token]) return null;
  const decimals = TOKENS[token].decimals;
  if ((amount.split(".")[1] ?? "").length > decimals) return null;
  return { to, amount, token, memo: (params.get("memo") ?? "").slice(0, 140) };
}

function linkFor(req) {
  const params = new URLSearchParams({ to: req.to, amount: req.amount, token: req.token });
  if (req.memo) params.set("memo", req.memo);
  const query = `?${params.toString()}`;
  // Inside a preview the page has no shareable address; give the query to append.
  return /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}${query}` : query;
}

function RequestForm({ onCreated }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("QUSDC");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void currentAccount().then((acc) => acc && setTo((value) => value || acc));
  }, []);

  const submit = (event) => {
    event.preventDefault();
    const req = parseRequest(new URLSearchParams({ to, amount, token, memo }).toString());
    if (!req) return setError(`Enter a valid address and an amount with at most ${TOKENS[token].decimals} decimals.`);
    setError("");
    onCreated(req);
  };

  return html`
    <form class="panel" onSubmit=${submit}>
      <h2>Request a payment</h2>
      <label>Pay to<input value=${to} onInput=${(e) => setTo(e.currentTarget.value.trim())} placeholder="0x…" /></label>
      <div class="two">
        <label>Amount<input value=${amount} onInput=${(e) => setAmount(e.currentTarget.value.trim())} inputmode="decimal" placeholder="25" /></label>
        <label>Token
          <select value=${token} onChange=${(e) => setToken(e.currentTarget.value)}>
            <option value="QUSDC">QUSDC</option>
            <option value="QIE">QIE</option>
          </select>
        </label>
      </div>
      <label>Note for the payer (optional, not stored on chain)<input value=${memo} maxlength="140" onInput=${(e) => setMemo(e.currentTarget.value)} placeholder="Invoice #1042" /></label>
      ${error && html`<p class="error">${error}</p>`}
      <button type="submit">Create link</button>
    </form>
  `;
}

function PayView({ req, onBack }) {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState(null);
  const token = TOKENS[req.token];

  const pay = async () => {
    setMessage("");
    try {
      setStatus("connecting");
      const from = (await currentAccount()) ?? (await connect());
      if (!from) throw new Error("Connect a wallet to pay.");
      if ((await currentChainId()) !== CHAIN.id) await switchToAppChain();

      const value = parseUnits(req.amount, token.decimals);
      const balance =
        req.token === "QIE"
          ? await client.getBalance({ address: from })
          : await client.readContract({ address: QUSDC.address, abi: ERC20_ABI, functionName: "balanceOf", args: [from] });
      if (balance < value) {
        throw new Error(`This wallet has ${formatUnits(balance, token.decimals)} ${req.token}, less than the ${req.amount} requested.`);
      }

      setStatus("signing");
      const tx =
        req.token === "QIE"
          ? { from, to: req.to, value: toHex(value) }
          : {
              from,
              to: QUSDC.address,
              value: "0x0",
              gas: toHex(TOKEN_WRITE_GAS),
              data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [req.to, value] }),
            };
      const sent = await request("eth_sendTransaction", [tx]);
      setHash(sent);

      setStatus("confirming");
      const receipt = await client.waitForTransactionReceipt({ hash: sent });
      if (receipt.status !== "success") throw new Error("The transaction was mined but failed. Nothing was paid.");
      setStatus("paid");
    } catch (e) {
      setStatus("idle");
      setMessage(e instanceof Error ? e.message.split("\n")[0] : "The payment did not go through.");
    }
  };

  const busy = ["connecting", "signing", "confirming"].includes(status);
  return html`
    <div class="panel">
      <h2>Payment request</h2>
      <div class="amount">${req.amount} <span>${req.token}</span></div>
      <p>to <a href=${explorerAddress(req.to)} target="_blank" rel="noreferrer">${req.to}</a></p>
      ${req.memo && html`<p class="memo">“${req.memo}”</p>`}
      ${status === "paid"
        ? html`<p class="ok">Paid. <a href=${explorerTx(hash)} target="_blank" rel="noreferrer">View the transaction</a></p>`
        : html`<button onClick=${pay} disabled=${busy}>
            ${status === "connecting" ? "Connecting…" : status === "signing" ? "Confirm in your wallet…" : status === "confirming" ? "Waiting for the chain…" : `Pay ${req.amount} ${req.token}`}
          </button>`}
      ${hash && status !== "paid" && html`<p class="meta"><a href=${explorerTx(hash)} target="_blank" rel="noreferrer">Transaction sent</a></p>`}
      ${message && html`<p class="error">${message}</p>`}
      <button class="ghost" onClick=${onBack}>Make another request</button>
    </div>
  `;
}

function App() {
  const [req, setReq] = useState(() => parseRequest(location.search));
  const [created, setCreated] = useState(null);
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);

  if (req) return html`<main><${PayView} req=${req} onBack=${() => setReq(null)} /></main>`;

  const link = created ? linkFor(created) : "";
  return html`
    <main>
      <h1>QIE Pay Link</h1>
      <p class="sub">Ask for QIE or QUSDC on ${CHAIN.name} with a link. Nothing is stored: the link is the request.</p>
      <${RequestForm} onCreated=${(r) => { setCreated(r); setCopied(false); }} />
      ${created && html`
        <div class="panel">
          <h2>Your link</h2>
          <code class="link">${link}</code>
          <div class="two">
            <button onClick=${() => { void navigator.clipboard?.writeText(link); setCopied(true); }}>${copied ? "Copied" : "Copy link"}</button>
            <button class="ghost" onClick=${() => setReq(created)}>Open as the payer</button>
          </div>
          ${!/^https?:$/.test(location.protocol) && html`<p class="meta">Published at a web address, this becomes a full link. For now it is the part to add after the address.</p>`}
        </div>`}
      <form class="panel" onSubmit=${(e) => { e.preventDefault(); const r = parseRequest(pasted); if (r) setReq(r); }}>
        <h2>Pay a request</h2>
        <label>Paste a pay link<input value=${pasted} onInput=${(e) => setPasted(e.currentTarget.value)} placeholder="https://…?to=0x…&amount=25&token=QUSDC" /></label>
        <button type="submit" disabled=${!parseRequest(pasted)}>Open</button>
      </form>
    </main>
  `;
}

render(html`<${App} />`, document.getElementById("root"));
