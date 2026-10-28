import { createPublicClient, createWalletClient, http, type Chain } from "viem";
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
// auto-labeler key here and labels a contract only after checking, on the
// chain's own explorer, that the signed-in wallet is the account that created
// it. The ProjectRegistry record is not enough: anyone can record any address.
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

/** Who created `address` on `chainId`, lowercased, from the explorer; null when
 *  it is not a contract or the explorer does not say. */
export async function contractCreator(chainId: number, address: string): Promise<string | null> {
  const base = chainConfig(chainId).explorerUrl.replace(/\/$/, "");
  const res = await fetchExplorer(`${base}/api/v2/addresses/${address}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    is_contract?: boolean;
    creator_address_hash?: string | null;
  } | null;
  if (!body?.is_contract || typeof body.creator_address_hash !== "string") return null;
  return body.creator_address_hash.toLowerCase();
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
  creatorOf?: typeof contractCreator;
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

  const creator = await (input.creatorOf ?? contractCreator)(
    input.chainId,
    input.contractAddress,
  ).catch(() => null);
  if (creator === null) {
    return {
      ok: false,
      reason: "unknown_contract",
      message: "The explorer does not know this contract yet. Try again in a minute.",
      status: 409,
    };
  }
  if (creator !== input.owner.toLowerCase()) {
    return {
      ok: false,
      reason: "not_creator",
      message: "Only the wallet that deployed a contract can auto-label it.",
      status: 403,
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
}
