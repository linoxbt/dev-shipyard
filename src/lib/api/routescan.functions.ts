import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, http, formatUnits } from "viem";
import { SUPPORTED_CHAINS, avalancheTestnet, avalancheMainnet } from "@/lib/chains";
import { fetchSourcifyContractDetail } from "@/lib/api/sourcify.functions";
import type {
  ExBlock,
  ExTx,
  ExAddress,
  ExAddrCounters,
  ExStats,
  ExTokenTransfer,
  ExLog,
} from "@/lib/explorer/types";

// JSON-serializable value type (TanStack Start validates server-fn returns
// are serializable, so the mapped payload can't be typed as `unknown`).
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

// Avalanche's official explorer (Snowtrace) is powered by Routescan, not
// Blockscout — it has a real (if undocumented, keyless) REST API at
// api.routescan.io that we use here for feeds/history Routescan actually
// indexes (latest blocks/txs, address transaction history, token transfers).
// Anything keyed by an exact identifier we already know (a specific block
// number, a specific tx hash) is instead served straight from RPC via viem —
// that's universally available for any EVM chain regardless of explorer,
// and more reliable than guessing at Routescan's internal API shape for
// single-resource lookups (its `/block/{n}` and `/blocks/{hash}` endpoints
// don't exist; `/transactions/{hash}` does, but RPC covers the same ground
// plus raw calldata/logs, which Routescan's tx payload doesn't include).

const ROUTESCAN_NETWORK: Record<number, "mainnet" | "testnet"> = {
  [avalancheMainnet.id]: "mainnet",
  [avalancheTestnet.id]: "testnet",
};

export function isRoutescanChain(chainId: number): boolean {
  return chainId in ROUTESCAN_NETWORK;
}

function routescanBase(chainId: number): string {
  const net = ROUTESCAN_NETWORK[chainId];
  return `https://api.routescan.io/v2/network/${net}/evm/${chainId}`;
}

function clientFor(chainId: number) {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId);
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);
  return createPublicClient({ chain, transport: http() });
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: { accept: "application/json" } });
  if (!resp.ok) throw new Error(`Routescan returned ${resp.status}`);
  return (await resp.json()) as T;
}

// --- mapping: Routescan's shapes -> the same Ex* shapes Blockscout-backed
// chains use, so every existing explorer component/route renders either
// without changes. These interfaces only declare the fields we read; the
// live payload has more (confirmed via curl during research). ---

interface RSBlock {
  number: number;
  id: string;
  timestamp?: string;
  miner?: string;
  size?: number;
  gasUsed?: string;
  gasLimit?: string;
  txCount?: number;
  burnedFees?: string;
  parent: string;
  minerReward?: string;
}

interface RSTx {
  id: string;
  blockNumber?: number;
  timestamp?: string;
  from?: string;
  to?: string;
  value?: string;
  gasUsed?: string;
  gasPrice?: string;
  gasLimit?: string;
  method?: string;
  status?: boolean;
}

interface RSTokenTransfer {
  txHash: string;
  blockNumber: number;
  timestamp?: string;
  from?: string;
  to?: string;
  tokenAddress?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  amount?: string;
}

function mapBlock(b: RSBlock): ExBlock {
  return {
    height: b.number,
    hash: b.id,
    timestamp: b.timestamp ?? null,
    miner: b.miner ? { hash: b.miner } : null,
    size: Number(b.size ?? 0),
    gas_used: b.gasUsed ?? "0",
    gas_limit: b.gasLimit ?? "0",
    transaction_count: b.txCount ?? 0,
    burnt_fees: b.burnedFees ?? null,
    parent_hash: b.parent,
    rewards: b.minerReward ? [{ reward: b.minerReward, type: "Block Reward" }] : undefined,
  };
}

function mapTx(t: RSTx): ExTx {
  const fee =
    t.gasUsed != null && t.gasPrice != null
      ? (BigInt(t.gasUsed) * BigInt(t.gasPrice)).toString()
      : null;
  return {
    hash: t.id,
    block_number: t.blockNumber ?? null,
    timestamp: t.timestamp ?? null,
    from: t.from ? { hash: t.from } : null,
    to: t.to ? { hash: t.to } : null,
    value: t.value ?? "0",
    fee: fee ? { type: "actual", value: fee } : null,
    gas_used: t.gasUsed ?? null,
    gas_limit: t.gasLimit ?? null,
    gas_price: t.gasPrice ?? null,
    method: t.method ? String(t.method).split("(")[0].trim() : null,
    status: t.status === false ? "error" : "ok",
  };
}

function mapTokenTransfer(t: RSTokenTransfer): ExTokenTransfer {
  return {
    transaction_hash: t.txHash,
    block_number: t.blockNumber,
    timestamp: t.timestamp ?? null,
    from: t.from ? { hash: t.from } : null,
    to: t.to ? { hash: t.to } : null,
    token: t.tokenAddress
      ? {
          address: t.tokenAddress,
          name: t.tokenName ?? null,
          symbol: t.tokenSymbol ?? null,
          decimals: t.tokenDecimals != null ? String(t.tokenDecimals) : null,
        }
      : null,
    total: { value: t.amount ?? null },
  };
}

