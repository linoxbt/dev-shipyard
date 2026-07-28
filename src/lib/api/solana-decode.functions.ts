// Solana transaction decoder — server function powering Routebook's Solana view
// (the analog of decode.functions.ts, which uses viem for EVM). Uses
// getParsedTransaction to produce a human-readable instruction list, SOL and
// SPL-token balance deltas, fee/compute, and program logs. Returns plain
// serializable data.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { solanaChain } from "@/lib/solana/chains";

const input = z.object({
  cluster: z.enum(["solana-devnet", "solana-mainnet"]),
  signature: z.string().min(32).max(120),
});

// Well-known program ids → friendly names.
const PROGRAM_NAMES: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "SPL Token-2022",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: "Metaplex Token Metadata",
};

function programName(id: string): string {
  return PROGRAM_NAMES[id] ?? id;
}

export interface DecodedInstruction {
  index: number;
  program: string;
  programId: string;
  type: string;
  summary: string;
}

export interface BalanceChange {
  account: string;
  delta: number; // SOL or token uiAmount delta
  mint?: string;
}

export const decodeSolanaTransaction = createServerFn({ method: "GET" })
  .inputValidator(input)
  .handler(async ({ data }) => {
    const conn = new Connection(solanaChain(data.cluster).rpcUrl, "confirmed");
    let tx;
    try {
      tx = await conn.getParsedTransaction(data.signature, {
        maxSupportedTransactionVersion: 0,
      });
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "RPC error" };
    }
    if (!tx) return { ok: false as const, error: "Transaction not found on this cluster." };

    const meta = tx.meta;
    const message = tx.transaction.message;
    const accountKeys = message.accountKeys.map((k) => k.pubkey.toBase58());

    // Instructions (top-level).
    const instructions: DecodedInstruction[] = message.instructions.map((ix, index) => {
      const programId = "programId" in ix ? ix.programId.toBase58() : "";
      if ("parsed" in ix) {
        const parsed = ix.parsed as { type?: string; info?: Record<string, unknown> };
        const info = parsed.info ?? {};
        const summary = Object.entries(info)
          .slice(0, 4)
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
          .join(", ");
        return {
          index,
          program: programName(programId || String((ix as { program?: string }).program)),
          programId,
          type: parsed.type ?? "parsed",
          summary: summary.slice(0, 200),
        };
      }
      return {
        index,
        program: programName(programId),
        programId,
        type: "raw",
        summary: "accounts: " + ("accounts" in ix ? ix.accounts.length : 0),
      };
    });

    // SOL balance deltas.
    const solChanges: BalanceChange[] = [];
    if (meta?.preBalances && meta.postBalances) {
      for (let i = 0; i < meta.postBalances.length; i++) {
        const delta = (meta.postBalances[i] - meta.preBalances[i]) / LAMPORTS_PER_SOL;
        if (delta !== 0) solChanges.push({ account: accountKeys[i] ?? String(i), delta });
      }
    }

    // SPL token balance deltas (match pre/post by accountIndex + mint).
    const tokenChanges: BalanceChange[] = [];
    const pre = meta?.preTokenBalances ?? [];
    const post = meta?.postTokenBalances ?? [];
    const key = (b: { accountIndex: number; mint: string }) => `${b.accountIndex}:${b.mint}`;
    const preMap = new Map(pre.map((b) => [key(b), b.uiTokenAmount.uiAmount ?? 0]));
    for (const b of post) {
      const before = preMap.get(key(b)) ?? 0;
      const after = b.uiTokenAmount.uiAmount ?? 0;
      const delta = after - before;
      if (delta !== 0) {
        tokenChanges.push({
          account: accountKeys[b.accountIndex] ?? String(b.accountIndex),
          delta,
          mint: b.mint,
        });
      }
    }

    return {
      ok: true as const,
      signature: data.signature,
      cluster: data.cluster,
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      success: !meta?.err,
      err: meta?.err ? JSON.stringify(meta.err).slice(0, 300) : null,
      feeSol: (meta?.fee ?? 0) / LAMPORTS_PER_SOL,
      computeUnits: meta?.computeUnitsConsumed ?? null,
      accountCount: accountKeys.length,
      instructions,
      solChanges,
      tokenChanges,
      logs: (meta?.logMessages ?? []).slice(0, 60),
    };
  });
