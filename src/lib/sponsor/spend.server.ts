import { chainConfig } from "@/lib/chains";

interface TxListEntry {
  from?: string;
  timeStamp?: string;
  gasUsed?: string;
  gasPrice?: string;
  value?: string;
}

// Sum of what the sponsor wallet has actually spent in the trailing 24h —
// both the QIE it sent out (top-ups to user wallets) and the gas fees it
// paid broadcasting those top-up transactions — read directly from the
// chain's own explorer tx history (same legacy txlist API
// src/lib/api/chain.functions.ts already uses for getAllLabels). No
// separate datastore needed, consistent with the rest of the app's "no
// backend database" architecture.
//
// Deliberately counts EVERY tx from this address, including failed ones —
// a reverted tx still burns the gas it used, so excluding it would
// undercount real spend and let the budget check under-protect the wallet.
//
// Caveat (documented, not fully solved): this is eventually consistent, not
// atomic. A burst of concurrent top-up requests near the budget boundary
// could all read a "spend so far" from before any of them landed on-chain
// and all pass the check. The caller applies a 90%-of-budget cutoff
// specifically to leave headroom for this — see api.sponsor-topup.ts.
export async function getSponsorSpendLast24hWei(
  chainId: number,
  address: `0x${string}`,
): Promise<bigint> {
  const api = chainConfig(chainId).explorerApiUrl;
  const url = `${api}?module=account&action=txlist&address=${address}&sort=desc`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Explorer tx history unavailable (${resp.status})`);
  const json = (await resp.json()) as { result?: TxListEntry[] };
  const txs = Array.isArray(json.result) ? json.result : [];
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

  let spent = 0n;
  for (const t of txs) {
    if ((t.from ?? "").toLowerCase() !== address.toLowerCase()) continue;
    if (Number(t.timeStamp ?? 0) < cutoff) continue;
    spent += BigInt(t.value || "0") + BigInt(t.gasUsed || "0") * BigInt(t.gasPrice || "0");
  }
  return spent;
}
