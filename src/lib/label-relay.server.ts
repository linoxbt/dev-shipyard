import { createPublicClient, createWalletClient, decodeFunctionData, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SUPPORTED_CHAINS, chainConfig } from "@/lib/chains";
import { contractLabelRegistryAbi } from "@/lib/abis/contractLabelRegistry";
import { isContractConfigured, labelRegistryAddress } from "@/lib/contracts";
import { fetchExplorer } from "@/lib/api/explorer-fetch";

// Server-side auto-labels for contracts deployed through DevStation.
//
// The label registry lets only its `autoLabeler` publish a trusted label, so a
// user's own wallet can only file a community label (which is why every
// "auto-label" from a user's wallet used to revert). DevStation holds the
// auto-labeler key here and labels a contract only after proving, from the
// chain itself, that the signed-in wallet created it in the last day, and only
// when no one else has labelled it and the name is not a reserved one. The ProjectRegistry record is not enough: anyone can record any address.
//
// AUTOLABELER_PRIVATE_KEY is the key; AUTOLABELER_PRIVATE_KEY_<CHAINID> (for
// example AUTOLABELER_PRIVATE_KEY_677) overrides it for one chain. Unset means
// no relay, and the app files a community label from the user's wallet as
// before.

const PK_RE = /^0x[0-9a-fA-F]{64}$/;

function keyFor(chainId: number): `0x${string}` | null {
  const k =
    process.env[`AUTOLABELER_PRIVATE_KEY_${chainId}`] || process.env.AUTOLABELER_PRIVATE_KEY;
  return k && PK_RE.test(k) ? (k as `0x${string}`) : null;
}

export function relayChain(chainId: number): Chain | null {
  return (SUPPORTED_CHAINS as readonly Chain[]).find((c) => c.id === chainId) ?? null;
}

export function isRelayConfigured(chainId: number): boolean {
  return (
    !!relayChain(chainId) &&
    !!keyFor(chainId) &&
    isContractConfigured(labelRegistryAddress(chainId))
  );
}

/** How long after its creation a contract can still be auto-labelled. The
 *  relay is for "I just deployed this through DevStation", not for labelling
 *  arbitrary old contracts with DevStation's name on them. */
export const RELAY_WINDOW_SECONDS = 24 * 60 * 60;

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export interface Creation {
  /** The wallet that sent the creating transaction, lowercased. */
  from: string;
  /** Unix seconds of the creating block. */
  timestamp: number;
}

/**
 * Who created `address` on `chainId`, and when. The explorer only supplies the
 * creating transaction's hash; the chain's own RPC proves the rest: that the
 * transaction succeeded, created exactly this address (a direct deploy, not
 * one through a factory), and who sent it. Null when any of that can't be
 * shown.
 */
export async function contractCreation(chainId: number, address: string): Promise<Creation | null> {
  const chain = relayChain(chainId);
  if (!chain) return null;
  const base = chainConfig(chainId).explorerUrl.replace(/\/$/, "");
  const res = await fetchExplorer(`${base}/api/v2/addresses/${address}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    is_contract?: boolean;
    creation_transaction_hash?: string | null;
    creation_tx_hash?: string | null;
  } | null;
  const txHash = body?.creation_transaction_hash ?? body?.creation_tx_hash;
  if (!body?.is_contract || typeof txHash !== "string" || !TX_HASH_RE.test(txHash)) return null;

  const client = createPublicClient({ chain, transport: http() });
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  if (receipt.status !== "success") return null;
  if (receipt.contractAddress?.toLowerCase() !== address.toLowerCase()) return null;
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return { from: receipt.from.toLowerCase(), timestamp: Number(block.timestamp) };
}

/** Names a trusted label must never carry: well-known tokens, wallets and
 *  bridges, and anything claiming to be official or DevStation's own. Users
 *  can still file these as community labels, which the UI marks unverified. */
export function reservedName(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/official|devstation|tether|circle|metamask|uniswap/.test(n)) return true;
  return /^(w?q?usd[ct]?|usdc|usdt|dai|weth|wbtc|eth|btc|wqie|qie|bot|qiewallet|qiebridge|bridge)$/.test(
    n,
  );
}

export interface ExistingLabel {
  name: string;
  submitter: string;
  autoLabeled: boolean;
}

/**
 * The label already on `address`, if any. Read from the registry's own
 * submitLabel history on the explorer, newest successful write winning, the
 * same way the app reads labels: QIE's EVM lacks MCOPY, so the registry's
 * string-returning views (getLabel) revert there. Throws when the history
 * can't be read, so the relay fails closed rather than overwriting a label it
 * could not see.
 */
async function readExistingLabel(
  chainId: number,
  address: `0x${string}`,
): Promise<ExistingLabel | null> {
  const registry = labelRegistryAddress(chainId);
  const api = chainConfig(chainId).explorerApiUrl;
  const res = await fetchExplorer(
    `${api}?module=account&action=txlist&address=${registry}&sort=asc`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`label history: HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: Array<{ to?: string; from: string; input?: string; isError?: string }>;
  };
  if (!Array.isArray(json.result)) throw new Error("label history: no result");
  let found: ExistingLabel | null = null;
  for (const t of json.result) {
    if (t.to?.toLowerCase() !== registry.toLowerCase() || t.isError !== "0") continue;
    try {
      const d = decodeFunctionData({
        abi: contractLabelRegistryAbi,
        data: (t.input ?? "0x") as `0x${string}`,
      });
      if (d.functionName !== "submitLabel") continue;
      if ((d.args[0] as string).toLowerCase() !== address.toLowerCase()) continue;
      found = {
        name: d.args[1] as string,
        submitter: t.from.toLowerCase(),
        autoLabeled: d.args[4] as boolean,
      };
    } catch {
      /* not a registry call this ABI knows */
    }
  }
  return found;
}

