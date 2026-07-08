import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, http, formatUnits, decodeFunctionData } from "viem";
import {
  qieTestnet,
  qieMainnet,
  avalancheMainnet,
  goatMainnet,
  SUPPORTED_CHAINS,
  chainConfig,
} from "@/lib/chains";
import { projectRegistryAbi } from "@/lib/abis/projectRegistry";
import { contractLabelRegistryAbi } from "@/lib/abis/contractLabelRegistry";

function clientFor(chainId: number) {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId) ?? qieTestnet;
  return createPublicClient({ chain, transport: http() });
}

const chainInput = z.object({ chainId: z.number().optional() });

// Live network status: block height + gas price from the QIE RPC.
export const getNetworkStatus = createServerFn({ method: "GET" })
  .inputValidator(chainInput)
  .handler(async ({ data }) => {
    const chainId = data.chainId ?? qieTestnet.id;
    try {
      const client = clientFor(chainId);
      const [blockNumber, gasPrice] = await Promise.all([
        client.getBlockNumber(),
        client.getGasPrice(),
      ]);
      return {
        status: "online" as const,
        chainId,
        blockNumber: Number(blockNumber),
        gasPrice: gasPrice.toString(),
        gasPriceGwei: Number(formatUnits(gasPrice, 9)),
      };
    } catch (error) {
      return {
        status: "offline" as const,
        chainId,
        error: error instanceof Error ? error.message : "RPC unreachable",
        blockNumber: 0,
        gasPriceGwei: 0,
      };
    }
  });

// Native-coin price + 24h change, per chain family. QIE's Blockscout /stats
// returns coin_price_change_percentage: null, so the explorer can't show a
// change like Etherscan does for ETH; CoinGecko has it (coin id "qie"), so we
// fetch price + 24h move server-side as a fallback there. Chains with no known
// CoinGecko listing (e.g. BOT Chain, as of this writing) return ok:false and
// the UI falls back to Blockscout's own coin_price field, which BOT Chain's
// explorer already populates natively. GOAT Network's gas token is real BTC,
// so its price/market cap comes straight from CoinGecko's "bitcoin" listing —
// GOAT's own Blockscout instance has no price oracle configured at all
// (coin_price/market_cap are always null/"0" there, confirmed live).
const COINGECKO_ID_BY_CHAIN: Record<number, string> = {
  [qieTestnet.id]: "qie",
  [qieMainnet.id]: "qie",
  [avalancheMainnet.id]: "avalanche-2",
  [goatMainnet.id]: "bitcoin",
};

const priceInput = z.object({ chainId: z.number() });

export const getChainPrice = createServerFn({ method: "GET" })
  .inputValidator(priceInput)
  .handler(async ({ data }) => {
    const coinId = COINGECKO_ID_BY_CHAIN[data.chainId];
    if (!coinId) return { ok: false as const };
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
      const resp = await fetch(url, { headers: { accept: "application/json" } });
      if (!resp.ok) return { ok: false as const };
      const json = (await resp.json()) as Record<
        string,
        { usd?: number; usd_24h_change?: number; usd_market_cap?: number } | undefined
      >;
      const q = json[coinId];
      if (!q || typeof q.usd !== "number") return { ok: false as const };
      return {
        ok: true as const,
        usd: q.usd,
        change24h: typeof q.usd_24h_change === "number" ? q.usd_24h_change : null,
        marketCap: typeof q.usd_market_cap === "number" ? q.usd_market_cap : null,
      };
    } catch {
      return { ok: false as const };
    }
  });

