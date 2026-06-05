import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, http, formatUnits } from "viem";
import { qieTestnet, SUPPORTED_CHAINS } from "@/lib/chains";

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
