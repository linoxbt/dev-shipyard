// Static runtime files for a generated app, as source strings.
//
// These are authored as real JS/CSS and embedded verbatim — they contain no
// interpolation, so everything specific to a contract lives in the generated
// contract.js instead. That split is what lets the AI restyle app.js freely
// without ever being able to break the app's binding to the deployed
// contract.
//
// Generated apps run with NO build step: ES modules plus an import map, so the
// same files serve the in-app preview, the downloaded zip and a live deploy.

export const WALLET_JS = `// Wallet access for the generated app.
//
// The same file works in two places, which is the whole point:
//
//  - Standalone (downloaded, or deployed to a URL): talks to window.ethereum.
//  - Inside DevStation's preview iframe: there is no injected provider, so it
//    forwards requests to the parent window over postMessage and uses the
//    wallet the developer already has connected. No second connect flow, and
//    the iframe never needs allow-same-origin.
//
// Only wallet operations cross the bridge. All reads go straight to the RPC
// via viem, so the bridge surface stays as small as possible.

import { CHAIN } from "./contract.js";

const BRIDGE_TAG = "devstation-app-bridge";

// Methods the bridge will forward. Anything else is refused, so a compromised
// or careless generated app cannot ask the parent to do arbitrary things.
const ALLOWED = new Set([
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
]);

const embedded = typeof window !== "undefined" && window.parent !== window;

let nextId = 1;
const pending = new Map();

if (embedded && typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.tag !== BRIDGE_TAG || msg.kind !== "result") return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error));
    else entry.resolve(msg.result);
  });
}

function bridgeRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ tag: BRIDGE_TAG, kind: "request", id, method, params }, "*");
    // Never hang forever if the host goes away mid-request.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("The host wallet did not respond."));
      }
    }, 120000);
  });
}

/** True when running inside DevStation's preview. */
export const isEmbedded = embedded;

/** Does this environment have any wallet at all? */
export function hasWallet() {
  return embedded || (typeof window !== "undefined" && !!window.ethereum);
}

export async function request(method, params = []) {
  if (embedded) {
    if (!ALLOWED.has(method)) throw new Error("Method not allowed over the preview bridge: " + method);
    return bridgeRequest(method, params);
  }
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet found. Install MetaMask or another EVM wallet.");
  }
  return window.ethereum.request({ method, params });
}

export async function connect() {
  const accounts = await request("eth_requestAccounts");
  return Array.isArray(accounts) ? accounts[0] : null;
}

export async function currentAccount() {
  try {
    const accounts = await request("eth_accounts");
    return Array.isArray(accounts) && accounts.length ? accounts[0] : null;
  } catch {
    return null;
  }
}

export async function currentChainId() {
  try {
    const hex = await request("eth_chainId");
    return typeof hex === "string" ? parseInt(hex, 16) : null;
  } catch {
    return null;
  }
}

/** Ask the wallet to move to the chain this app was generated for. */
export async function switchToAppChain() {
  const hexId = "0x" + CHAIN.id.toString(16);
  try {
    await request("wallet_switchEthereumChain", [{ chainId: hexId }]);
    return true;
  } catch (err) {
    // 4902 = chain unknown to the wallet; offer to add it.
    if (err && (err.code === 4902 || String(err.message || "").includes("Unrecognized chain"))) {
      await request("wallet_addEthereumChain", [
        {
          chainId: hexId,
          chainName: CHAIN.name,
          nativeCurrency: { name: CHAIN.symbol, symbol: CHAIN.symbol, decimals: 18 },
          rpcUrls: [CHAIN.rpcUrl],
          blockExplorerUrls: [CHAIN.explorerUrl],
        },
      ]);
      return true;
    }
    throw err;
  }
}

/** Subscribe to account/chain changes where the environment supports it. */
export function onWalletChange(handler) {
  if (embedded || typeof window === "undefined" || !window.ethereum) return () => {};
  const onAccounts = () => handler();
  const onChain = () => handler();
  window.ethereum.on?.("accountsChanged", onAccounts);
  window.ethereum.on?.("chainChanged", onChain);
  return () => {
    window.ethereum.removeListener?.("accountsChanged", onAccounts);
    window.ethereum.removeListener?.("chainChanged", onChain);
  };
}
`;

