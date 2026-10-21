// The one definition of how the DevStation contracts are compiled, shared by
// scripts/compile.ts (which writes the artifacts) and scripts/check-contracts.ts
// (which fails CI when the committed artifacts no longer match the source).
import solc from "solc";
import * as fs from "node:fs";
import * as path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const CONTRACTS = [
  "ProjectRegistry",
  "ContractLabelRegistry",
  "TemplateRegistry",
  "DevStationMarketplace",
] as const;

export interface CompiledContract {
  abi: unknown[];
  bytecode: `0x${string}`;
}

export function compileContracts(): {
  version: string;
  contracts: Record<string, CompiledContract>;
  warnings: string[];
} {
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      CONTRACTS.map((n) => [
        `${n}.sol`,
        { content: fs.readFileSync(path.join(ROOT, "contracts", `${n}.sol`), "utf8") },
      ]),
    ),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Pinned below Cancun: QIE's EVM doesn't implement the MCOPY opcode
      // (0x5e) that solc emits by default for string-returning view functions
      // on recent solc versions, which made ContractLabelRegistry's
      // getLabel/batchGetLabels REVERT on-chain after the first deploy.
      // "shanghai" is the newest fork that avoids MCOPY entirely.
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const all = (output.errors ?? []) as Array<{ severity: string; formattedMessage: string }>;
  const errors = all.filter((e) => e.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  }
  const contracts: Record<string, CompiledContract> = {};
  for (const name of CONTRACTS) {
    const c = output.contracts[`${name}.sol`][name];
    contracts[name] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
  }
  return {
    version: solc.version(),
    contracts,
    warnings: all.filter((e) => e.severity !== "error").map((e) => e.formattedMessage),
  };
}

/**
 * Bytecode without solc's trailing CBOR metadata.
 *
 * The metadata hash covers things that do not change behaviour (source file
 * paths, the exact compiler build), so two compiles of identical source can
 * differ only there. The last two bytes give the metadata's length.
 */
export function stripMetadata(bytecode: string): string {
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  if (hex.length < 4) return hex;
  const len = parseInt(hex.slice(-4), 16);
  const cut = (len + 2) * 2;
  if (!Number.isFinite(len) || cut > hex.length) return hex;
  return hex.slice(0, hex.length - cut);
}

export const camelName = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
