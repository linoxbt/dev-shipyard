import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, http, formatUnits } from "viem";
import { qieTestnet, SUPPORTED_CHAINS, chainConfig } from "@/lib/chains";
import { projectRegistryAbi } from "@/lib/abis/projectRegistry";

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