// 30-day price history fallback for the explorer's Price chart. Some chains'
// own Blockscout instance has no price-chart history at all (BOT Chain, Arc,
// and GOAT Network all confirmed live to return chart_data: [] from
// /stats/charts/market — no oracle configured), and Avalanche/X Layer have no
// Blockscout to ask in the first place. Wherever a CoinGecko id is known
// (see COINGECKO_ID_BY_CHAIN above), CoinGecko's own market_chart endpoint
// gives real daily closing prices to chart instead of an empty state.
export const getChainPriceHistory = createServerFn({ method: "GET" })
  .inputValidator(priceInput)
  .handler(async ({ data }) => {
    const coinId = COINGECKO_ID_BY_CHAIN[data.chainId];
    if (!coinId) return { ok: false as const };
    try {
      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`;
      const resp = await fetch(url, { headers: { accept: "application/json" } });
      if (!resp.ok) return { ok: false as const };
      const json = (await resp.json()) as { prices?: Array<[number, number]> };
      const prices = json.prices ?? [];
      const points = prices.map(([ts, price]) => ({
        date: new Date(ts).toISOString().slice(0, 10),
        closing_price: String(price),
      }));
      return { ok: true as const, points };
    } catch {
      return { ok: false as const };
    }
  });

// Ecosystem-wide deployment stats, read from the onchain ProjectRegistry:
//   - totalContracts: the registry's totalDeployments counter (every recorded deploy)
//   - totalUsers:     distinct wallets that recorded a deployment, counted from
//     the registry's successful recordDeployment transactions (the registry
//     contract doesn't track unique deployers itself, so we derive it from the
//     explorer-indexed tx history).
const RECORD_DEPLOYMENT_SELECTOR = "0x4311b312"; // recordDeployment(address,string,string,string,string)

const statsInput = z.object({
  chainId: z.number(),
  registry: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export const getEcosystemStats = createServerFn({ method: "GET" })
  .inputValidator(statsInput)
  .handler(async ({ data }) => {
    const { chainId, registry } = data;

    // Total contracts: the authoritative onchain counter.
    let totalContracts = 0;
    try {
      const client = clientFor(chainId);
      const total = await client.readContract({
        address: registry as `0x${string}`,
        abi: projectRegistryAbi,
        functionName: "totalDeployments",
      });
      totalContracts = Number(total as bigint);
    } catch {
      /* leave 0 if the registry is unreachable */
    }

    // Total users: unique senders of successful recordDeployment txs, from the
    // explorer's indexed tx list (the node's getLogs is range-limited on QIE).
    let totalUsers = 0;
    try {
      const api = chainConfig(chainId).explorerApiUrl;
      const url = `${api}?module=account&action=txlist&address=${registry}&sort=asc`;
      const resp = await fetch(url);
      const json = (await resp.json()) as {
        result?: Array<{ to?: string; from: string; input?: string; isError?: string }>;
      };
      const txs = Array.isArray(json.result) ? json.result : [];
      const deployers = new Set(
        txs
          .filter(
            (t) =>
              t.to?.toLowerCase() === registry.toLowerCase() &&
              (t.input ?? "").startsWith(RECORD_DEPLOYMENT_SELECTOR) &&
              t.isError === "0",
          )
          .map((t) => t.from.toLowerCase()),
      );
      totalUsers = deployers.size;
    } catch {
      /* leave 0 if the explorer is unreachable */
    }

    return { chainId, totalContracts, totalUsers };
  });

// Combined ecosystem stats across BOTH networks (testnet + mainnet), so the
// Overview/landing show one universal number rather than a per-chain figure:
//   - totalContracts: sum of each chain's onchain totalDeployments counter
//   - totalUsers:     unique wallets across both chains (union of the deployer
//     address sets, so a wallet active on both networks is counted once)
const combinedStatsInput = z.object({
  chains: z
    .array(z.object({ chainId: z.number(), registry: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }))
    .min(1),
});

export const getCombinedEcosystemStats = createServerFn({ method: "GET" })
  .inputValidator(combinedStatsInput)
  .handler(async ({ data }) => {
    let totalContracts = 0;
    const deployers = new Set<string>();

    await Promise.all(
      data.chains.map(async ({ chainId, registry }) => {
        // Authoritative onchain counter per chain.
        try {
          const client = clientFor(chainId);
          const total = await client.readContract({
            address: registry as `0x${string}`,
            abi: projectRegistryAbi,
            functionName: "totalDeployments",
          });
          totalContracts += Number(total as bigint);
        } catch {
          /* skip this chain's counter if unreachable */
        }

        // Union the deployer addresses from this chain's recordDeployment txs.
        try {
          const api = chainConfig(chainId).explorerApiUrl;
          const url = `${api}?module=account&action=txlist&address=${registry}&sort=asc`;
          const resp = await fetch(url);
          const json = (await resp.json()) as {
            result?: Array<{ to?: string; from: string; input?: string; isError?: string }>;
          };
          const txs = Array.isArray(json.result) ? json.result : [];
          for (const t of txs) {
            if (
              t.to?.toLowerCase() === registry.toLowerCase() &&
              (t.input ?? "").startsWith(RECORD_DEPLOYMENT_SELECTOR) &&
              t.isError === "0"
            ) {
              deployers.add(t.from.toLowerCase());
            }
          }
        } catch {
          /* skip this chain's users if the explorer is unreachable */
        }
      }),
    );

    return { totalContracts, totalUsers: deployers.size };
  });

// Per-template deploy counts, derived from the registry's successful
// recordDeployment transactions (the templateId is the 2nd calldata arg).
const templateStatsInput = z.object({
  chainId: z.number(),
  registry: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export const getTemplateDeployCounts = createServerFn({ method: "GET" })
  .inputValidator(templateStatsInput)
  .handler(async ({ data }) => {
    const { chainId, registry } = data;
    const counts: Record<string, number> = {};
    try {
      const api = chainConfig(chainId).explorerApiUrl;
      const url = `${api}?module=account&action=txlist&address=${registry}&sort=asc`;
      const resp = await fetch(url);
      const json = (await resp.json()) as {
        result?: Array<{ to?: string; input?: string; isError?: string }>;
      };
      const txs = Array.isArray(json.result) ? json.result : [];
      for (const t of txs) {
        if (t.to?.toLowerCase() !== registry.toLowerCase()) continue;
        if (!(t.input ?? "").startsWith(RECORD_DEPLOYMENT_SELECTOR)) continue;
        if (t.isError !== "0") continue;
        try {
          const decoded = decodeFunctionData({
            abi: projectRegistryAbi,
            data: t.input as `0x${string}`,
          });
          if (decoded.functionName === "recordDeployment") {
            const templateId = decoded.args[1] as string;
            counts[templateId] = (counts[templateId] ?? 0) + 1;
          }
        } catch {
          /* skip un-decodable tx */
        }
      }
    } catch {
      /* leave counts empty if the explorer is unreachable */
    }
    return { chainId, counts };
  });

// Every contract deployed through DevStation on this chain, decoded from the
// registry's successful recordDeployment transactions. Newest first.
export interface EcosystemDeployment {
  contractAddress: string;
  templateId: string;
  projectName: string;
  deployer: string;
  txHash: string;
  timestamp: number; // epoch seconds
  chainId?: number; // set by the combined query so a row knows its network
}

export const getAllDeployments = createServerFn({ method: "GET" })
  .inputValidator(templateStatsInput)
  .handler(async ({ data }) => {
    const { chainId, registry } = data;
    const deployments: EcosystemDeployment[] = [];
    try {
      const api = chainConfig(chainId).explorerApiUrl;
      const url = `${api}?module=account&action=txlist&address=${registry}&sort=desc`;
      const resp = await fetch(url);
      const json = (await resp.json()) as {
        result?: Array<{
          to?: string;
          from: string;
          hash: string;
          input?: string;
          isError?: string;
          timeStamp?: string;
        }>;
      };
      const txs = Array.isArray(json.result) ? json.result : [];
      for (const t of txs) {
        if (t.to?.toLowerCase() !== registry.toLowerCase()) continue;
        if (!(t.input ?? "").startsWith(RECORD_DEPLOYMENT_SELECTOR)) continue;
        if (t.isError !== "0") continue;
        try {
          const decoded = decodeFunctionData({
            abi: projectRegistryAbi,
            data: t.input as `0x${string}`,
          });
          if (decoded.functionName !== "recordDeployment") continue;
          deployments.push({
            contractAddress: decoded.args[0] as string,
            templateId: decoded.args[1] as string,
            projectName: decoded.args[2] as string,
            deployer: t.from,
            txHash: t.hash,
            timestamp: Number(t.timeStamp ?? 0),
          });
        } catch {
          /* skip un-decodable */
        }
      }
    } catch {
      /* leave empty if the explorer is unreachable */
    }
    return { chainId, deployments };
  });

// Every contract deployed through DevStation across BOTH networks, tagged with
// the chainId of the chain it came from, merged newest-first. Powers the unified
// Activity page so it reflects total ecosystem activity, not one chain at a time.
export const getAllDeploymentsCombined = createServerFn({ method: "GET" })
  .inputValidator(combinedStatsInput)
  .handler(async ({ data }) => {
    const all: EcosystemDeployment[] = [];
    await Promise.all(
      data.chains.map(async ({ chainId, registry }) => {
        try {
          const api = chainConfig(chainId).explorerApiUrl;
          const url = `${api}?module=account&action=txlist&address=${registry}&sort=desc`;
          const resp = await fetch(url);
          const json = (await resp.json()) as {
            result?: Array<{
              to?: string;
              from: string;
              hash: string;
              input?: string;
              isError?: string;
              timeStamp?: string;
            }>;
          };
          const txs = Array.isArray(json.result) ? json.result : [];
          for (const t of txs) {
            if (t.to?.toLowerCase() !== registry.toLowerCase()) continue;
            if (!(t.input ?? "").startsWith(RECORD_DEPLOYMENT_SELECTOR)) continue;
            if (t.isError !== "0") continue;
            try {
              const decoded = decodeFunctionData({
                abi: projectRegistryAbi,
                data: t.input as `0x${string}`,
              });
              if (decoded.functionName !== "recordDeployment") continue;
              all.push({
                contractAddress: decoded.args[0] as string,
                templateId: decoded.args[1] as string,
                projectName: decoded.args[2] as string,
                deployer: t.from,
                txHash: t.hash,
                timestamp: Number(t.timeStamp ?? 0),
                chainId,
              });
            } catch {
              /* skip un-decodable */
            }
          }
        } catch {
          /* skip this chain if the explorer is unreachable */
        }
      }),
    );
    all.sort((a, b) => b.timestamp - a.timestamp);
    return { deployments: all };
  });

// Every contract label, decoded from the registry's submitLabel transaction
// history. QIE's EVM lacks the MCOPY opcode (0x5e) that solc 0.8.26 emits for
// string-returning view functions, so getLabel/batchGetLabels REVERT on-chain.
// Reading from tx calldata sidesteps that entirely. Newest write per address
// wins (a re-label overwrites). Returns plain serializable fields.
const SUBMIT_LABEL_SELECTOR = "0x194cab0d"; // submitLabel(address,string,string,string,bool)

export interface EcosystemLabel {
  address: string;
  name: string;
  category: string;
  submitter: string;
  autoLabeled: boolean;
  timestamp: number; // epoch seconds
}

export const getAllLabels = createServerFn({ method: "GET" })
  .inputValidator(templateStatsInput)
  .handler(async ({ data }) => {
    const { chainId, registry } = data;
    try {
      const api = chainConfig(chainId).explorerApiUrl;
      const url = `${api}?module=account&action=txlist&address=${registry}&sort=asc`;
      const resp = await fetch(url);
      const json = (await resp.json()) as {
        result?: Array<{
          to?: string;
          from: string;
          input?: string;
          isError?: string;
          timeStamp?: string;
        }>;
      };
      const txs = Array.isArray(json.result) ? json.result : [];
      // asc order → later writes overwrite earlier ones for the same address.
      const byAddr = new Map<string, EcosystemLabel>();
      for (const t of txs) {
        if (t.to?.toLowerCase() !== registry.toLowerCase()) continue;
        if (!(t.input ?? "").startsWith(SUBMIT_LABEL_SELECTOR)) continue;
        if (t.isError !== "0") continue;
        try {
          const decoded = decodeFunctionData({
            abi: contractLabelRegistryAbi,
            data: t.input as `0x${string}`,
          });
          if (decoded.functionName !== "submitLabel") continue;
          const addr = (decoded.args[0] as string).toLowerCase();
          byAddr.set(addr, {
            address: decoded.args[0] as string,
            name: decoded.args[1] as string,
            category: decoded.args[2] as string,
            autoLabeled: decoded.args[4] as boolean,
            submitter: t.from,
            timestamp: Number(t.timeStamp ?? 0),
          });
        } catch {
          /* skip un-decodable */
        }
      }
      return { chainId, labels: [...byAddr.values()].reverse() }; // newest first
    } catch {
      return { chainId, labels: [] as EcosystemLabel[] };
    }
  });
