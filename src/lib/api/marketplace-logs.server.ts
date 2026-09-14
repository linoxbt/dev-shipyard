import { keccak256, toBytes } from "viem";
import { chainConfig } from "@/lib/chains";
import { isContractConfigured, marketplaceAddress, marketplaceDeployBlock } from "@/lib/contracts";
import { fetchExplorer } from "@/lib/api/explorer-fetch";

// DevStationMarketplace's purchase, deploy and tip events, from the explorer's
// indexed logs. The node's own eth_getLogs only serves about 10,000 blocks at a
// time on QIE, so a whole history comes from the explorer instead.
//
// All three events share a layout: (uint256 indexed id, address indexed actor,
// address indexed creator, uint8 currency, uint256 amount, …), where the actor
// is the buyer, the deployer or the tipper.

const SIGNATURES = {
  Purchased: "Purchased(uint256,address,address,uint8,uint256,uint256)",
  DeployRecorded: "DeployRecorded(uint256,address,address,uint8,uint256,uint256)",
  Tipped: "Tipped(uint256,address,address,uint8,uint256)",
} as const;

export type MarketEventName = keyof typeof SIGNATURES;

export interface MarketEvent {
  id: number;
  /** Lowercased buyer, deployer or tipper. */
  actor: string;
  /** Lowercased listing creator. */
  creator: string;
  /** 0 QIE, 1 QUSDC. */
  currency: number;
  /** Paid (purchases, deploys) or tipped, in the currency's smallest unit. */
  amount: bigint;
  txHash: string;
}

const TOPIC: Record<MarketEventName, string> = {
  Purchased: keccak256(toBytes(SIGNATURES.Purchased)),
  DeployRecorded: keccak256(toBytes(SIGNATURES.DeployRecorded)),
  Tipped: keccak256(toBytes(SIGNATURES.Tipped)),
};

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: MarketEvent[] | null }>();

const address = (topic: string) => `0x${topic.slice(-40)}`.toLowerCase();
const word = (data: string, index: number) =>
  BigInt(`0x${data.slice(2 + 64 * index, 2 + 64 * (index + 1)) || "0"}`);

/** Every `name` event on the chain's marketplace, or null when the marketplace
 *  is not deployed there or the explorer could not answer. */
export async function marketplaceEvents(
  chainId: number,
  name: MarketEventName,
): Promise<MarketEvent[] | null> {
  const contract = marketplaceAddress(chainId);
  const fromBlock = marketplaceDeployBlock(chainId);
  if (!isContractConfigured(contract) || fromBlock === null) return null;

  const key = `${chainId}:${name}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: MarketEvent[] | null = null;
  try {
    const api = chainConfig(chainId).explorerApiUrl;
    const url = `${api}?module=logs&action=getLogs&address=${contract}&topic0=${TOPIC[name]}&fromBlock=${fromBlock}&toBlock=latest`;
    const resp = await fetchExplorer(url);
    const json = (await resp.json()) as {
      result?: Array<{ topics?: string[]; data?: string; transactionHash?: string }> | string;
    };
    // "No logs found" still comes back as an empty result array.
    if (!Array.isArray(json.result)) throw new Error("The explorer did not return logs.");
    value = json.result
      .filter((log) => (log.topics?.length ?? 0) >= 4 && typeof log.data === "string")
      .map((log) => ({
        id: Number(BigInt(log.topics![1])),
        actor: address(log.topics![2]),
        creator: address(log.topics![3]),
        currency: Number(word(log.data!, 0)),
        amount: word(log.data!, 1),
        txHash: log.transactionHash ?? "",
      }));
  } catch {
    value = null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}
