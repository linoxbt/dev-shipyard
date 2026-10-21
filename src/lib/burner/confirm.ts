// Explicit approval for anything that signs.
//
// The in-app wallet used to sign the moment it was asked: eth_sendTransaction,
// personal_sign and eth_signTypedData_v4 went straight to the key. An extension
// wallet always shows a popup; this one showed nothing, so any code that could
// reach the provider (an app running in the preview, a marketplace app, an
// injected script) could move funds or sign a token permit silently.
//
// Now every signing request is described in plain terms and has to be
// approved in a DevStation dialog. With no dialog available (server render,
// tests, no DOM) the answer is no: default deny.

import { formatEther, hexToString, isHex, type Hex } from "viem";

export type SignKind = "transaction" | "message" | "typedData" | "addChain";

export interface SignRequest {
  kind: SignKind;
  /** Where the request came from. "preview" is code DevStation did not write. */
  source: "app" | "preview";
  title: string;
  /** Label/value pairs shown to the person approving. */
  rows: Array<[string, string]>;
  /** Shown prominently when the request is unusually dangerous. */
  warning?: string;
}

/** EIP-2612 and Permit2 typed data: a signature that lets someone else spend
 *  your tokens later, with no transaction from you. The classic drain. */
const PERMIT_TYPES = new Set([
  "Permit",
  "PermitSingle",
  "PermitBatch",
  "PermitTransferFrom",
  "PermitBatchTransferFrom",
  "PermitWitnessTransferFrom",
]);

export function typedDataOf(json: unknown): {
  primaryType?: string;
  domain?: Record<string, unknown>;
  message?: Record<string, unknown>;
} | null {
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    return parsed && typeof parsed === "object" ? (parsed as never) : null;
  } catch {
    return null;
  }
}

export function isPermitTypedData(json: unknown): boolean {
  const td = typedDataOf(json);
  return !!td?.primaryType && PERMIT_TYPES.has(td.primaryType);
}

function readableMessage(raw: unknown): string {
  if (typeof raw !== "string") return String(raw);
  if (isHex(raw)) {
    try {
      const text = hexToString(raw as Hex);
      // Only show it as text when it is text: no control characters other
      // than tab and newlines.
      const printable = [...text].every((ch) => {
        const c = ch.codePointAt(0)!;
        return c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127);
      });
      if (printable) return text;
    } catch {
      /* fall through to hex */
    }
  }
  return raw;
}

const short = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A plain-language description of a wallet request, or null when the method
 *  does not sign anything. */
export function describeRequest(
  method: string,
  params: unknown,
  chainName: string,
  source: SignRequest["source"],
): SignRequest | null {
  const p = Array.isArray(params) ? params : [];
  switch (method) {
    case "eth_sendTransaction": {
      const tx = (p[0] ?? {}) as { to?: string; value?: string | bigint; data?: string };
      const value = tx.value === undefined ? 0n : BigInt(tx.value);
      const data = typeof tx.data === "string" ? tx.data : "0x";
      return {
        kind: "transaction",
        source,
        title: tx.to ? "Send a transaction" : "Deploy a contract",
        rows: [
          ["Network", chainName],
          ["To", tx.to ?? "(new contract)"],
          ["Value", `${formatEther(value)}`],
          [
            "Data",
            data.length > 2 ? `${data.slice(0, 10)}… (${(data.length - 2) / 2} bytes)` : "none",
          ],
        ],
      };
    }
    case "personal_sign": {
      return {
        kind: "message",
        source,
        title: "Sign a message",
        rows: [
          ["Network", chainName],
          ["Message", short(readableMessage(p[0]))],
        ],
      };
    }
    case "eth_signTypedData_v4": {
      const td = typedDataOf(p[1]);
      const domain = td?.domain ?? {};
      const permit = isPermitTypedData(p[1]);
      return {
        kind: "typedData",
        source,
        title: `Sign typed data: ${td?.primaryType ?? "unknown"}`,
        rows: [
          ["Network", chainName],
          ["App", String(domain.name ?? "(none)")],
          ["Contract", String(domain.verifyingContract ?? "(none)")],
          ["Chain id", String(domain.chainId ?? "(none)")],
          ["Contents", short(JSON.stringify(td?.message ?? {}, (_k, v) => String(v)))],
        ],
        warning: permit
          ? "This is a token permit. Signing it lets the spender move your tokens later without asking again."
          : undefined,
      };
    }
    case "wallet_addEthereumChain": {
      const c = (p[0] ?? {}) as { chainName?: string; chainId?: string; rpcUrls?: string[] };
      return {
        kind: "addChain",
        source,
        title: "Add a network",
        rows: [
          ["Name", c.chainName ?? "(none)"],
          ["Chain id", String(c.chainId ?? "(none)")],
          ["RPC", (c.rpcUrls ?? []).join(", ") || "(none)"],
        ],
      };
    }
    default:
      return null;
  }
}

type Confirmer = (req: SignRequest) => Promise<boolean>;
let confirmer: Confirmer | null = null;

/** Replace the dialog, for tests. Null restores the default. */
export function setSignConfirmer(fn: Confirmer | null): void {
  confirmer = fn;
}

/** Ask the person. Resolves false without a DOM to ask in. */
export async function confirmSign(req: SignRequest): Promise<boolean> {
  if (confirmer) return confirmer(req);
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const { showConfirmDialog } = await import("./ConfirmDialog");
    return await showConfirmDialog(req);
  } catch {
    return false;
  }
}

// A preview request is approved once, in the preview's own dialog. When the
// connected wallet is the in-app one, that same request then reaches the
// burner, which would ask again. The bridge marks it pre-approved instead:
// one exact request, consumed on use, expiring quickly.
const PREAPPROVAL_TTL_MS = 30_000;
const preapproved = new Map<string, number>();

function requestKey(method: string, params: unknown): string | null {
  try {
    return `${method}:${JSON.stringify(params, (_k, v) =>
      typeof v === "bigint" ? `0x${v.toString(16)}` : typeof v === "string" ? v.toLowerCase() : v,
    )}`;
  } catch {
    return null;
  }
}

export function preapprove(method: string, params: unknown): void {
  const key = requestKey(method, params);
  if (key) preapproved.set(key, Date.now() + PREAPPROVAL_TTL_MS);
}

export function consumePreapproval(method: string, params: unknown): boolean {
  const key = requestKey(method, params);
  if (!key) return false;
  const until = preapproved.get(key);
  preapproved.delete(key);
  return until !== undefined && until > Date.now();
}

/** The EIP-1193 "user rejected" error, so wagmi and viem report it as one. */
export function userRejected(): Error & { code: number } {
  const err = new Error("You rejected the request in DevStation.") as Error & { code: number };
  err.code = 4001;
  return err;
}
