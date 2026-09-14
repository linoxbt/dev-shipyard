// Demo of the QIE Token Form Kit: a send form, and the approve-then-act flow.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { html } from "htm/preact";
import { CHAIN, explorerTx } from "./contract.js";
import { connect, currentAccount, isEmbedded, onWalletChange } from "./wallet.js";
import {
  AmountInput,
  ApproveThenAct,
  DEFAULT_TOKENS,
  TokenSelect,
  parseAmount,
  sendToken,
  useTokenBalance,
} from "./token-form-kit.js";

function useAccount() {
  const [account, setAccount] = useState(null);
  useEffect(() => {
    const sync = async () => setAccount(await currentAccount());
    void sync();
    const stop = onWalletChange(sync);
    const timer = isEmbedded ? setInterval(sync, 4000) : null;
    return () => {
      stop();
      if (timer) clearInterval(timer);
    };
  }, []);
  return [account, setAccount];
}

function SendForm({ account }) {
  const [token, setToken] = useState(DEFAULT_TOKENS[1]);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const { balance, reload } = useTokenBalance(account, token);
  const parsed = parseAmount(amount, token.decimals).value;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const hash = await sendToken({ token, to: to.trim(), amount: parsed });
      setStatus(html`<span class="ok">Sent. <a href=${explorerTx(hash)} target="_blank" rel="noreferrer">View the transaction</a></span>`);
      setAmount("");
      await reload();
    } catch (e) {
      setStatus(html`<span class="error">${e.message.split("\n")[0]}</span>`);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <form class="panel" onSubmit=${submit}>
      <h2>Send</h2>
      <${TokenSelect} value=${token} onChange=${(t) => { setToken(t); setAmount(""); }} />
      <${AmountInput} token=${token} value=${amount} onInput=${setAmount} balance=${balance} />
      <label>Recipient<input value=${to} onInput=${(e) => setTo(e.currentTarget.value)} placeholder="0x…" /></label>
      <button type="submit" disabled=${busy || !account || !parsed || (balance != null && parsed > balance)}>
        ${busy ? "Sending…" : `Send ${token.symbol}`}
      </button>
      ${status && html`<p>${status}</p>`}
    </form>
  `;
}

function ApprovalDemo({ account }) {
  const token = DEFAULT_TOKENS[1];
  const [spender, setSpender] = useState("");
  const [amount, setAmount] = useState("1");
  const { balance } = useTokenBalance(account, token);
  return html`
    <section class="panel">
      <h2>Approve, then act</h2>
      <p class="meta">
        Approves exactly the amount a contract needs, then runs its action. Put the address of a
        contract you use as the spender. The action here is a placeholder: in your app,
        <code>buildTx</code> returns the deposit, purchase or stake.
      </p>
      <label>Spender contract<input value=${spender} onInput=${(e) => setSpender(e.currentTarget.value.trim())} placeholder="0x…" /></label>
      <${AmountInput} token=${token} value=${amount} onInput=${setAmount} balance=${balance} />
      <${ApproveThenAct}
        owner=${account}
        token=${token}
        spender=${spender}
        amount=${parseAmount(amount, token.decimals).value}
        actLabel="Run the action"
        buildTx=${async () => {
          throw new Error("Allowance is in place. Replace buildTx with your contract call.");
        }}
      />
    </section>
  `;
}

function App() {
  const [account, setAccount] = useAccount();
  return html`
    <main>
      <header>
        <div>
          <h1>QIE Token Form Kit</h1>
          <p class="sub">Exact amounts, token choice, sends and approvals on ${CHAIN.name}.</p>
        </div>
        ${account
          ? html`<code>${account.slice(0, 6)}…${account.slice(-4)}</code>`
          : html`<button onClick=${async () => setAccount(await connect())}>Connect wallet</button>`}
      </header>
      <${SendForm} account=${account} />
      <${ApprovalDemo} account=${account} />
    </main>
  `;
}

render(html`<${App} />`, document.getElementById("root"));
