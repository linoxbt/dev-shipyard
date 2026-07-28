// Local record of deployments made THROUGH DevStation on Solana. Solana has no
// on-chain ProjectRegistry (unlike the EVM chains), so DevStation keeps its own
// deploy log in localStorage to power the Solana Analytics page. Scoped per
// browser — it reflects deploys made here, not a global on-chain index.

import type { SolanaCluster } from "@/lib/solana/chains";

export type SolanaDeployKind = "token" | "nft" | "program";

export interface SolanaDeploy {
  kind: SolanaDeployKind;
  cluster: SolanaCluster;
  /** mint address (token/nft) or program id (program). */
  address: string;
  signature?: string;
  name?: string;
  templateId?: string;
  wallet?: string;
  timestamp: number; // epoch seconds
}

const KEY = "devstation-solana-deploys-v1";

export function loadSolanaDeploys(): SolanaDeploy[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SolanaDeploy[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordSolanaDeploy(d: SolanaDeploy): void {
  try {
    if (typeof localStorage === "undefined") return;
    const list = loadSolanaDeploys().filter((x) => x.address !== d.address);
    list.unshift(d);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 500)));
    // Let same-tab listeners (the analytics page) refresh immediately.
    window.dispatchEvent(new CustomEvent("devstation-solana-deploys"));
  } catch {
    /* ignore quota / private mode */
  }
}