export const ABI_UI_JS = `// Turning ABI entries into form controls, and form values back into
// correctly-typed arguments.
//
// Self-contained on purpose: a generated app is a standalone project and
// cannot import anything from DevStation. The type table mirrors DevStation's
// own AbiInput so behaviour matches what you saw while building.

/** Functions that only read state. */
export function readFunctions(abi) {
  return abi.filter(
    (e) => e.type === "function" && (e.stateMutability === "view" || e.stateMutability === "pure"),
  );
}

/** Functions that send a transaction. */
export function writeFunctions(abi) {
  return abi.filter(
    (e) =>
      e.type === "function" &&
      (e.stateMutability === "nonpayable" || e.stateMutability === "payable"),
  );
}

export function events(abi) {
  return abi.filter((e) => e.type === "event");
}

/**
 * Argument types this app can encode from a text field.
 *
 * Tuples and nested arrays are deliberately NOT supported: encoding them from
 * a flat form is guesswork, and a wrong encoding produces a transaction that
 * looks fine and does the wrong thing. Functions using them are shown disabled
 * with the reason, which is more honest than a form that silently misbehaves.
 */
export function isSupportedType(type) {
  if (type.startsWith("tuple")) return false;
  const base = type.endsWith("[]") ? type.slice(0, -2) : type;
  if (base.endsWith("]")) return false; // fixed-size or nested array
  if (base.startsWith("tuple")) return false;
  return (
    base === "address" ||
    base === "bool" ||
    base === "string" ||
    base === "bytes" ||
    /^bytes([1-9]|[12]\\d|3[0-2])$/.test(base) ||
    /^u?int(\\d+)?$/.test(base)
  );
}

export function unsupportedReason(fn) {
  const bad = (fn.inputs || []).filter((i) => !isSupportedType(i.type));
  if (bad.length === 0) return null;
  return "Takes " + bad.map((i) => i.type).join(", ") + " — enter these by hand in code.";
}

/** Which control to render for a Solidity type. */
export function controlFor(type) {
  const base = type.endsWith("[]") ? type.slice(0, -2) : type;
  const isList = type.endsWith("[]");
  if (base === "bool") return { kind: isList ? "text" : "bool", isList };
  if (base === "address") return { kind: "address", isList, placeholder: "0x…" };
  if (/^u?int(\\d+)?$/.test(base))
    return { kind: "number", isList, placeholder: isList ? "1, 2, 3" : "0" };
  if (base === "bytes" || /^bytes\\d+$/.test(base))
    return { kind: "text", isList, placeholder: "0x…" };
  return { kind: "text", isList, placeholder: isList ? "a, b, c" : "" };
}

function parseScalar(value, type) {
  const v = String(value).trim();
  if (type === "bool") return v === "true" || v === "1";
  if (/^u?int(\\d+)?$/.test(type)) {
    if (v === "") throw new Error("Enter a number");
    if (!/^-?\\d+$/.test(v)) throw new Error('"' + v + '" is not a whole number');
    return BigInt(v);
  }
  if (type === "address") {
    if (!/^0x[a-fA-F0-9]{40}$/.test(v)) throw new Error('"' + v + '" is not an address');
    return v;
  }
  if (type === "bytes" || /^bytes\\d+$/.test(type)) {
    if (!/^0x[0-9a-fA-F]*$/.test(v)) throw new Error("Expected hex starting 0x");
    return v;
  }
  return v; // string
}

/** Form values -> typed args, in ABI order. Throws with a readable message. */
export function parseArgs(inputs, values) {
  return (inputs || []).map((input, i) => {
    const raw = values[input.name || "arg" + i] ?? "";
    try {
      if (input.type.endsWith("[]")) {
        const base = input.type.slice(0, -2);
        const items = String(raw).trim();
        if (items === "" || items === "[]") return [];
        const parts = items.startsWith("[") ? JSON.parse(items) : items.split(",");
        return parts.map((p) => parseScalar(typeof p === "string" ? p : String(p), base));
      }
      return parseScalar(raw, input.type);
    } catch (e) {
      throw new Error((input.name || "argument " + (i + 1)) + ": " + e.message);
    }
  });
}

/** Human-readable rendering of a decoded return value. */
export function formatResult(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(formatResult).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** A uint256 that is probably a token amount, shown with 18-decimal help. */
export function maybeDecimals(value) {
  if (typeof value !== "bigint" || value < 10n ** 15n) return null;
  const whole = value / 10n ** 18n;
  const frac = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return whole.toString() + "." + frac;
}

export function shortAddress(a) {
  return a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
}

/** Stable label for a function, including overloads. */
export function signatureOf(fn) {
  return fn.name + "(" + (fn.inputs || []).map((i) => i.type).join(",") + ")";
}
`;

