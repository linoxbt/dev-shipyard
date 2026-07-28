// Solana explorer data — server functions (the Solana analog of
// explorer.functions.ts). Runs @solana/web3.js RPC calls server-side to avoid
// browser CORS/rate-limit exposure and to work under SSR. Returns plain
// serializable objects.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { solanaChain } from "@/lib/solana/chains";

const clusterSchema = z.object({
  cluster: z.enum(["solana-devnet", "solana-mainnet"]),
});

function connFor(cluster: "solana-devnet" | "solana-mainnet") {
  return new Connection(solanaChain(cluster).rpcUrl, "confirmed");
}

export const getSolanaNetworkStatus = createServerFn({ method: "GET" })
  .inputValidator(clusterSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const [epoch, perf, txCount] = await Promise.all([
        conn.getEpochInfo(),
        conn.getRecentPerformanceSamples(1),
        conn.getTransactionCount().catch(() => 0),
      ]);
      const sample = perf[0];
      const tps = sample ? sample.numTransactions / Math.max(1, sample.samplePeriodSecs) : 0;
      return {
        status: "online" as const,
        cluster: data.cluster,
        slot: epoch.absoluteSlot,
        blockHeight: epoch.blockHeight ?? epoch.absoluteSlot,
        epoch: epoch.epoch,
        slotIndex: epoch.slotIndex,
        slotsInEpoch: epoch.slotsInEpoch,
        transactionCount: txCount,
        tps: Math.round(tps),
      };
    } catch (error) {
      return {
        status: "offline" as const,
        cluster: data.cluster,
        error: error instanceof Error ? error.message : "RPC unreachable",
        slot: 0,
        blockHeight: 0,
        epoch: 0,
        slotIndex: 0,
        slotsInEpoch: 0,
        transactionCount: 0,
        tps: 0,
      };
    }
  });

export interface PerfSample {
  slot: number;
  numTransactions: number;
  samplePeriodSecs: number;
  tps: number;
}

export const getSolanaPerfSamples = createServerFn({ method: "GET" })
  .inputValidator(clusterSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const samples = await conn.getRecentPerformanceSamples(20);
      const out: PerfSample[] = samples.map((s) => ({
        slot: s.slot,
        numTransactions: s.numTransactions,
        samplePeriodSecs: s.samplePeriodSecs,
        tps: Math.round(s.numTransactions / Math.max(1, s.samplePeriodSecs)),
      }));
      return { cluster: data.cluster, samples: out };
    } catch {
      return { cluster: data.cluster, samples: [] as PerfSample[] };
    }
  });

const addressSchema = z.object({
  cluster: z.enum(["solana-devnet", "solana-mainnet"]),
  address: z.string().min(32).max(64),
});

export interface AddressSignature {
  signature: string;
  slot: number;
  err: boolean;
  blockTime: number | null;
}

export const getSolanaAddress = createServerFn({ method: "GET" })
  .inputValidator(addressSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(data.address);
      } catch {
        return { ok: false as const, error: "Invalid Solana address" };
      }
      const [account, sigs] = await Promise.all([
        conn.getAccountInfo(pubkey),
        conn.getSignaturesForAddress(pubkey, { limit: 25 }),
      ]);
      const signatures: AddressSignature[] = sigs.map((s) => ({
        signature: s.signature,
        slot: s.slot,
        err: !!s.err,
        blockTime: s.blockTime ?? null,
      }));
      return {
        ok: true as const,
        address: data.address,
        exists: !!account,
        lamports: account?.lamports ?? 0,
        sol: (account?.lamports ?? 0) / LAMPORTS_PER_SOL,
        executable: account?.executable ?? false,
        owner: account?.owner.toBase58() ?? null,
        dataSize: account?.data.length ?? 0,
        signatures,
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "RPC error" };
    }
  });

