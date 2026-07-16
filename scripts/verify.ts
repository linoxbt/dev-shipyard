// Source-verifies the DevStation registries (ProjectRegistry,
// ContractLabelRegistry) on a chain's Blockscout explorer, for contracts
// deployed via scripts/deploy.ts (i.e. never seen by the app's own
// verify-through-the-UI flow in src/lib/api/verify.functions.ts). Needs no
// private key — verification only needs the deployed address, read from
// .env.local, and recompiles from source to submit the exact solc
// standard-JSON input.
//
// Usage:
//   bun run scripts/compile.ts                       (if not already compiled)
//   bun run scripts/verify.ts <family> <testnet|mainnet>
//     e.g. bun run scripts/verify.ts bot mainnet
//          bun run scripts/verify.ts qie mainnet

import solc from "solc";
import { encodeAbiParameters, type Abi } from "viem";
import { createPublicClient, http } from "viem";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// --- chain config (mirrors scripts/deploy.ts; kept standalone per-script) ---
type NetworkKey = "testnet" | "mainnet";
type ChainDef = {
  id: number;
  rpc: string;
  explorer: string;
  envSuffix: string;
};

const CHAINS: Record<string, Partial<Record<NetworkKey, ChainDef>>> = {
  qie: {
    testnet: {
      id: 1983,
      rpc: process.env.VITE_QIE_TESTNET_RPC || "https://rpc1testnet.qie.digital/",
      explorer: process.env.VITE_QIE_TESTNET_EXPLORER || "https://testnet.qie.digital",
      envSuffix: "TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_QIE_MAINNET_CHAIN_ID || 1990),
      rpc: process.env.VITE_QIE_MAINNET_RPC || "https://rpc1mainnet.qie.digital/",
      explorer: process.env.VITE_QIE_MAINNET_EXPLORER || "https://mainnet.qie.digital",
      envSuffix: "MAINNET",
    },
  },
  bot: {
    testnet: {
      id: Number(process.env.VITE_BOT_TESTNET_CHAIN_ID || 968),
      rpc: process.env.VITE_BOT_TESTNET_RPC || "https://rpc.bohr.life",
      explorer: process.env.VITE_BOT_TESTNET_EXPLORER || "https://scan.bohr.life",
      envSuffix: "BOT_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_BOT_MAINNET_CHAIN_ID || 677),
      rpc: process.env.VITE_BOT_MAINNET_RPC || "https://rpc.botchain.ai",
      explorer: process.env.VITE_BOT_MAINNET_EXPLORER || "https://scan.botchain.ai",
      envSuffix: "BOT_MAINNET",
    },
  },
  xlayer: {
    testnet: {
      id: Number(process.env.VITE_XLAYER_TESTNET_CHAIN_ID || 1952),
      rpc: process.env.VITE_XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon",
      explorer: process.env.VITE_XLAYER_TESTNET_EXPLORER || "https://www.oklink.com/xlayer-testnet",
      envSuffix: "XLAYER_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_XLAYER_MAINNET_CHAIN_ID || 196),
      rpc: process.env.VITE_XLAYER_MAINNET_RPC || "https://rpc.xlayer.tech",
      explorer: process.env.VITE_XLAYER_MAINNET_EXPLORER || "https://www.oklink.com/xlayer",
      envSuffix: "XLAYER_MAINNET",
    },
  },
  arc: {
    testnet: {
      id: Number(process.env.VITE_ARC_TESTNET_CHAIN_ID || 5042002),
      rpc: process.env.VITE_ARC_TESTNET_RPC || "https://rpc.testnet.arc.network",
      explorer: process.env.VITE_ARC_TESTNET_EXPLORER || "https://testnet.arcscan.app",
      envSuffix: "ARC_TESTNET",
    },
  },
  avalanche: {
    testnet: {
      id: Number(process.env.VITE_AVALANCHE_TESTNET_CHAIN_ID || 43113),
      rpc: process.env.VITE_AVALANCHE_TESTNET_RPC || "https://api.avax-test.network/ext/bc/C/rpc",
      explorer: process.env.VITE_AVALANCHE_TESTNET_EXPLORER || "https://testnet.snowtrace.io",
      envSuffix: "AVALANCHE_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_AVALANCHE_MAINNET_CHAIN_ID || 43114),
      rpc: process.env.VITE_AVALANCHE_MAINNET_RPC || "https://api.avax.network/ext/bc/C/rpc",
      explorer: process.env.VITE_AVALANCHE_MAINNET_EXPLORER || "https://snowtrace.io",
      envSuffix: "AVALANCHE_MAINNET",
    },
  },
  goat: {
    testnet: {
      id: Number(process.env.VITE_GOAT_TESTNET_CHAIN_ID || 48816),
      rpc: process.env.VITE_GOAT_TESTNET_RPC || "https://rpc.testnet3.goat.network",
      explorer: process.env.VITE_GOAT_TESTNET_EXPLORER || "https://explorer.testnet3.goat.network",
      envSuffix: "GOAT_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_GOAT_MAINNET_CHAIN_ID || 2345),
      rpc: process.env.VITE_GOAT_MAINNET_RPC || "https://rpc.goat.network",
      explorer: process.env.VITE_GOAT_MAINNET_EXPLORER || "https://explorer.goat.network",
      envSuffix: "GOAT_MAINNET",
    },
  },
  arbitrum: {
    testnet: {
      id: Number(process.env.VITE_ARBITRUM_TESTNET_CHAIN_ID || 421614),
      rpc: process.env.VITE_ARBITRUM_TESTNET_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      explorer:
        process.env.VITE_ARBITRUM_TESTNET_EXPLORER || "https://arbitrum-sepolia.blockscout.com",
      envSuffix: "ARBITRUM_TESTNET",
    },
    mainnet: {
      id: Number(process.env.VITE_ARBITRUM_MAINNET_CHAIN_ID || 42161),
      rpc: process.env.VITE_ARBITRUM_MAINNET_RPC || "https://arb1.arbitrum.io/rpc",
      explorer: process.env.VITE_ARBITRUM_MAINNET_EXPLORER || "https://arbitrum.blockscout.com",
      envSuffix: "ARBITRUM_MAINNET",
    },
  },
};