export const APP_JS = `// The generated app's UI.
//
// This file is yours to change — ask DevStation's agent to restyle or
// rearrange it, or edit it directly. The one file that should not be
// hand-edited is contract.js, which is generated from the deployed contract
// and keeps this app pointed at the right address and ABI.

import { html, render } from "htm/preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { createPublicClient, createWalletClient, custom, http, defineChain } from "viem";

import { CHAIN, CONTRACT } from "./contract.js";
import * as wallet from "./wallet.js";
import {
  readFunctions,
  writeFunctions,
  controlFor,
  parseArgs,
  formatResult,
  maybeDecimals,
  shortAddress,
  signatureOf,
  unsupportedReason,
} from "./abi-ui.js";

const chain = defineChain({
  id: CHAIN.id,
  name: CHAIN.name,
  nativeCurrency: { name: CHAIN.symbol, symbol: CHAIN.symbol, decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
  blockExplorers: { default: { name: "Explorer", url: CHAIN.explorerUrl } },
});

// Reads go straight to the RPC. They need no wallet, so they work before you
// connect and never touch the preview bridge.
const publicClient = createPublicClient({ chain, transport: http(CHAIN.rpcUrl) });

const txUrl = (hash) => CHAIN.explorerUrl.replace(/\\/$/, "") + "/tx/" + hash;
const addressUrl = (addr) => CHAIN.explorerUrl.replace(/\\/$/, "") + "/address/" + addr;

function Header({ account, chainId, onConnect, onSwitch, connecting }) {
  const wrongChain = account && chainId !== null && chainId !== CHAIN.id;
  return html\`
    <header class="header">
      <div>
        <h1>\${CONTRACT.name}</h1>
        <a class="addr" href=\${addressUrl(CONTRACT.address)} target="_blank" rel="noreferrer">
          \${shortAddress(CONTRACT.address)}
        </a>
        <span class="net">\${CHAIN.name}</span>
      </div>
      <div class="wallet">
        \${wrongChain
          ? html\`<button class="btn warn" onClick=\${onSwitch}>Switch to \${CHAIN.name}</button>\`
          : account
            ? html\`<span class="account">\${shortAddress(account)}</span>\`
            : html\`<button class="btn" onClick=\${onConnect} disabled=\${connecting}>
                \${connecting ? "Connecting…" : "Connect Wallet"}
              </button>\`}
      </div>
    </header>
  \`;
}

function Field({ input, index, value, onChange }) {
  const control = controlFor(input.type);
  const label = (input.name || "arg" + index) + " (" + input.type + ")";
  if (control.kind === "bool") {
    return html\`
      <label class="field">
        <span>\${label}</span>
        <select value=\${value} onChange=\${(e) => onChange(e.target.value)}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </label>
    \`;
  }
  return html\`
    <label class="field">
      <span>\${label}</span>
      <input
        type="text"
        value=\${value}
        placeholder=\${control.placeholder || ""}
        onInput=\${(e) => onChange(e.target.value)}
      />
    </label>
  \`;
}

function ReadCard({ fn }) {
  const [values, setValues] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const blocked = unsupportedReason(fn);
  const needsArgs = (fn.inputs || []).length > 0;

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const args = parseArgs(fn.inputs, values);
      const out = await publicClient.readContract({
        address: CONTRACT.address,
        abi: CONTRACT.abi,
        functionName: fn.name,
        args,
      });
      setResult(out);
    } catch (e) {
      setError(e?.shortMessage || e?.message || String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [fn, values]);

  // No-argument reads load themselves, so the app shows live state immediately.
  useEffect(() => {
    if (!needsArgs && !blocked) run();
  }, []);

  const decimals = maybeDecimals(result);
  return html\`
    <div class="card">
      <div class="card-head">
        <code>\${fn.name}</code>
        \${!blocked && html\`<button class="btn small" onClick=\${run} disabled=\${busy}>
          \${busy ? "…" : needsArgs ? "Call" : "Refresh"}
        </button>\`}
      </div>
      \${blocked
        ? html\`<p class="muted">\${blocked}</p>\`
        : html\`
            \${(fn.inputs || []).map(
              (input, i) => html\`<\${Field}
                input=\${input}
                index=\${i}
                value=\${values[input.name || "arg" + i] ?? ""}
                onChange=\${(v) => setValues({ ...values, [input.name || "arg" + i]: v })}
              />\`,
            )}
            \${error && html\`<p class="error">\${error}</p>\`}
            \${result !== null &&
            html\`<div class="result">
              <code>\${formatResult(result)}</code>
              \${decimals && html\`<span class="muted"> ≈ \${decimals} (18 decimals)</span>\`}
            </div>\`}
          \`}
    </div>
  \`;
}

function WriteCard({ fn, account, chainId, onNeedWallet }) {
  const [values, setValues] = useState({});
  const [ethValue, setEthValue] = useState("");
  const [status, setStatus] = useState(null);
  const [hash, setHash] = useState(null);
  const [error, setError] = useState(null);
  const blocked = unsupportedReason(fn);
  const payable = fn.stateMutability === "payable";

  const send = useCallback(async () => {
    setError(null);
    setHash(null);
    if (!account) return onNeedWallet();
    if (chainId !== CHAIN.id) {
      setError("Switch your wallet to " + CHAIN.name + " first.");
      return;
    }
    setStatus("Waiting for your wallet…");
    try {
      const args = parseArgs(fn.inputs, values);
      const walletClient = createWalletClient({
        account,
        chain,
        transport: custom({ request: ({ method, params }) => wallet.request(method, params) }),
      });
      // This chain's gas estimate can run low on contract creation and
      // heavier calls, so pad it rather than let the wallet under-estimate.
      let gas;
      try {
        const est = await publicClient.estimateContractGas({
          address: CONTRACT.address,
          abi: CONTRACT.abi,
          functionName: fn.name,
          args,
          account,
          value: payable && ethValue ? BigInt(ethValue) : undefined,
        });
        gas = (est * 3n) / 2n;
      } catch {
        /* let the wallet estimate */
      }
      const txHash = await walletClient.writeContract({
        address: CONTRACT.address,
        abi: CONTRACT.abi,
        functionName: fn.name,
        args,
        value: payable && ethValue ? BigInt(ethValue) : undefined,
        gas,
      });
      setHash(txHash);
      setStatus("Confirming…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      setStatus(receipt.status === "success" ? "Confirmed in block " + receipt.blockNumber : "Reverted");
    } catch (e) {
      setError(e?.shortMessage || e?.message || String(e));
      setStatus(null);
    }
  }, [fn, values, ethValue, account, chainId]);

  return html\`
    <div class="card">
      <div class="card-head">
        <code>\${fn.name}</code>
        \${payable && html\`<span class="tag">payable</span>\`}
      </div>
      \${blocked
        ? html\`<p class="muted">\${blocked}</p>\`
        : html\`
            \${(fn.inputs || []).map(
              (input, i) => html\`<\${Field}
                input=\${input}
                index=\${i}
                value=\${values[input.name || "arg" + i] ?? ""}
                onChange=\${(v) => setValues({ ...values, [input.name || "arg" + i]: v })}
              />\`,
            )}
            \${payable &&
            html\`<label class="field">
              <span>value (wei)</span>
              <input type="text" value=\${ethValue} placeholder="0" onInput=\${(e) => setEthValue(e.target.value)} />
            </label>\`}
            <button class="btn primary" onClick=\${send}>Send transaction</button>
            \${status && html\`<p class="status">\${status}</p>\`}
            \${hash &&
            html\`<a class="txlink" href=\${txUrl(hash)} target="_blank" rel="noreferrer">
              View transaction ↗
            </a>\`}
            \${error && html\`<p class="error">\${error}</p>\`}
          \`}
    </div>
  \`;
}

function App() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState(null);

  const refresh = useCallback(async () => {
    setAccount(await wallet.currentAccount());
    setChainId(await wallet.currentChainId());
  }, []);

  useEffect(() => {
    refresh();
    return wallet.onWalletChange(refresh);
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setWalletError(null);
    try {
      setAccount(await wallet.connect());
      setChainId(await wallet.currentChainId());
    } catch (e) {
      setWalletError(e?.message || String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchChain = useCallback(async () => {
    try {
      await wallet.switchToAppChain();
      await refresh();
    } catch (e) {
      setWalletError(e?.message || String(e));
    }
  }, [refresh]);

  const reads = readFunctions(CONTRACT.abi);
  const writes = writeFunctions(CONTRACT.abi);

  return html\`
    <div class="app">
      <\${Header}
        account=\${account}
        chainId=\${chainId}
        connecting=\${connecting}
        onConnect=\${connect}
        onSwitch=\${switchChain}
      />
      \${walletError && html\`<p class="error banner">\${walletError}</p>\`}
      \${!wallet.hasWallet() &&
      html\`<p class="banner muted">
        No wallet detected. Reads work without one; sending a transaction needs a wallet.
      </p>\`}

      <section>
        <h2>Read</h2>
        \${reads.length === 0
          ? html\`<p class="muted">This contract has no read functions.</p>\`
          : html\`<div class="grid">
              \${reads.map((fn) => html\`<\${ReadCard} key=\${signatureOf(fn)} fn=\${fn} />\`)}
            </div>\`}
      </section>

      <section>
        <h2>Write</h2>
        \${writes.length === 0
          ? html\`<p class="muted">This contract has no write functions.</p>\`
          : html\`<div class="grid">
              \${writes.map(
                (fn) => html\`<\${WriteCard}
                  key=\${signatureOf(fn)}
                  fn=\${fn}
                  account=\${account}
                  chainId=\${chainId}
                  onNeedWallet=\${connect}
                />\`,
              )}
            </div>\`}
      </section>

      <footer class="footer">
        Built with <a href="https://devstation.online" target="_blank" rel="noreferrer">DevStation</a>
      </footer>
    </div>
  \`;
}

render(html\`<\${App} />\`, document.getElementById("root"));
`;

