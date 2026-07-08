// Deploys the DevStation registries (ProjectRegistry, ContractLabelRegistry)
// to a chain. The private key is read from PRIVATE_KEY in .env.local — it
// never leaves your machine and must never be committed.
//
// Usage:
//   1. Put PRIVATE_KEY=0x... in .env.local  (already gitignored)
//   2. Compile artifacts first:   bun run scripts/compile.ts
//   3. Deploy to QIE testnet:     bun run scripts/deploy.ts            (default)
//      Deploy to QIE mainnet:     bun run scripts/deploy.ts mainnet
//      Deploy to any other chain: bun run scripts/deploy.ts <family> <testnet|mainnet>
//        e.g. bot testnet, xlayer mainnet, arc testnet (arc has no mainnet
//        yet), avalanche mainnet, goat testnet, arbitrum mainnet
//
// The script prints the deployed addresses AND the exact VITE_ env lines to
// paste into .env.local. It also writes deployment-output.json (gitignored).

import { createWalletClient, createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// --- chain config (mirrors src/lib/chains.ts; kept standalone for the script) ---
type NetworkKey = "testnet" | "mainnet";
type ChainDef = {
  id: number;
  name: string;
  rpc: string;
  explorer: string;
  nativeSymbol: string;
  // Suffix appended to VITE_PROJECT_REGISTRY_ADDRESS_ / VITE_LABEL_REGISTRY_ADDRESS_
  // for this chain+network. QIE keeps its original bare TESTNET/MAINNET suffixes;
  // other chain families get a family prefix so they don't collide.
  envSuffix: string;
};

// Families with no mainnet yet (Arc) simply omit that key.
const CHAINS: Record<string, Partial<Record<NetworkKey, ChainDef>>> = {
  qie: {
    testnet: {
      id: 1983,
      name: "QIE Testnet",
      rpc: process.env.VITE_QIE_TESTNET_RPC || "https://rpc1testnet.qie.digital/",
      explorer: process.env.VITE_QIE_TESTNET_EXPLORER || "https://testnet.qie.digital",
      nativeSymbol: "QIE",
      envSuffix: "TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_QIE_MAINNET_CHAIN_ID || 1990),
      name: "QIE Mainnet",
      rpc: process.env.VITE_QIE_MAINNET_RPC || "https://rpc1mainnet.qie.digital/",
      explorer: process.env.VITE_QIE_MAINNET_EXPLORER || "https://mainnet.qie.digital",
      nativeSymbol: "QIE",
      envSuffix: "MAINNET",
    },
  },
  bot: {
    testnet: {
      id: Number(process.env.VITE_BOT_TESTNET_CHAIN_ID || 968),
      name: "BOT Chain Testnet",
      rpc: process.env.VITE_BOT_TESTNET_RPC || "https://rpc.bohr.life",
      explorer: process.env.VITE_BOT_TESTNET_EXPLORER || "https://scan.bohr.life",
      nativeSymbol: "BOT",
      envSuffix: "BOT_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_BOT_MAINNET_CHAIN_ID || 677),
      name: "BOT Chain Mainnet",
      rpc: process.env.VITE_BOT_MAINNET_RPC || "https://rpc.botchain.ai",
      explorer: process.env.VITE_BOT_MAINNET_EXPLORER || "https://scan.botchain.ai",
      nativeSymbol: "BOT",
      envSuffix: "BOT_MAINNET",
    },
  },
  xlayer: {
    testnet: {
      id: Number(process.env.VITE_XLAYER_TESTNET_CHAIN_ID || 1952),
      name: "X Layer Testnet",
      rpc: process.env.VITE_XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon",
      explorer: process.env.VITE_XLAYER_TESTNET_EXPLORER || "https://www.oklink.com/xlayer-testnet",
      nativeSymbol: "OKB",
      envSuffix: "XLAYER_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_XLAYER_MAINNET_CHAIN_ID || 196),
      name: "X Layer Mainnet",
      rpc: process.env.VITE_XLAYER_MAINNET_RPC || "https://rpc.xlayer.tech",
      explorer: process.env.VITE_XLAYER_MAINNET_EXPLORER || "https://www.oklink.com/xlayer",
      nativeSymbol: "OKB",
      envSuffix: "XLAYER_MAINNET",
    },
  },
  arc: {
    testnet: {
      id: Number(process.env.VITE_ARC_TESTNET_CHAIN_ID || 5042002),
      name: "Arc Testnet",
      rpc: process.env.VITE_ARC_TESTNET_RPC || "https://rpc.testnet.arc.network",
      explorer: process.env.VITE_ARC_TESTNET_EXPLORER || "https://testnet.arcscan.app",
      nativeSymbol: "USDC",
      envSuffix: "ARC_TESTNET",
    },
    // No Arc mainnet yet.
  },
  avalanche: {
    testnet: {
      id: Number(process.env.VITE_AVALANCHE_TESTNET_CHAIN_ID || 43113),
      name: "Avalanche Fuji Testnet",
      rpc: process.env.VITE_AVALANCHE_TESTNET_RPC || "https://api.avax-test.network/ext/bc/C/rpc",
      explorer: process.env.VITE_AVALANCHE_TESTNET_EXPLORER || "https://testnet.snowtrace.io",
      nativeSymbol: "AVAX",
      envSuffix: "AVALANCHE_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_AVALANCHE_MAINNET_CHAIN_ID || 43114),
      name: "Avalanche C-Chain",
      rpc: process.env.VITE_AVALANCHE_MAINNET_RPC || "https://api.avax.network/ext/bc/C/rpc",
      explorer: process.env.VITE_AVALANCHE_MAINNET_EXPLORER || "https://snowtrace.io",
      nativeSymbol: "AVAX",
      envSuffix: "AVALANCHE_MAINNET",
    },
  },
  goat: {
    testnet: {
      id: Number(process.env.VITE_GOAT_TESTNET_CHAIN_ID || 48816),
      name: "GOAT Network Testnet3",
      rpc: process.env.VITE_GOAT_TESTNET_RPC || "https://rpc.testnet3.goat.network",
      explorer: process.env.VITE_GOAT_TESTNET_EXPLORER || "https://explorer.testnet3.goat.network",
      nativeSymbol: "BTC",
      envSuffix: "GOAT_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_GOAT_MAINNET_CHAIN_ID || 2345),
      name: "GOAT Network",
      rpc: process.env.VITE_GOAT_MAINNET_RPC || "https://rpc.goat.network",
      explorer: process.env.VITE_GOAT_MAINNET_EXPLORER || "https://explorer.goat.network",
      nativeSymbol: "BTC",
      envSuffix: "GOAT_MAINNET",
    },
  },
  arbitrum: {
    testnet: {
      id: Number(process.env.VITE_ARBITRUM_TESTNET_CHAIN_ID || 421614),
      name: "Arbitrum Sepolia",
      rpc: process.env.VITE_ARBITRUM_TESTNET_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      explorer:
        process.env.VITE_ARBITRUM_TESTNET_EXPLORER || "https://arbitrum-sepolia.blockscout.com",
      nativeSymbol: "ETH",
      envSuffix: "ARBITRUM_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_ARBITRUM_MAINNET_CHAIN_ID || 42161),
      name: "Arbitrum One",
      rpc: process.env.VITE_ARBITRUM_MAINNET_RPC || "https://arb1.arbitrum.io/rpc",
      explorer: process.env.VITE_ARBITRUM_MAINNET_EXPLORER || "https://arbitrum.blockscout.com",
      nativeSymbol: "ETH",
      envSuffix: "ARBITRUM_MAINNET",
    },
  },
};

const CONTRACTS = ["ProjectRegistry", "ContractLabelRegistry"] as const;

// Backward compatible with the original 0/1-arg QIE-only form
// (`deploy.ts` / `deploy.ts mainnet`), and adds a `<family> <network>` form
// for additional chains (`deploy.ts bot testnet` / `deploy.ts bot mainnet`).
function parseTarget(): { family: string; network: NetworkKey } {
  const [a, b] = process.argv.slice(2);
  if (a === undefined || a === "testnet" || a === "mainnet") {
    return { family: "qie", network: a === "mainnet" ? "mainnet" : "testnet" };
  }
  if (!CHAINS[a]) {
    console.error(`ERROR: unknown chain "${a}". Supported: ${Object.keys(CHAINS).join(", ")}`);
    process.exit(1);
  }
  return { family: a, network: b === "mainnet" ? "mainnet" : "testnet" };
}

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

  const { family, network } = parseTarget();
  const chain = CHAINS[family][network];
  if (!chain) {
    console.error(`ERROR: ${family} has no ${network} configured.`);
    process.exit(1);
  }

  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error("ERROR: set PRIVATE_KEY=0x... (64 hex chars) in .env.local");
    process.exit(1);
  }

  const account = privateKeyToAccount(pk);
  const viemChain = {
    id: chain.id,
    name: chain.name,
    nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [chain.rpc] } },
  } as const;

  const publicClient = createPublicClient({ chain: viemChain, transport: http() });
  const walletClient = createWalletClient({ account, chain: viemChain, transport: http() });

  console.log(`\n=== DevStation deploy → ${chain.name} (chain ${chain.id}) ===`);
  console.log(`Deployer: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance:  ${formatEther(balance)} ${chain.nativeSymbol}`);
  if (balance === 0n) {
    console.error(
      `ERROR: deployer has 0 ${chain.nativeSymbol}. Fund it first (faucet for testnet).`,
    );
    process.exit(1);
  }

  if (network === "mainnet") {
    console.log(`\n⚠  MAINNET deployment — this spends real ${chain.nativeSymbol}.`);
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
  console.log(`VITE_PROJECT_REGISTRY_ADDRESS_${chain.envSuffix}=${deployed.ProjectRegistry}`);
  console.log(`VITE_LABEL_REGISTRY_ADDRESS_${chain.envSuffix}=${deployed.ContractLabelRegistry}`);
  console.log(`\nExplorer: ${chain.explorer}/address/${deployed.ProjectRegistry}`);
  console.log("(also saved to deployment-output.json)\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
