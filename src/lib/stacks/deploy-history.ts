// Local record of Clarity contracts deployed THROUGH DevStation on Stacks.
// Stacks has no on-chain DevStation registry, so we keep a per-browser deploy
// log to power the Stacks Analytics page (same pattern as the Solana side).

import type { StacksNetworkId } from "@/lib/stacks/chains";
import type { Coverage } from "@/lib/stacks/audit";

export type StacksDeployKind = "token" | "nft" | "payment" | "contract";

export interface StacksDeploy {
  kind: StacksDeployKind;
  network: StacksNetworkId;
  /** contract name (address.name) or txid. */
  contractName: string;
  txid?: string;
  deployer?: string;
  templateId?: string;
  /** Post-condition coverage verdict at deploy time. */
  coverage?: Coverage;
  timestamp: number; // epoch seconds
}

const KEY = "devstation-stacks-deploys-v1";

export function loadStacksDeploys(): StacksDeploy[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as StacksDeploy[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordStacksDeploy(d: StacksDeploy): void {
  try {
    if (typeof localStorage === "undefined") return;
    const list = loadStacksDeploys().filter((x) => x.txid !== d.txid || x.contractName !== d.contractName);
    list.unshift(d);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 500)));
    window.dispatchEvent(new CustomEvent("devstation-stacks-deploys"));
  } catch {
    /* ignore */
  }
}