function parsePath(path: string): { base: string; params: URLSearchParams } {
  const idx = path.indexOf("?");
  return {
    base: idx === -1 ? path : path.slice(0, idx),
    params: new URLSearchParams(idx === -1 ? "" : path.slice(idx + 1)),
  };
}

interface RSPage<T> {
  items?: T[];
  link?: { nextToken?: string };
}

async function pagedList<T, R>(
  rsBase: string,
  resource: string,
  cursor: string | null,
  map: (item: T) => R,
) {
  const url = cursor
    ? `${rsBase}${resource}${resource.includes("?") ? "&" : "?"}limit=25&next=${encodeURIComponent(cursor)}`
    : `${rsBase}${resource}${resource.includes("?") ? "&" : "?"}limit=25`;
  const j = await fetchJson<RSPage<T>>(url);
  return {
    items: (j.items ?? []).map(map),
    next_page_params: j.link?.nextToken ? { cursor: j.link.nextToken } : null,
  };
}

async function getStats(chainId: number): Promise<ExStats> {
  const client = clientFor(chainId);
  const [blockNumber, gasPrice] = await Promise.all([
    client.getBlockNumber(),
    client.getGasPrice(),
  ]);
  const gwei = Number(formatUnits(gasPrice, 9));

  // Average block time: no stats endpoint on Routescan, so derive it from two
  // real blocks a fixed distance apart via RPC (same data Blockscout's own
  // average_block_time is built from, just computed here instead of stored).
  const SAMPLE_BLOCKS = 100n;
  let averageBlockTimeMs = 0;
  if (blockNumber > SAMPLE_BLOCKS) {
    try {
      const [latest, older] = await Promise.all([
        client.getBlock({ blockNumber }),
        client.getBlock({ blockNumber: blockNumber - SAMPLE_BLOCKS }),
      ]);
      const seconds = Number(latest.timestamp - older.timestamp) / Number(SAMPLE_BLOCKS);
      if (seconds > 0) averageBlockTimeMs = seconds * 1000;
    } catch {
      /* fall back to 0 -> renders as "—" */
    }
  }

  return {
    // Total blocks mined == the current height for a chain starting at
    // genesis 0 — a reasonable, honest proxy since Routescan has no stats
    // endpoint. Total tx/address counts aren't cheaply obtainable without an
    // indexer, so they're left blank (renders as "—", not a wrong number).
    total_blocks: blockNumber.toString(),
    total_transactions: "",
    total_addresses: "",
    average_block_time: averageBlockTimeMs,
    gas_prices: { slow: gwei, average: gwei, fast: gwei },
    coin_price: null,
    coin_price_change_percentage: null,
    market_cap: null,
    gas_used_today: null,
  };
}

async function getAddress(chainId: number, addr: `0x${string}`): Promise<ExAddress> {
  const client = clientFor(chainId);
  const [balance, code] = await Promise.all([
    client.getBalance({ address: addr }),
    client.getCode({ address: addr }),
  ]);
  return {
    hash: addr,
    coin_balance: balance.toString(),
    is_contract: !!code && code !== "0x",
    is_verified: false,
  };
}

async function getTxDetail(chainId: number, hash: `0x${string}`) {
  const client = clientFor(chainId);
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  let method: string | null = null;
  try {
    const j = await fetchJson<{ method?: string }>(
      `${routescanBase(chainId)}/transactions/${hash}`,
    );
    method = j.method ? String(j.method).split("(")[0].trim() : null;
  } catch {
    /* Routescan lookup is best-effort enrichment only */
  }
  return {
    hash: tx.hash,
    block_number: Number(receipt.blockNumber),
    timestamp: block.timestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : null,
    from: { hash: tx.from },
    to: tx.to ? { hash: tx.to } : null,
    created_contract: receipt.contractAddress ? { hash: receipt.contractAddress } : null,
    value: tx.value.toString(),
    fee: { type: "actual", value: (receipt.gasUsed * (tx.gasPrice ?? 0n)).toString() },
    gas_used: receipt.gasUsed.toString(),
    gas_limit: tx.gas.toString(),
    gas_price: (tx.gasPrice ?? 0n).toString(),
    nonce: tx.nonce,
    method,
    status: receipt.status === "success" ? "ok" : "error",
    raw_input: tx.input,
    decoded_input: null,
    token_transfers: [],
  };
}

async function getTxLogs(chainId: number, hash: `0x${string}`) {
  const client = clientFor(chainId);
  const receipt = await client.getTransactionReceipt({ hash });
  const items: ExLog[] = receipt.logs.map((l, i) => ({
    address: { hash: l.address },
    topics: l.topics as unknown as (string | null)[],
    data: l.data,
    index: i,
    transaction_hash: hash,
  }));
  return { items };
}

