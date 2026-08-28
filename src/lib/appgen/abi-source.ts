// Resolving a contract's ABI for the App Builder.
//
// Three sources, one normalised result. The ordering matters: a contract
// deployed in THIS browser has its ABI in localStorage and needs no network
// call, but that is the only place it exists — ProjectRegistry stores just
// five strings onchain, with no ABI and no chainId. So a project restored from
// chain (different device, cleared storage) must fall through to the explorer
// rather than being treated as "no ABI available".

import { getContractAbi } from "@/lib/api/verify.functions";
import { storage } from "@/lib/storage";

export type AbiSourceKind = "session" | "explorer" | "pasted";

export interface ResolvedAbi {
  abi: unknown[];
  address: `0x${string}`;
  chainId: number;
  /** Contract name if known — used for headings in the generated app. */
  name: string | null;
  source: AbiSourceKind;
  /** False for a pasted ABI, or an explorer hit that is somehow unverified. */
  verified: boolean;
}

export type AbiResult = { ok: true; value: ResolvedAbi } | { ok: false; message: string };

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** An ABI must at least be an array of objects with a `type`, or every
 *  downstream encode call fails with something opaque. */
export function looksLikeAbi(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (e) =>
        typeof e === "object" && e !== null && typeof (e as { type?: unknown }).type === "string",
    )
  );
}

/** A contract deployed through DevStation in this browser. */
export function fromSession(address: string, chainId?: number): AbiResult {
  if (!ADDRESS_RE.test(address)) return { ok: false, message: "That is not a valid address." };
  const target = address.toLowerCase();
  const project = storage
    .loadProjects()
    .find((p) => p.address?.toLowerCase() === target && looksLikeAbi(p.abi));
  if (!project || !looksLikeAbi(project.abi)) {
    return {
      ok: false,
      message: "No locally stored ABI for that deploy — falling back to the explorer.",
    };
  }
  // chainId is absent on records reconstructed from the onchain registry.
  const resolvedChain = project.chainId ?? chainId;
  if (!resolvedChain) {
    return { ok: false, message: "That stored deploy has no network recorded." };
  }
  return {
    ok: true,
    value: {
      abi: project.abi,
      address: address as `0x${string}`,
      chainId: resolvedChain,
      name: project.templateName ?? project.name ?? null,
      source: "session",
      verified: project.status === "VERIFIED",
    },
  };
}

/** Any verified contract on a supported chain. */
export async function fromExplorer(address: string, chainId: number): Promise<AbiResult> {
  if (!ADDRESS_RE.test(address)) return { ok: false, message: "That is not a valid address." };
  const res = await getContractAbi({ data: { chainId, address } });
  if (!res.ok) return { ok: false, message: res.message ?? "Could not read that contract." };
  let abi: unknown;
  try {
    abi = JSON.parse(res.abiJson ?? "");
  } catch {
    return { ok: false, message: "The explorer returned an ABI that could not be parsed." };
  }
  if (!looksLikeAbi(abi)) {
    return { ok: false, message: "The explorer returned an ABI in an unexpected shape." };
  }
  return {
    ok: true,
    value: {
      abi,
      address: address as `0x${string}`,
      chainId,
      name: res.name ?? null,
      source: "explorer",
      verified: res.verified === true,
    },
  };
}

/** A hand-pasted ABI, for unverified or not-yet-deployed contracts. */
export function fromPasted(address: string, chainId: number, json: string): AbiResult {
  if (!ADDRESS_RE.test(address)) return { ok: false, message: "That is not a valid address." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, message: `That is not valid JSON: ${e instanceof Error ? e.message : ""}` };
  }
  // Accept both a bare ABI array and a full artifact object like Hardhat's.
  const abi = looksLikeAbi(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        looksLikeAbi((parsed as { abi?: unknown }).abi)
      ? (parsed as { abi: unknown[] }).abi
      : null;
  if (!abi) {
    return {
      ok: false,
      message:
        "That does not look like an ABI — expected a JSON array, or an artifact with an `abi` field.",
    };
  }
  return {
    ok: true,
    value: {
      abi,
      address: address as `0x${string}`,
      chainId,
      name: null,
      source: "pasted",
      verified: false,
    },
  };
}

/**
 * Best-effort resolve: local first (free, instant), explorer second.
 * Used when the user picks a contract rather than pasting one.
 */
export async function resolveAbi(address: string, chainId: number): Promise<AbiResult> {
  const local = fromSession(address, chainId);
  if (local.ok) return local;
  return fromExplorer(address, chainId);
}
