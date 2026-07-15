import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { qieMainnet } from "@/lib/chains";

// Server-only sponsor wallet, QIE mainnet only. It tops up a requester's OWN
// wallet with just enough QIE to cover a deploy (plus the registry writes
// that follow it), then gets out of the way — the requester's wallet signs
// and broadcasts everything itself, so it's genuinely the deployer/owner and
// the one recorded in the registries. See api.sponsor-topup.ts.
//
// SPONSOR_PRIVATE_KEY has NO VITE_ prefix on purpose (same convention as
// PRIVATE_KEY in scripts/deploy.ts) so Vite never inlines it into the client
// bundle. Unlike PRIVATE_KEY — which only ever runs in a one-off local CLI
// script — this key is held live by the running server and spends real QIE
// mainnet funds in response to requests. Treat it like an exchange hot
// wallet: use a dedicated wallet funded with only what you're willing to see
// drained, never a wallet that also holds other funds.
const PK_RE = /^0x[0-9a-fA-F]{64}$/;

export interface SponsorConfig {
  privateKey: `0x${string}` | null;
  /** Rolling 24h spend ceiling, in whole QIE. Sponsorship stops at 90% of this. */
  dailyBudgetQie: number;
}

function readConfig(): SponsorConfig {
  const pk = process.env.SPONSOR_PRIVATE_KEY;
  return {
    privateKey: pk && PK_RE.test(pk) ? (pk as `0x${string}`) : null,
    dailyBudgetQie: Number(process.env.SPONSOR_DAILY_BUDGET_QIE || "5"),
  };
}

export function sponsorConfig(): SponsorConfig {
  return readConfig();
}

export function isSponsorConfigured(): boolean {
  return readConfig().privateKey !== null;
}

interface SponsorClients {
  address: `0x${string}`;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
}

// Built lazily and cached for the life of this server instance/process —
// cold starts on serverless hosts rebuild it, which is fine, the account is
// deterministic from the key.
let cached: SponsorClients | null = null;

/** Returns null when SPONSOR_PRIVATE_KEY is unset/invalid — callers must check first. */
export function sponsorClients(): SponsorClients | null {
  const cfg = readConfig();
  if (!cfg.privateKey) return null;
  if (cached) return cached;
  const account = privateKeyToAccount(cfg.privateKey);
  cached = {
    address: account.address,
    publicClient: createPublicClient({ chain: qieMainnet, transport: http() }),
    walletClient: createWalletClient({ account, chain: qieMainnet, transport: http() }),
  };
  return cached;
}