// SOL price + 24h change + market cap from CoinGecko (id "solana"). Same asset
// on every cluster, so this is cluster-independent. Mirrors getChainPrice in
// chain.functions.ts.
export const getSolanaPrice = createServerFn({ method: "GET" })
  .inputValidator(clusterSchema)
  .handler(async () => {
    try {
      const url =
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true";
      const resp = await fetch(url, { headers: { accept: "application/json" } });
      if (!resp.ok) return { ok: false as const };
      const json = (await resp.json()) as {
        solana?: { usd?: number; usd_24h_change?: number; usd_market_cap?: number };
      };
      const q = json.solana;
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

export interface LatestBlock {
  slot: number;
  blockTime: number | null;
  blockhash: string;
  parentSlot: number;
  txCount: number;
}

// The most recent confirmed blocks, newest first — the Solana equivalent of the
// EVM explorer's "Latest Blocks". Solana skips slots, so we ask getBlocks for
// the confirmed slot list near the tip and hydrate the last few.
export const getSolanaLatestBlocks = createServerFn({ method: "GET" })
  .inputValidator(clusterSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const epoch = await conn.getEpochInfo();
      const tip = epoch.absoluteSlot;
      const confirmed = await conn.getBlocks(Math.max(0, tip - 40), tip);
      const recent = confirmed.slice(-8).reverse(); // newest first
      const blocks: LatestBlock[] = await Promise.all(
        recent.map(async (slot) => {
          try {
            // getBlockSignatures avoids a schema bug in getBlock({transactionDetails:"signatures"}).
            const b = await conn.getBlockSignatures(slot);
            return {
              slot,
              blockTime: b.blockTime ?? null,
              blockhash: b.blockhash ?? "",
              parentSlot: b.parentSlot ?? slot - 1,
              txCount: b.signatures.length,
            };
          } catch {
            return { slot, blockTime: null, blockhash: "", parentSlot: slot - 1, txCount: 0 };
          }
        }),
      );
      return { cluster: data.cluster, blocks };
    } catch {
      return { cluster: data.cluster, blocks: [] as LatestBlock[] };
    }
  });

export interface LatestTx {
  signature: string;
  slot: number;
  blockTime: number | null;
}

// Latest transactions, taken from the most recent confirmed block (Solana has
// no cheap global "latest txns" feed) — the Solana equivalent of the EVM
// explorer's "Latest Transactions".
export const getSolanaLatestTransactions = createServerFn({ method: "GET" })
  .inputValidator(clusterSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const epoch = await conn.getEpochInfo();
      const tip = epoch.absoluteSlot;
      const confirmed = await conn.getBlocks(Math.max(0, tip - 40), tip);
      // Walk back from the tip to the newest block that actually has txns.
      const candidates = confirmed.slice(-5).reverse();
      for (const slot of candidates) {
        const b = await conn.getBlockSignatures(slot);
        const sigs = b.signatures ?? [];
        if (sigs.length > 0) {
          const transactions: LatestTx[] = sigs
            .slice(0, 15)
            .map((signature: string) => ({ signature, slot, blockTime: b.blockTime ?? null }));
          return { cluster: data.cluster, transactions };
        }
      }
      return { cluster: data.cluster, transactions: [] as LatestTx[] };
    } catch {
      return { cluster: data.cluster, transactions: [] as LatestTx[] };
    }
  });

export interface TpsPoint {
  slot: number;
  tps: number;
}