export const STYLES_CSS = `/* Generated by DevStation. Edit freely — this file is only styling. */
:root {
  --bg: #0b0e14;
  --surface: #131822;
  --border: #232b3a;
  --text: #e6edf7;
  --muted: #8b97ab;
  --primary: #4f8cff;
  --success: #2ea043;
  --danger: #f85149;
  --warn: #d29922;
  --radius: 8px;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f6f8fc;
    --surface: #ffffff;
    --border: #dce3ee;
    --text: #0e1420;
    --muted: #5c6880;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1.5;
}
.app { max-width: 1100px; margin: 0 auto; padding: 24px 20px 60px; }
.header {
  display: flex; flex-wrap: wrap; gap: 12px;
  align-items: center; justify-content: space-between;
  padding-bottom: 16px; margin-bottom: 24px;
  border-bottom: 1px solid var(--border);
}
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 28px 0 12px; }
.addr { color: var(--primary); text-decoration: none; margin-right: 8px; }
.addr:hover { text-decoration: underline; }
.net { color: var(--muted); font-size: 12px; }
.account { color: var(--muted); }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.card-head code { font-weight: 700; }
.field { display: block; margin-bottom: 8px; }
.field span { display: block; font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.field input, .field select {
  width: 100%; padding: 6px 8px; font-family: var(--mono); font-size: 12px;
  color: var(--text); background: var(--bg);
  border: 1px solid var(--border); border-radius: 6px;
}
.field input:focus, .field select:focus { outline: none; border-color: var(--primary); }
.btn {
  font-family: var(--mono); font-size: 12px; cursor: pointer;
  padding: 6px 12px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
}
.btn:hover:not(:disabled) { border-color: var(--primary); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.small { padding: 3px 8px; }
.btn.primary { background: var(--primary); border-color: var(--primary); color: #fff; width: 100%; margin-top: 4px; }
.btn.warn { border-color: var(--warn); color: var(--warn); }
.result { margin-top: 8px; padding: 8px; background: var(--bg); border-radius: 6px; word-break: break-all; }
.status { color: var(--muted); font-size: 12px; margin: 8px 0 0; }
.txlink { display: inline-block; margin-top: 6px; font-size: 12px; color: var(--primary); text-decoration: none; }
.error { color: var(--danger); font-size: 12px; margin: 8px 0 0; word-break: break-word; }
.muted { color: var(--muted); font-size: 12px; }
.banner { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px; }
.tag { font-size: 10px; text-transform: uppercase; color: var(--warn); border: 1px solid var(--warn); border-radius: 4px; padding: 1px 5px; }
.footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
.footer a { color: var(--primary); text-decoration: none; }
`;
