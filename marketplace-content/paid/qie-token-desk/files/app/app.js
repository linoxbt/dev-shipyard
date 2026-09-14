// Token Desk: inspect and operate any ERC-20 token on QIE Mainnet.
//
// Load a token by address (QUSDC to start with) and see its name, symbol,
// decimals, supply and your balance. Transfer it, approve a spender, check an
// allowance and revoke it. Every write carries an explicit gas limit, and is
// reported done only when its receipt says it succeeded.

import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { html } from "htm/preact";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  maxUint256,
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
import {
  connect,
  currentAccount,
  currentChainId,
  isEmbedded,
  onWalletChange,
  request,
  switchToAppChain,
} from "./wallet.js";

const client = createPublicClient({ chain: viemChain, transport: http(CHAIN.rpcUrl) });

function short(value, decimals) {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}`;
}

/** Name, symbol, decimals and supply, all at once. A contract that answers
 *  none of them is not an ERC-20, and saying so beats showing blanks. */
async function readToken(address, holder) {
  const call = (functionName, args = []) =>
    client.readContract({ address, abi: ERC20_ABI, functionName, args });
  let name, symbol, decimals, totalSupply;
  try {
    [name, symbol, decimals, totalSupply] = await Promise.all([
      call("name"),
      call("symbol"),
      call("decimals"),
      call("totalSupply"),
    ]);
  } catch {
    throw new Error("That address did not answer as an ERC-20 token on QIE Mainnet.");
  }
  const balance = holder ? await call("balanceOf", [holder]) : null;
  return { address, name, symbol, decimals: Number(decimals), totalSupply, balance };
}

function amountOf(text, decimals) {
  const value = text.trim();
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  if ((value.split(".")[1] ?? "").length > decimals) return null;
  return parseUnits(value, decimals);
}

/** Sends one token call and waits for it to succeed on chain. */
async function tokenWrite(from, token, functionName, args) {
  if ((await currentChainId()) !== CHAIN.id) await switchToAppChain();
  const hash = await request("eth_sendTransaction", [
    {
      from,
      to: token,
      value: "0x0",
      gas: toHex(TOKEN_WRITE_GAS),
      data: encodeFunctionData({ abi: ERC20_ABI, functionName, args }),
    },
  ]);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    const error = new Error("The transaction was mined but reverted.");
    error.hash = hash;
    throw error;
  }
  return hash;
}

function App() {
  const [account, setAccount] = useState(null);
  const [tokenInput, setTokenInput] = useState(QUSDC.address);
  const [token, setToken] = useState(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [spender, setSpender] = useState("");
  const [approveAmount, setApproveAmount] = useState("");
  const [allowance, setAllowance] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState([]);

  const syncAccount = useCallback(async () => setAccount(await currentAccount()), []);
  useEffect(() => {
    void syncAccount();
    const stop = onWalletChange(syncAccount);
    // The preview bridge has no change events: look again now and then.
    const timer = isEmbedded ? setInterval(syncAccount, 4000) : null;
    return () => {
      stop();
      if (timer) clearInterval(timer);
    };
  }, [syncAccount]);

  const load = useCallback(async (address, holder) => {
    setError("");
    if (!isAddress(address)) return setError("Enter a token contract address.");
    setBusy("load");
    try {
      setToken(await readToken(address, holder));
      setAllowance(null);
    } catch (e) {
      setToken(null);
      setError(e.message);
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    void load(tokenInput, account);
    // Reload when the wallet changes; the input reloads on submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const run = async (label, fn) => {
    setError("");
    setBusy(label);
    try {
      const from = account ?? (await connect());
      if (!from) throw new Error("Connect a wallet first.");
      setAccount(from);
      const hash = await fn(from);
      setLog((entries) => [{ label, hash }, ...entries].slice(0, 10));
      await load(token.address, from);
    } catch (e) {
      setError(e.message.split("\n")[0]);
      if (e.hash) setLog((entries) => [{ label: `${label} (failed)`, hash: e.hash }, ...entries]);
    } finally {
      setBusy("");
    }
  };

  const onConnect = async () => {
    setError("");
    try {
      setAccount(await connect());
    } catch (e) {
      setError(e.message.split("\n")[0]);
    }
  };

  const transfer = () =>
    run("Transfer", (from) => {
      const value = amountOf(amount, token.decimals);
      if (!isAddress(to)) throw new Error("Enter the address to send to.");
      if (value === null || value === 0n) throw new Error(`Enter an amount with at most ${token.decimals} decimals.`);
      if (token.balance !== null && value > token.balance) throw new Error("That is more than this wallet holds.");
      return tokenWrite(from, token.address, "transfer", [to, value]);
    });

  const approve = (unlimited, revoke) =>
    run(revoke ? "Revoke" : "Approve", (from) => {
      if (!isAddress(spender)) throw new Error("Enter the spender's address.");
      const value = revoke ? 0n : unlimited ? maxUint256 : amountOf(approveAmount, token.decimals);
      if (value === null) throw new Error(`Enter an amount with at most ${token.decimals} decimals.`);
      return tokenWrite(from, token.address, "approve", [spender, value]);
    });

  const checkAllowance = async () => {
    setError("");
    if (!account) return setError("Connect a wallet to check its allowances.");
    if (!isAddress(spender)) return setError("Enter the spender's address.");
    setAllowance(
      await client.readContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account, spender],
      }),
    );
  };

  return html`
    <main>
      <header>
        <div>
          <h1>Token Desk</h1>
          <p class="sub">Any ERC-20 on ${CHAIN.name}: inspect, transfer, approve, revoke.</p>
        </div>
        ${account
          ? html`<code>${account.slice(0, 6)}…${account.slice(-4)}</code>`
          : html`<button onClick=${onConnect}>Connect wallet</button>`}
      </header>

      <form class="panel" onSubmit=${(e) => { e.preventDefault(); void load(tokenInput.trim(), account); }}>
        <label>Token contract<input value=${tokenInput} onInput=${(e) => setTokenInput(e.currentTarget.value)} /></label>
        <button type="submit" disabled=${busy === "load"}>${busy === "load" ? "Loading…" : "Load token"}</button>
      </form>

      ${error && html`<p class="error">${error}</p>`}

      ${token && html`
        <section class="panel">
          <div class="row">
            <h2>${token.name} (${token.symbol})</h2>
            <a href=${explorerAddress(token.address)} target="_blank" rel="noreferrer">explorer</a>
          </div>
          <div class="grid">
            <div class="card"><div class="label">Decimals</div><div class="value">${token.decimals}</div></div>
            <div class="card"><div class="label">Total supply</div><div class="value">${short(token.totalSupply, token.decimals)}</div></div>
            <div class="card"><div class="label">Your balance</div><div class="value">${token.balance === null ? "—" : short(token.balance, token.decimals)}</div></div>
          </div>
        </section>

        <section class="panel">
          <h2>Transfer</h2>
          <label>To<input value=${to} onInput=${(e) => setTo(e.currentTarget.value.trim())} placeholder="0x…" /></label>
          <div class="two">
            <label>Amount<input value=${amount} inputmode="decimal" onInput=${(e) => setAmount(e.currentTarget.value.trim())} /></label>
            <button type="button" class="ghost" disabled=${token.balance === null} onClick=${() => setAmount(formatUnits(token.balance, token.decimals))}>Max</button>
          </div>
          <button onClick=${transfer} disabled=${!!busy}>${busy === "Transfer" ? "Sending…" : `Send ${token.symbol}`}</button>
        </section>

        <section class="panel">
          <h2>Allowances</h2>
          <label>Spender<input value=${spender} onInput=${(e) => setSpender(e.currentTarget.value.trim())} placeholder="0x… a contract you are letting spend this token" /></label>
          <div class="two">
            <button class="ghost" onClick=${checkAllowance}>Check allowance</button>
            <button class="ghost" onClick=${() => approve(false, true)} disabled=${!!busy}>Revoke</button>
          </div>
          ${allowance !== null && html`<p class="meta">Allowance: ${allowance === maxUint256 ? "unlimited" : short(allowance, token.decimals)} ${token.symbol}</p>`}
          <div class="two">
            <label>Approve amount<input value=${approveAmount} inputmode="decimal" onInput=${(e) => setApproveAmount(e.currentTarget.value.trim())} /></label>
            <button onClick=${() => approve(false, false)} disabled=${!!busy}>Approve</button>
          </div>
          <p class="meta">Approve only the amount a contract needs. <a href="#" onClick=${(e) => { e.preventDefault(); approve(true, false); }}>Approve unlimited</a> only for contracts you trust completely.</p>
        </section>
      `}

      ${log.length > 0 && html`
        <section class="panel">
          <h2>This session</h2>
          <ul class="log">
            ${log.map((entry) => html`<li>${entry.label}: <a href=${explorerTx(entry.hash)} target="_blank" rel="noreferrer">${entry.hash.slice(0, 18)}…</a></li>`)}
          </ul>
        </section>
      `}
    </main>
  `;
}

render(html`<${App} />`, document.getElementById("root"));
