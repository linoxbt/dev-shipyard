// Wallet access for the generated app.
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
