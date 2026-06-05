import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createPublicClient,
  http,
  formatEther,
  formatUnits,
  getAddress,
  type Hex,
  type Log,
} from "viem";
import { qieTestnet, SUPPORTED_CHAINS } from "@/lib/chains";
import {
  REVERT_PATTERNS,
  type DecodedTx,
  type RouteCall,
  type TokenTransfer,
  type ApprovalRecord,
  type CallType,
} from "@/lib/mock/transactions";

// ERC-20 event topic0 hashes.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const MAX_UINT = (1n << 256n) - 1n;

const ERC20_META_ABI = [
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

function clientFor(chainId: number) {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId) ?? qieTestnet;
  return createPublicClient({ chain, transport: http() });
}

interface RawCall {
  type?: string;
  from?: string;
  to?: string;
  input?: string;
  output?: string;
  gas?: string;
  gasUsed?: string;
  error?: string;
  calls?: RawCall[];
}

function selectorOf(input?: string): string {
  if (!input || input === "0x" || input.length < 10) return "(native transfer)";
  return input.slice(0, 10);
}

function mapCallNode(node: RawCall, path: string, depth: number): RouteCall {
  const type: CallType = node.error
    ? "failed"
    : node.type === "STATICCALL"
      ? "view"
      : depth === 0
        ? "user"
        : "internal";
  return {
    id: path,
    type,
    contractAddress: node.to ?? "0x",
    fn: selectorOf(node.input),
    args: [],
    events: [],
    gasUsed: node.gasUsed ? Number(BigInt(node.gasUsed)) : 0,
    children: (node.calls ?? []).map((c, i) => mapCallNode(c, `${path}.${i + 1}`, depth + 1)),
  };
}

async function tokenMeta(client: ReturnType<typeof clientFor>, tokens: Set<string>) {
  const meta = new Map<string, { symbol: string; decimals: number }>();
  await Promise.all(
    [...tokens].map(async (addr) => {
      try {
        const [symbol, decimals] = await Promise.all([
          client.readContract({
            address: addr as Hex,
            abi: ERC20_META_ABI,
            functionName: "symbol",
          }),
          client.readContract({
            address: addr as Hex,
            abi: ERC20_META_ABI,
            functionName: "decimals",
          }),
        ]);
        meta.set(addr.toLowerCase(), { symbol: symbol as string, decimals: Number(decimals) });
      } catch {
        meta.set(addr.toLowerCase(), { symbol: `${addr.slice(0, 6)}…`, decimals: 18 });
      }
    }),
  );
  return meta;
}

function topicToAddress(topic: Hex): string {
  return getAddress(`0x${topic.slice(26)}`);
}

const decodeInput = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash"),
  chainId: z.number().optional(),
});