const CONTRACTS = ["ProjectRegistry", "ContractLabelRegistry"] as const;

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
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function readSource(name: string): string {
  return fs.readFileSync(path.join(ROOT, "contracts", `${name}.sol`), "utf8");
}

// Same solc settings as scripts/compile.ts — must match exactly, or the
// recompiled bytecode won't match what's actually on chain.
function standardJsonInput() {
  return {
    language: "Solidity",
    sources: Object.fromEntries(CONTRACTS.map((n) => [`${n}.sol`, { content: readSource(n) }])),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
}

async function longCompilerVersion(short: string): Promise<string> {
  const resp = await fetch("https://binaries.soliditylang.org/bin/list.json");
  if (!resp.ok) throw new Error(`Could not load solc version list (${resp.status})`);
  const { releases } = (await resp.json()) as { releases: Record<string, string> };
  const file = releases[short];
  if (!file) throw new Error(`solc ${short} not found in the release list`);
  return file.replace(/^soljson-/, "").replace(/\.js$/, "");
}

async function submitStandardInput(params: {
  explorer: string;
  address: string;
  contractName: string;
  standardJsonInput: string;
  compilerVersion: string;
  constructorArgs?: `0x${string}`;
}): Promise<{ ok: boolean; message: string }> {
  const url = `${params.explorer.replace(/\/$/, "")}/api/v2/smart-contracts/${params.address}/verification/via/standard-input`;
  const explicitArgs = !!params.constructorArgs && params.constructorArgs !== "0x";

  // NOTE: this deliberately shells out to curl instead of using fetch's
  // FormData. Confirmed by hand: Bun's fetch/FormData encodes the required
  // "files[0]" bracket-notation field name in a way Blockscout's Plug-based
  // multipart parser doesn't recognize as an array field — it silently
  // accepts the request (200) but responds {"message":"JSON files not
  // found"} instead of starting verification. The identical request shape
  // sent via `curl -F` succeeds immediately ("Smart-contract verification
  // started"). This may also affect src/lib/api/verify.functions.ts's
  // submitStandardJsonVerification if that ever runs under Bun (worth
  // checking separately) — but this script needs to work regardless, so it
  // uses curl directly rather than depending on that being fixed.
  const tmpFile = path.join(ROOT, `.verify-input-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, params.standardJsonInput);
  try {
    const args = [
      "-s",
      "-o",
      "-",
      "-w",
      "\n%{http_code}",
      "-X",
      "POST",
      url,
      "-F",
      `compiler_version=${params.compilerVersion}`,
      "-F",
      `contract_name=${params.contractName}`,
      "-F",
      "license_type=mit",
      "-F",
      explicitArgs ? "autodetect_constructor_args=false" : "autodetect_constructor_args=true",
      ...(explicitArgs ? ["-F", `constructor_args=${params.constructorArgs}`] : []),
      "-F",
      `files[0]=@${tmpFile};type=application/json;filename=input.json`,
    ];
    const proc = Bun.spawnSync(["curl", ...args]);
    const out = proc.stdout.toString();
    const lastNewline = out.lastIndexOf("\n");
    const body = out.slice(0, lastNewline);
    const status = Number(out.slice(lastNewline + 1));
    let message = body;
    try {
      message = (JSON.parse(body) as { message?: string }).message ?? body;
    } catch {
      /* keep raw text */
    }
    const ok = status === 200 || status === 201 || status === 409;
    return { ok, message: message || `Explorer returned ${status}` };
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

async function main() {
  loadDotEnvLocal();
  const { family, network } = parseTarget();
  const chain = CHAINS[family][network];
  if (!chain) {
    console.error(`ERROR: ${family} has no ${network} configured.`);
    process.exit(1);
  }

  console.log(`\n=== DevStation verify → ${family} ${network} (chain ${chain.id}) ===`);
  console.log(`Explorer: ${chain.explorer}`);

  console.log("Compiling (must match the deployed bytecode exactly)...");
  const input = standardJsonInput();
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length > 0) {
    for (const e of errors) console.error(e.formattedMessage);
    process.exit(1);
  }
  const solcVersion = solc.version().match(/^(\d+\.\d+\.\d+)/)?.[1];
  if (!solcVersion) throw new Error(`Could not parse solc short version from "${solc.version()}"`);
  const compilerVersion = await longCompilerVersion(solcVersion);
  console.log(`solc: ${compilerVersion}`);

  const publicClient = createPublicClient({
    chain: {
      id: chain.id,
      name: family,
      nativeCurrency: { name: "", symbol: "", decimals: 18 },
      rpcUrls: { default: { http: [chain.rpc] } },
    },
    transport: http(),
  });

  for (const name of CONTRACTS) {
    const envVar = `VITE_${name === "ProjectRegistry" ? "PROJECT" : "LABEL"}_REGISTRY_ADDRESS_${chain.envSuffix}`;
    const address = process.env[envVar];
    if (!address) {
      console.log(`\n${name}: skipped — ${envVar} is not set in .env.local`);
      continue;
    }

    console.log(`\n${name} (${address}):`);
    const abi = output.contracts[`${name}.sol`][name].abi as Abi;

    // ContractLabelRegistry is the only contract with a constructor arg
    // (autoLabeler). Read the REAL value from the deployed contract itself
    // rather than assuming — this script never needs a private key.
    let constructorArgs: `0x${string}` | undefined;
    const ctor = abi.find((e) => e.type === "constructor");
    if (ctor && "inputs" in ctor && ctor.inputs.length > 0) {
      const autoLabeler = await publicClient.readContract({
        address: address as `0x${string}`,
        abi,
        functionName: "autoLabeler",
      });
      constructorArgs = encodeAbiParameters(ctor.inputs, [autoLabeler]);
      console.log(`  constructor arg (autoLabeler): ${autoLabeler}`);
    }

    const indexed = await fetch(`${chain.explorer.replace(/\/$/, "")}/api/v2/addresses/${address}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.is_contract === true)
      .catch(() => false);
    if (!indexed) {
      console.log(`  skipped — explorer hasn't indexed this address as a contract yet`);
      continue;
    }

    const result = await submitStandardInput({
      explorer: chain.explorer,
      address,
      contractName: `${name}.sol:${name}`,
      standardJsonInput: JSON.stringify(input),
      compilerVersion,
      constructorArgs,
    });
    console.log(`  ${result.ok ? "✓" : "✗"} ${result.message}`);
    console.log(`  ${chain.explorer.replace(/\/$/, "")}/address/${address}?tab=contract`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