async function getBlockDetail(chainId: number, height: bigint): Promise<ExBlock> {
  const client = clientFor(chainId);
  const block = await client.getBlock({ blockNumber: height });
  return {
    height: Number(block.number),
    hash: block.hash ?? "",
    timestamp: block.timestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : null,
    miner: block.miner ? { hash: block.miner } : null,
    size: Number(block.size ?? 0n),
    gas_used: block.gasUsed.toString(),
    gas_limit: block.gasLimit.toString(),
    transaction_count: block.transactions.length,
    base_fee_per_gas: block.baseFeePerGas?.toString() ?? null,
    parent_hash: block.parentHash,
    difficulty: block.difficulty?.toString(),
  };
}

async function getBlockTxs(chainId: number, height: bigint) {
  const client = clientFor(chainId);
  const block = await client.getBlock({ blockNumber: height, includeTransactions: true });
  const items: ExTx[] = block.transactions.map((t) => ({
    hash: t.hash,
    block_number: Number(block.number),
    timestamp: block.timestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : null,
    from: { hash: t.from },
    to: t.to ? { hash: t.to } : null,
    value: t.value.toString(),
    fee: null,
    gas_price: (t.gasPrice ?? 0n).toString(),
    method: null,
    status: "ok",
  }));
  return { items };
}

async function resolvePath(chainId: number, path: string): Promise<unknown> {
  const { base, params } = parsePath(path);
  const rsBase = routescanBase(chainId);
  const cursor = params.get("cursor");

  if (base === "/stats") return getStats(chainId);
  if (base === "/main-page/blocks") {
    const j = await fetchJson<RSPage<RSBlock>>(`${rsBase}/blocks?limit=6`);
    return (j.items ?? []).map(mapBlock);
  }
  if (base === "/main-page/transactions") {
    const j = await fetchJson<RSPage<RSTx>>(`${rsBase}/transactions?limit=6`);
    return (j.items ?? []).map(mapTx);
  }
  if (base === "/blocks") return pagedList(rsBase, "/blocks", cursor, mapBlock);
  if (base === "/transactions") return pagedList(rsBase, "/transactions", cursor, mapTx);

  const addrMatch = base.match(/^\/addresses\/(0x[a-fA-F0-9]{40})(\/.*)?$/i);
  if (addrMatch) {
    const addr = addrMatch[1] as `0x${string}`;
    const sub = addrMatch[2];
    if (!sub) return getAddress(chainId, addr);
    if (sub === "/counters") return {} as ExAddrCounters;
    if (sub === "/transactions") {
      return pagedList(rsBase, `/address/${addr}/transactions`, cursor, mapTx);
    }
    if (sub === "/token-transfers") {
      const j = await fetchJson<RSPage<RSTokenTransfer>>(
        `${rsBase}/address/${addr}/erc20-transfers?limit=25`,
      );
      return { items: (j.items ?? []).map(mapTokenTransfer) };
    }
    if (sub === "/token-balances") return [];
    if (sub === "/internal-transactions") return { items: [] };
    if (sub === "/logs") return { items: [] };
  }

  const txMatch = base.match(/^\/transactions\/(0x[a-fA-F0-9]{64})(\/.*)?$/i);
  if (txMatch) {
    const hash = txMatch[1] as `0x${string}`;
    const sub = txMatch[2];
    if (!sub) return getTxDetail(chainId, hash);
    if (sub === "/logs") return getTxLogs(chainId, hash);
  }

  const blockMatch = base.match(/^\/blocks\/(\d+)(\/.*)?$/);
  if (blockMatch) {
    const height = BigInt(blockMatch[1]);
    const sub = blockMatch[2];
    if (!sub) return getBlockDetail(chainId, height);
    if (sub === "/transactions") return getBlockTxs(chainId, height);
  }

  const contractMatch = base.match(/^\/smart-contracts\/(0x[a-fA-F0-9]{40})$/i);
  if (contractMatch) {
    // Avalanche's own explorer (Snowtrace/Routescan) verification is a
    // separate, unrelated API — verification for this chain goes through
    // Sourcify instead (see sourcify.functions.ts), so that's also where we
    // read the verified source/ABI/bytecode back from.
    return fetchSourcifyContractDetail(chainId, contractMatch[1]);
  }

  if (base.startsWith("/stats/charts")) {
    return { chart_data: [] };
  }

  throw new Error(`Unsupported Routescan path: ${base}`);
}

const input = z.object({ chainId: z.number(), path: z.string().min(1).max(512) });

export const getRoutescanExplorerData = createServerFn({ method: "GET" })
  .inputValidator(input)
  .handler(async ({ data }) => {
    try {
      const result = (await resolvePath(data.chainId, data.path)) as JsonValue;
      return { ok: true as const, status: 200, data: result };
    } catch (e) {
      return {
        ok: false as const,
        status: 502,
        error: e instanceof Error ? e.message : "Routescan unreachable",
      };
    }
  });