// Full cluster + supply + stake + tx stats + TPS history for the explorer home
// dashboard (mirrors the panels on explorer.solana.com). Each RPC is guarded
// independently so a single unavailable method (e.g. getSupply on a limited
// endpoint) doesn't blank the whole dashboard.
export const getSolanaClusterStats = createServerFn({ method: "GET" })
  .inputValidator(clusterSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const [epoch, perf, txCount, supply, votes, clusterTime] = await Promise.all([
        conn.getEpochInfo(),
        conn.getRecentPerformanceSamples(60).catch(() => []),
        conn.getTransactionCount().catch(() => 0),
        conn
          .getSupply({ commitment: "confirmed", excludeNonCirculatingAccountsList: true })
          .then((r) => r.value)
          .catch(() => null),
        conn.getVoteAccounts().catch(() => null),
        conn.getEpochInfo().then((e) => conn.getBlockTime(e.absoluteSlot)).catch(() => null),
      ]);

      // Average slot time from perf samples (each: numSlots over samplePeriodSecs).
      const withSlots = perf.filter((s) => s.numSlots > 0);
      const slotTimeMs =
        withSlots.length > 0
          ? (withSlots.reduce((a, s) => a + s.samplePeriodSecs / s.numSlots, 0) / withSlots.length) *
            1000
          : 0;
      const sample = perf[0];
      const tps = sample ? Math.round(sample.numTransactions / Math.max(1, sample.samplePeriodSecs)) : 0;
      const slotsRemaining = Math.max(0, epoch.slotsInEpoch - epoch.slotIndex);
      const epochRemainingSecs = Math.round((slotsRemaining * slotTimeMs) / 1000);

      const total = supply ? supply.total : 0;
      const circulating = supply ? supply.circulating : 0;

      let activeStake = 0;
      let delinquentStake = 0;
      if (votes) {
        activeStake = votes.current.reduce((a, v) => a + v.activatedStake, 0);
        delinquentStake = votes.delinquent.reduce((a, v) => a + v.activatedStake, 0);
      }
      const totalStake = activeStake + delinquentStake;

      const tpsHistory: TpsPoint[] = perf
        .map((s) => ({
          slot: s.slot,
          tps: Math.round(s.numTransactions / Math.max(1, s.samplePeriodSecs)),
        }))
        .reverse(); // oldest → newest for the chart

      return {
        ok: true as const,
        cluster: data.cluster,
        slot: epoch.absoluteSlot,
        blockHeight: epoch.blockHeight ?? epoch.absoluteSlot,
        epoch: epoch.epoch,
        epochProgress: epoch.slotsInEpoch ? epoch.slotIndex / epoch.slotsInEpoch : 0,
        epochRemainingSecs,
        slotTimeMs: Math.round(slotTimeMs),
        clusterTime: clusterTime ?? null,
        transactionCount: txCount,
        tps,
        totalSupplySol: total / LAMPORTS_PER_SOL,
        circulatingSol: circulating / LAMPORTS_PER_SOL,
        circulatingPct: total ? circulating / total : 0,
        activeStakeSol: activeStake / LAMPORTS_PER_SOL,
        totalStakeSol: totalStake / LAMPORTS_PER_SOL,
        delinquentPct: totalStake ? delinquentStake / totalStake : 0,
        currentValidators: votes?.current.length ?? 0,
        delinquentValidators: votes?.delinquent.length ?? 0,
        tpsHistory,
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "RPC error" };
    }
  });

// A longer list of recent blocks for the explorer's "Blocks" (slots) page.
export const getSolanaBlocksList = createServerFn({ method: "GET" })
  .inputValidator(clusterSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const epoch = await conn.getEpochInfo();
      const tip = epoch.absoluteSlot;
      const confirmed = await conn.getBlocks(Math.max(0, tip - 60), tip);
      const recent = confirmed.slice(-25).reverse();
      const blocks: LatestBlock[] = await Promise.all(
        recent.map(async (slot) => {
          try {
            const b = await conn.getBlockSignatures(slot);
            return {
              slot,
              blockTime: b.blockTime ?? null,
              blockhash: b.blockhash ?? "",
              parentSlot: b.parentSlot ?? slot - 1,
              txCount: b.signatures.length,
            };
          } catch {
            return { slot, blockTime: null, blockhash: "", parentSlot: slot - 1, txCount: 0 };
          }
        }),
      );
      return { cluster: data.cluster, blocks };
    } catch {
      return { cluster: data.cluster, blocks: [] as LatestBlock[] };
    }
  });

// A longer list of recent transactions for the explorer's "Transactions" page,
// pulled from the most recent few confirmed blocks.
export const getSolanaTxnsList = createServerFn({ method: "GET" })
  .inputValidator(clusterSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const epoch = await conn.getEpochInfo();
      const tip = epoch.absoluteSlot;
      const confirmed = await conn.getBlocks(Math.max(0, tip - 40), tip);
      const out: LatestTx[] = [];
      for (const slot of confirmed.slice(-4).reverse()) {
        const b = await conn.getBlockSignatures(slot);
        for (const signature of b.signatures) {
          out.push({ signature, slot, blockTime: b.blockTime ?? null });
          if (out.length >= 50) break;
        }
        if (out.length >= 50) break;
      }
      return { cluster: data.cluster, transactions: out };
    } catch {
      return { cluster: data.cluster, transactions: [] as LatestTx[] };
    }
  });

