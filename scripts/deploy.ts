// Deploys the DevStation registries (ProjectRegistry, ContractLabelRegistry)
// to QIE. The private key is read from PRIVATE_KEY in .env.local — it never
// leaves your machine and must never be committed.
//
// Usage:
//   1. Put PRIVATE_KEY=0x... in .env.local  (already gitignored)
//   2. Compile artifacts first:   bun run scripts/compile.ts
//   3. Deploy to testnet:         bun run scripts/deploy.ts            (default)
//      Deploy to mainnet:         bun run scripts/deploy.ts mainnet
//
// The script prints the deployed addresses AND the exact VITE_ env lines to
// paste into .env.local. It also writes deployment-output.json (gitignored).

import { createWalletClient, createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// --- chain config (mirrors src/lib/chains.ts; kept standalone for the script) ---
const CHAINS = {
  testnet: {
    id: 1983,
    name: "QIE Testnet",
    rpc: process.env.VITE_QIE_TESTNET_RPC || "https://rpc1testnet.qie.digital/",
    explorer: process.env.VITE_QIE_TESTNET_EXPLORER || "https://testnet.qie.digital",
  },
  mainnet: {
    id: Number(process.env.VITE_QIE_MAINNET_CHAIN_ID || 1990),
    name: "QIE Mainnet",
    rpc: process.env.VITE_QIE_MAINNET_RPC || "https://rpc1mainnet.qie.digital/",
    explorer: process.env.VITE_QIE_MAINNET_EXPLORER || "https://mainnet.qie.digital",
  },
} as const;

const CONTRACTS = ["ProjectRegistry", "ContractLabelRegistry"] as const;

function loadDotEnvLocal() {
  // Minimal .env.local loader (no extra deps). Only sets vars not already set.
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function artifact(name: string): { abi: unknown[]; bytecode: `0x${string}` } {
  const p = path.join(ROOT, "contracts", "out", `${name}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`Missing ${p}. Run: bun run scripts/compile.ts`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  loadDotEnvLocal();

  const target = (process.argv[2] === "mainnet" ? "mainnet" : "testnet") as keyof typeof CHAINS;
  const chain = CHAINS[target];

  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error("ERROR: set PRIVATE_KEY=0x... (64 hex chars) in .env.local");
    process.exit(1);
  }

  const account = privateKeyToAccount(pk);
  const viemChain = {
    id: chain.id,
    name: chain.name,
    nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
    rpcUrls: { default: { http: [chain.rpc] } },
  } as const;

  const publicClient = createPublicClient({ chain: viemChain, transport: http() });
  const walletClient = createWalletClient({ account, chain: viemChain, transport: http() });

  console.log(`\n=== DevStation deploy → ${chain.name} (chain ${chain.id}) ===`);
  console.log(`Deployer: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance:  ${formatEther(balance)} QIE`);
  if (balance === 0n) {
    console.error("ERROR: deployer has 0 QIE. Fund it first (faucet for testnet).");
    process.exit(1);
  }

  if (target === "mainnet") {
    console.log("\n⚠  MAINNET deployment — this spends real QIE.");
    console.log("   Re-run within 8s to proceed (Ctrl-C to abort)...");
    await new Promise((r) => setTimeout(r, 8000));
  }

  const deployed: Record<string, string> = {};
  for (const name of CONTRACTS) {
    const { abi, bytecode } = artifact(name);
    process.stdout.write(`Deploying ${name}... `);
    const hash = await walletClient.deployContract({ abi: abi as [], bytecode, args: [] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`${name}: no contract address in receipt`);
    deployed[name] = receipt.contractAddress;
    console.log(`${receipt.contractAddress}  (block ${receipt.blockNumber})`);
  }

  const result = {
    network: chain.name,
    chainId: chain.id,
    deployer: account.address,
    contracts: deployed,
  };
  fs.writeFileSync(path.join(ROOT, "deployment-output.json"), JSON.stringify(result, null, 2));

  console.log("\n=== DONE — paste these into .env.local ===\n");
  console.log(`VITE_PROJECT_REGISTRY_ADDRESS=${deployed.ProjectRegistry}`);
  console.log(`VITE_LABEL_REGISTRY_ADDRESS=${deployed.ContractLabelRegistry}`);
  console.log(`\nExplorer: ${chain.explorer}/address/${deployed.ProjectRegistry}`);
  console.log("(also saved to deployment-output.json)\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
