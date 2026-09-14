// QIE Portfolio: what a wallet holds on QIE Mainnet, read straight from chain.
//
// QIE and QUSDC balances and QIE ID tokens, for the connected wallet or any
// address pasted in. Reads go to the QIE RPC directly; the wallet is only
// asked for the connected address.

import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { html } from "htm/preact";
import { createPublicClient, formatUnits, http, isAddress } from "viem";
import { CHAIN, ERC20_ABI, QIE_ID, QUSDC, explorerAddress, viemChain } from "./contract.js";
import { connect, currentAccount, hasWallet, onWalletChange } from "./wallet.js";

const client = createPublicClient({ chain: viemChain, transport: http(CHAIN.rpcUrl) });

/** At most four decimals on screen; the explorer has the exact figure. */
function short(value, decimals) {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}`;
}

async function holdings(address) {
  const [qie, qusdc, qieId, block] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({
      address: QUSDC.address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
    client.readContract({ address: QIE_ID, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
    client.getBlockNumber(),
  ]);
  return { qie, qusdc, qieId, block };
}

function Card({ label, value, unit, note }) {
  return html`
    <div class="card">
      <div class="label">${label}</div>
      <div class="value">${value} <span class="unit">${unit}</span></div>
      ${note && html`<div class="note">${note}</div>`}
    </div>
  `;
}

function App() {
  const [account, setAccount] = useState(null);
  const [lookup, setLookup] = useState("");
  const [target, setTarget] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sync = async () => {
      const acc = await currentAccount();
      setAccount(acc);
      if (acc) setTarget((current) => current ?? acc);
    };
    void sync();
    return onWalletChange(sync);
  }, []);

  const load = useCallback(async (address) => {
    if (!address) return;
    setLoading(true);
    setError("");
    try {
      setData(await holdings(address));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message.split("\n")[0] : "Could not read the chain.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(target);
  }, [target, load]);

  const onConnect = async () => {
    setError("");
    try {
      const acc = await connect();
      setAccount(acc);
      setTarget(acc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The wallet did not connect.");
    }
  };

  const onLookup = (event) => {
    event.preventDefault();
    const value = lookup.trim();
    if (!isAddress(value)) return setError("That is not a valid address.");
    setTarget(value);
  };

  return html`
    <main>
      <header>
        <div>
          <h1>QIE Portfolio</h1>
          <p class="sub">Balances on ${CHAIN.name}, read from the chain.</p>
        </div>
        ${account
          ? html`<span class="pill">${account.slice(0, 6)}…${account.slice(-4)}</span>`
          : hasWallet()
            ? html`<button onClick=${onConnect}>Connect wallet</button>`
            : html`<span class="pill muted">No wallet found</span>`}
      </header>

      <form class="lookup" onSubmit=${onLookup}>
        <input
          placeholder="Look up any address: 0x…"
          value=${lookup}
          onInput=${(e) => setLookup(e.currentTarget.value)}
        />
        <button type="submit">Look up</button>
        ${account && target !== account
          ? html`<button type="button" class="ghost" onClick=${() => setTarget(account)}>My wallet</button>`
          : null}
      </form>

      ${error && html`<p class="error">${error}</p>`}

      ${target
        ? html`
            <section>
              <div class="row">
                <a href=${explorerAddress(target)} target="_blank" rel="noreferrer">${target}</a>
                <button class="ghost" onClick=${() => load(target)} disabled=${loading}>
                  ${loading ? "Reading…" : "Refresh"}
                </button>
              </div>
              <div class="grid">
                <${Card} label="QIE" value=${data ? short(data.qie, 18) : "…"} unit="QIE" note="Native coin, pays for gas" />
                <${Card} label="QUSDC" value=${data ? short(data.qusdc, QUSDC.decimals) : "…"} unit="QUSDC" note="QIE's dollar stablecoin" />
                <${Card}
                  label="QIE ID"
                  value=${data ? data.qieId.toString() : "…"}
                  unit=${data && data.qieId === 1n ? "token" : "tokens"}
                  note="Includes free names QIE hands out"
                />
              </div>
              ${data && html`<p class="meta">As of block ${data.block.toLocaleString("en-US")}</p>`}
            </section>
          `
        : html`<p class="empty">Connect a wallet or look up an address to see its balances.</p>`}
    </main>
  `;
}

render(html`<${App} />`, document.getElementById("root"));
