import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { qieMainnet, botMainnet } from "@/lib/chains";

// Server-only sponsor wallets, one per eligible mainnet. Each tops up a
// requester's OWN wallet with just enough native gas token to cover a deploy
// (plus the registry writes that follow it), then gets out of the way — the
// requester's wallet signs and broadcasts everything itself, so it's
// genuinely the deployer/owner and the one recorded in the registries. See
// api.sponsor-topup.ts.
//
// The *_PRIVATE_KEY env vars have NO VITE_ prefix on purpose (same
// convention as PRIVATE_KEY in scripts/deploy.ts) so Vite never inlines them
// into the client bundle. Unlike PRIVATE_KEY — which only ever runs in a
// one-off local CLI script — these keys are held live by the running server
// and spend real mainnet funds in response to requests. Treat each like an
// exchange hot wallet: a dedicated wallet funded with only what you're
// willing to see drained, never a wallet that also holds other funds.
const PK_RE = /^0x[0-9a-fA-F]{64}$/;

// Eligible chains are deliberately mainnet-only, one entry per chain family
// — every testnet in this app already has a public faucet, so there's
// nothing to sponsor there. Adding a new chain means adding one row here.
const SPONSOR_CHAINS: Record<number, { chain: Chain; keyEnv: string; budgetEnv: string }> = {
  [qieMainnet.id]: {
    chain: qieMainnet,
    keyEnv: "SPONSOR_PRIVATE_KEY",
    budgetEnv: "SPONSOR_DAILY_BUDGET_QIE",
  },
  [botMainnet.id]: {
    chain: botMainnet,
    keyEnv: "SPONSOR_PRIVATE_KEY_BOT",
    budgetEnv: "SPONSOR_DAILY_BUDGET_BOT",
  },
};

export interface SponsorConfig {
  privateKey: `0x${string}` | null;
  /** Rolling 24h spend ceiling, in whole native tokens. Sponsorship stops at 90% of this. */
  dailyBudgetNative: number;
}

function readConfig(chainId: number): SponsorConfig {
  const entry = SPONSOR_CHAINS[chainId];
  if (!entry) return { privateKey: null, dailyBudgetNative: 0 };
  const pk = process.env[entry.keyEnv];
  return {
    privateKey: pk && PK_RE.test(pk) ? (pk as `0x${string}`) : null,
    dailyBudgetNative: Number(process.env[entry.budgetEnv] || "5"),
  };
}

export function sponsorConfig(chainId: number): SponsorConfig {
  return readConfig(chainId);
}

export function isSponsorConfigured(chainId: number): boolean {
  return readConfig(chainId).privateKey !== null;
}

interface SponsorClients {
  address: `0x${string}`;
  chain: Chain;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
}

// Built lazily and cached per chain for the life of this server
// instance/process — cold starts on serverless hosts rebuild it, which is
// fine, each account is deterministic from its key.
const cached = new Map<number, SponsorClients>();

/** Returns null when the chain isn't sponsor-eligible or its key is unset/invalid. */
export function sponsorClients(chainId: number): SponsorClients | null {
  const entry = SPONSOR_CHAINS[chainId];
  if (!entry) return null;
  const cfg = readConfig(chainId);
  if (!cfg.privateKey) return null;
  const existing = cached.get(chainId);
  if (existing) return existing;
  const account = privateKeyToAccount(cfg.privateKey);
  const clients: SponsorClients = {
    address: account.address,
    chain: entry.chain,
    publicClient: createPublicClient({ chain: entry.chain, transport: http() }),
    walletClient: createWalletClient({ account, chain: entry.chain, transport: http() }),
  };
  cached.set(chainId, clients);
  return clients;
}