// Decode a real QIE transaction: overview, ERC-20 transfers/approvals, an
// execution route (via callTracer when the RPC supports it, otherwise a single
// top-level call), and a human-readable revert reason on failure.
export const decodeTransaction = createServerFn({ method: "POST" })
  .inputValidator(decodeInput)
  .handler(
    async ({
      data,
    }): Promise<
      | { status: "success"; tx: DecodedTx }
      | { status: "notfound" }
      | { status: "error"; error: string }
    > => {
      const chainId = data.chainId ?? qieTestnet.id;
      const hash = data.txHash as Hex;
      const client = clientFor(chainId);

      try {
        const [tx, receipt] = await Promise.all([
          client.getTransaction({ hash }).catch(() => null),
          client.getTransactionReceipt({ hash }).catch(() => null),
        ]);
        if (!tx || !receipt) return { status: "notfound" };

        const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
        const gasPrice = receipt.effectiveGasPrice ?? tx.gasPrice ?? 0n;
        const gasCostQIE = Number(formatUnits(gasPrice * receipt.gasUsed, 18));

        // ERC-20 transfers + approvals from logs.
        const tokenAddrs = new Set<string>();
        for (const log of receipt.logs) {
          if (log.topics[0] === TRANSFER_TOPIC || log.topics[0] === APPROVAL_TOPIC) {
            tokenAddrs.add(log.address.toLowerCase());
          }
        }
        const meta = await tokenMeta(client, tokenAddrs);
        const sym = (addr: string) =>
          meta.get(addr.toLowerCase())?.symbol ?? `${addr.slice(0, 6)}…`;
        const dec = (addr: string) => meta.get(addr.toLowerCase())?.decimals ?? 18;

        const tokenTransfers: TokenTransfer[] = [];
        const approvals: ApprovalRecord[] = [];
        for (const log of receipt.logs as Log[]) {
          const t0 = log.topics[0];
          if (t0 === TRANSFER_TOPIC && log.topics.length === 3) {
            const raw = BigInt(log.data);
            tokenTransfers.push({
              token: log.address,
              tokenSymbol: sym(log.address),
              from: topicToAddress(log.topics[1] as Hex),
              to: topicToAddress(log.topics[2] as Hex),
              amount: formatUnits(raw, dec(log.address)),
              raw: raw.toString(),
            });
          } else if (t0 === APPROVAL_TOPIC && log.topics.length === 3) {
            const raw = BigInt(log.data);
            const unlimited = raw >= MAX_UINT / 2n;
            approvals.push({
              token: log.address,
              tokenSymbol: sym(log.address),
              owner: topicToAddress(log.topics[1] as Hex),
              spender: topicToAddress(log.topics[2] as Hex),
              amount: unlimited ? "Unlimited" : formatUnits(raw, dec(log.address)),
              unlimited,
              risk: unlimited ? "High" : "Low",
            });
          }
        }

        // Execution route: prefer callTracer, fall back to a single top-level call.
        let route: RouteCall;
        try {
          const trace = (await client.request({
            method: "debug_traceTransaction" as never,
            params: [hash, { tracer: "callTracer" }] as never,
          })) as RawCall;
          route = mapCallNode(trace, "r", 0);
        } catch {
          route = {
            id: "r",
            type: receipt.status === "reverted" ? "failed" : "user",
            contractAddress: tx.to ?? "0x",
            fn: selectorOf(tx.input),
            args: [],
            events: [],
            gasUsed: Number(receipt.gasUsed),
            children: [],
          };
        }

        // Revert reason via simulation (best-effort).
        let revertReason: string | undefined;
        let revertExplain: string | undefined;
        let revertFix: string | undefined;
        if (receipt.status === "reverted") {
          try {
            await client.call({
              to: tx.to ?? undefined,
              data: tx.input,
              value: tx.value,
              blockNumber: receipt.blockNumber,
            });
          } catch (err: unknown) {
            const e = err as { shortMessage?: string; details?: string; message?: string };
            revertReason = e.shortMessage || e.details || e.message || "Reverted without reason";
            const pattern = Object.keys(REVERT_PATTERNS).find((p) => revertReason?.includes(p));
            if (pattern) {
              revertExplain = REVERT_PATTERNS[pattern].explain;
              revertFix = REVERT_PATTERNS[pattern].fix;
            }
          }
        }

        const decoded: DecodedTx = {
          hash: tx.hash,
          status: receipt.status === "success" ? "SUCCESS" : "REVERTED",
          blockNumber: Number(receipt.blockNumber),
          timestamp: block ? Number(block.timestamp) * 1000 : Date.now(),
          from: tx.from,
          to: tx.to ?? "0x",
          value: formatEther(tx.value),
          gasUsed: Number(receipt.gasUsed),
          gasPriceGwei: Number(formatUnits(gasPrice, 9)),
          gasCostQIE,
          revertReason,
          revertExplain,
          revertFix,
          route,
          tokenTransfers,
          approvals,
        };
        return { status: "success", tx: decoded };
      } catch (error) {
        return {
          status: "error",
          error: error instanceof Error ? error.message : "Failed to decode",
        };
      }
    },
  );