// One send at a time per chain: two concurrent sends from the labeler key
// would pick the same nonce and one would fail or replace the other.
const queues = new Map<number, Promise<unknown>>();
function serialised<T>(chainId: number, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(chainId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  queues.set(chainId, next);
  void next.finally(() => {
    if (queues.get(chainId) === next) queues.delete(chainId);
  });
  return next;
}

export type RelayResult =
  | { ok: true; txHash: `0x${string}` }
  | { ok: false; reason: string; message: string; status: number };

export async function relayAutoLabel(input: {
  chainId: number;
  owner: string;
  contractAddress: `0x${string}`;
  name: string;
  category: string;
  description: string;
  /** Injected in tests. */
  creationOf?: typeof contractCreation;
  existingLabel?: typeof readExistingLabel;
  now?: () => number;
}): Promise<RelayResult> {
  const chain = relayChain(input.chainId);
  const key = keyFor(input.chainId);
  const registry = labelRegistryAddress(input.chainId);
  if (!chain || !key || !isContractConfigured(registry)) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Auto-labels are not set up on this network.",
      status: 501,
    };
  }
  if (reservedName(input.name)) {
    return {
      ok: false,
      reason: "reserved_name",
      message: "That name is reserved, so it can only be filed as a community label.",
      status: 409,
    };
  }

  const creation = await (input.creationOf ?? contractCreation)(
    input.chainId,
    input.contractAddress,
  ).catch(() => null);
  if (creation === null) {
    return {
      ok: false,
      reason: "unknown_contract",
      message: "The explorer does not know this contract yet. Try again in a minute.",
      status: 409,
    };
  }
  if (creation.from !== input.owner.toLowerCase()) {
    return {
      ok: false,
      reason: "not_creator",
      message: "Only the wallet that deployed a contract can auto-label it.",
      status: 403,
    };
  }
  const nowSeconds = Math.floor((input.now ?? Date.now)() / 1000);
  if (nowSeconds - creation.timestamp > RELAY_WINDOW_SECONDS) {
    return {
      ok: false,
      reason: "not_recent",
      message: "Only contracts deployed in the last 24 hours can be auto-labelled.",
      status: 409,
    };
  }

  const existing = await (input.existingLabel ?? readExistingLabel)(
    input.chainId,
    input.contractAddress,
  );
  if (existing?.autoLabeled) {
    return {
      ok: false,
      reason: "already_labelled",
      message: "This contract already has a DevStation label.",
      status: 409,
    };
  }
  // The deployer may upgrade their own community label; never someone else's.
  if (existing && existing.submitter !== input.owner.toLowerCase()) {
    return {
      ok: false,
      reason: "labelled_by_someone_else",
      message: "Another wallet has already labelled this contract.",
      status: 409,
    };
  }

  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain, transport: http() });
  const labeler = (await publicClient.readContract({
    address: registry,
    abi: contractLabelRegistryAbi,
    functionName: "autoLabeler",
  })) as string;
  if (labeler.toLowerCase() !== account.address.toLowerCase()) {
    console.error(
      `[label-relay] chain ${input.chainId}: AUTOLABELER key is ${account.address}, registry expects ${labeler}`,
    );
    return {
      ok: false,
      reason: "not_configured",
      message: "Auto-labels are not set up on this network.",
      status: 501,
    };
  }

  return serialised(input.chainId, async (): Promise<RelayResult> => {
    const walletClient = createWalletClient({ account, chain, transport: http() });
    const hash = await walletClient.writeContract({
      address: registry,
      abi: contractLabelRegistryAbi,
      functionName: "submitLabel",
      args: [input.contractAddress, input.name, input.category, input.description, true],
      gas: 600_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") {
      return {
        ok: false,
        reason: "reverted",
        message: "The label transaction reverted.",
        status: 502,
      };
    }
    return { ok: true, txHash: hash };
  });
}
