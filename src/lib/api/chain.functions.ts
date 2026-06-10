import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, http, formatUnits, decodeFunctionData } from "viem";
import { qieTestnet, SUPPORTED_CHAINS, chainConfig } from "@/lib/chains";
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
