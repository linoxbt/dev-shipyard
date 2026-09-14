// QIE Transaction Kit: send a transaction, follow it, and tell the person
// what really happened.
//
//   sendTransaction(tx)          ensures a wallet and QIE Mainnet, returns the hash
//   waitForSuccess(hash)         resolves on success, throws if it reverted
//   useTransaction()             idle → signing → pending → success | failed
//   <TxButton tx label />        one button that does all of the above
//   <TxStatus state />           a line that says where it got to
//   <Toaster />, toast(message)  notifications
//   <ExplorerLink hash|address>  a link to the QIE explorer
//
// A transaction that is mined but reverted still costs gas and changes
// nothing, which is why "success" here means the receipt's status says so,
// not merely that a hash came back.

import { html } from "htm/preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { createPublicClient, http, toHex } from "viem";
import { CHAIN, explorerAddress, explorerTx, viemChain } from "./contract.js";
import { connect, currentAccount, currentChainId, request, switchToAppChain } from "./wallet.js";

export const publicClient = createPublicClient({ chain: viemChain, transport: http(CHAIN.rpcUrl) });

/** Serialises bigint fields the way eth_sendTransaction expects them. */
function toRpc(tx) {
  const out = { ...tx };
  for (const key of ["value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"]) {
    if (typeof out[key] === "bigint") out[key] = toHex(out[key]);
  }
  return out;
}

/**
 * Sends `tx` from the connected wallet on QIE Mainnet and returns its hash.
 * `tx` is { to, value?, data?, gas? }; bigints are fine. Pass `gas` for
 * contract writes that touch storage: QIE's gas estimate is too low for them.
 */
export async function sendTransaction(tx) {
  const from = (await currentAccount()) ?? (await connect());
  if (!from) throw new Error("Connect a wallet first.");
  if ((await currentChainId()) !== CHAIN.id) await switchToAppChain();
  return request("eth_sendTransaction", [toRpc({ from, ...tx })]);
}

/** Waits for the receipt. Resolves with it on success; throws if it reverted. */
export async function waitForSuccess(hash, { timeoutMs = 180000 } = {}) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
  if (receipt.status !== "success") {
    const error = new Error("The transaction was mined but reverted. Nothing changed, and the gas was spent.");
    error.receipt = receipt;
    throw error;
  }
  return receipt;
}

/** State for one transaction at a time. */
export function useTransaction() {
  const [state, setState] = useState({ phase: "idle", hash: null, error: "", receipt: null });

  /** Resolves with { receipt } on success, { failed: true, error } when it
   *  failed, and { rejected: true } when the person declined in their wallet. */
  const run = useCallback(async (tx) => {
    setState({ phase: "signing", hash: null, error: "", receipt: null });
    try {
      const hash = await sendTransaction(tx);
      setState({ phase: "pending", hash, error: "", receipt: null });
      const receipt = await waitForSuccess(hash);
      setState({ phase: "success", hash, error: "", receipt });
      return { receipt };
    } catch (e) {
      const message = e instanceof Error ? e.message.split("\n")[0] : "The transaction failed.";
      // A wallet rejection is a choice, not a failure worth alarming anyone about.
      const rejected = /reject|denied|cancel/i.test(message);
      setState((s) => ({ ...s, phase: rejected ? "idle" : "failed", error: rejected ? "" : message }));
      return rejected ? { rejected: true } : { failed: true, error: message };
    }
  }, []);

  const reset = useCallback(() => setState({ phase: "idle", hash: null, error: "", receipt: null }), []);
  return { ...state, run, reset, busy: state.phase === "signing" || state.phase === "pending" };
}

export function ExplorerLink({ hash, address, children }) {
  const href = hash ? explorerTx(hash) : explorerAddress(address);
  const text = children ?? (hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : address);
  return html`<a class="ds-tx-link" href=${href} target="_blank" rel="noreferrer">${text}</a>`;
}

export function TxStatus({ state }) {
  switch (state.phase) {
    case "signing":
      return html`<span class="ds-tx ds-tx-wait">Confirm in your wallet…</span>`;
    case "pending":
      return html`<span class="ds-tx ds-tx-wait">Waiting for QIE Mainnet… <${ExplorerLink} hash=${state.hash} /></span>`;
    case "success":
      return html`<span class="ds-tx ds-tx-ok">Confirmed in block ${state.receipt.blockNumber.toString()} <${ExplorerLink} hash=${state.hash} /></span>`;
    case "failed":
      return html`<span class="ds-tx ds-tx-fail">${state.error} ${state.hash && html`<${ExplorerLink} hash=${state.hash} />`}</span>`;
    default:
      return null;
  }
}

/** A button that sends `tx` (an object, or a function returning one). */
export function TxButton({ tx, label, onSuccess, class: className = "" }) {
  const txState = useTransaction();
  const onClick = async () => {
    let request;
    try {
      request = typeof tx === "function" ? await tx() : tx;
    } catch (e) {
      toast(e instanceof Error ? e.message : `${label}: could not start`, "fail");
      return;
    }
    const outcome = await txState.run(request);
    if (outcome.receipt) {
      toast(`${label}: confirmed`, "ok");
      onSuccess?.(outcome.receipt);
    } else if (outcome.failed) {
      toast(`${label}: failed`, "fail");
    }
  };
  return html`
    <div class="ds-tx-button">
      <button class=${`ds-btn ${className}`} onClick=${onClick} disabled=${txState.busy}>
        ${txState.busy ? "Working…" : label}
      </button>
      <${TxStatus} state=${txState} />
    </div>
  `;
}

// --- toasts -----------------------------------------------------------------

const listeners = new Set();
let toasts = [];
let nextId = 1;

/** Shows a notification in every mounted <Toaster />. kind: "ok" | "fail" | "info". */
export function toast(message, kind = "info", ms = 5000) {
  const id = nextId++;
  toasts = [...toasts, { id, message, kind }];
  listeners.forEach((fn) => fn(toasts));
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    listeners.forEach((fn) => fn(toasts));
  }, ms);
}

export function Toaster() {
  const [items, setItems] = useState(toasts);
  useEffect(() => {
    listeners.add(setItems);
    return () => listeners.delete(setItems);
  }, []);
  return html`
    <div class="ds-toaster" aria-live="polite">
      ${items.map((t) => html`<div key=${t.id} class=${`ds-toast ds-toast-${t.kind}`}>${t.message}</div>`)}
    </div>
  `;
}