// Sampled wallet activity — unique fee-payers across a sample of the latest
// block's transactions. This is a live SAMPLE (not an all-time index): a true
// all-time / daily-active wallet count needs a chain indexer, which the public
// RPC does not provide. Labeled as such in the UI.
export const getSolanaWalletActivity = createServerFn({ method: "GET" })
  .inputValidator(clusterSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const epoch = await conn.getEpochInfo();
      const tip = epoch.absoluteSlot;
      const confirmed = await conn.getBlocks(Math.max(0, tip - 20), tip);
      let sigs: string[] = [];
      let sampledSlot = 0;
      for (const slot of confirmed.slice(-3).reverse()) {
        const b = await conn.getBlockSignatures(slot);
        if (b.signatures.length) {
          // Public RPCs cap getParsedTransactions batch size; keep the sample small.
          sigs = b.signatures.slice(0, 15);
          sampledSlot = slot;
          break;
        }
      }
      if (sigs.length === 0) return { ok: false as const };
      const parsed = await conn.getParsedTransactions(sigs, { maxSupportedTransactionVersion: 0 });
      const payers = new Set<string>();
      for (const t of parsed) {
        const key = t?.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();
        if (key) payers.add(key);
      }
      return {
        ok: true as const,
        activeWallets: payers.size,
        sampledTxns: sigs.length,
        sampledSlot,
      };
    } catch {
      return { ok: false as const };
    }
  });

const slotSchema = z.object({
  cluster: z.enum(["solana-devnet", "solana-mainnet"]),
  slot: z.number().int().nonnegative(),
});

// Block detail page data.
export const getSolanaBlock = createServerFn({ method: "GET" })
  .inputValidator(slotSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const b = await conn.getBlockSignatures(data.slot);
      return {
        ok: true as const,
        slot: data.slot,
        blockhash: b.blockhash,
        previousBlockhash: b.previousBlockhash,
        parentSlot: b.parentSlot,
        blockTime: b.blockTime ?? null,
        txCount: b.signatures.length,
        signatures: b.signatures.slice(0, 100),
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Block not found or not available",
      };
    }
  });

const sigSchema = z.object({
  cluster: z.enum(["solana-devnet", "solana-mainnet"]),
  signature: z.string().min(32).max(120),
});

// Transaction detail (summary) for the explorer tx page — the fields
// explorer.solana.com shows on a transaction's Overview.
export const getSolanaTxOverview = createServerFn({ method: "GET" })
  .inputValidator(sigSchema)
  .handler(async ({ data }) => {
    try {
      const conn = connFor(data.cluster);
      const tx = await conn.getParsedTransaction(data.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) return { ok: false as const, error: "Transaction not found on this cluster." };
      const meta = tx.meta;
      const msg = tx.transaction.message;
      const feePayer =
        msg.accountKeys.find((k) => k.signer)?.pubkey.toBase58() ??
        msg.accountKeys[0]?.pubkey.toBase58() ??
        "";
      let limit: number | null = null;
      for (const l of meta?.logMessages ?? []) {
        const m = l.match(/consumed (\d+) of (\d+) compute units/);
        if (m) {
          limit = Number(m[2]);
          break;
        }
      }
      const version = tx.version === undefined ? "legacy" : String(tx.version);
      return {
        ok: true as const,
        signature: data.signature,
        success: !meta?.err,
        err: meta?.err ? JSON.stringify(meta.err).slice(0, 300) : null,
        slot: tx.slot,
        blockTime: tx.blockTime ?? null,
        feeLamports: meta?.fee ?? 0,
        feeSol: (meta?.fee ?? 0) / LAMPORTS_PER_SOL,
        computeUnits: meta?.computeUnitsConsumed ?? null,
        computeUnitsLimit: limit,
        feePayer,
        recentBlockhash: msg.recentBlockhash,
        version,
        confirmation: "Finalized",
        accountCount: msg.accountKeys.length,
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "RPC error" };
    }
  });
