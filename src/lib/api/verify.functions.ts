import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { chainConfig } from "@/lib/chains";

// Contract source verification against the QIE explorer (Blockscout). DevStation
// templates are self-contained single files, so we use Blockscout's v2
// "flattened-code" verification endpoint and let it auto-detect constructor args
// from the creation transaction — no manual ABI encoding needed.
//
// Flow: submitVerification() POSTs the source + compiler settings, then the
// client polls getVerificationStatus() until the contract reports is_verified.

// Resolve the exact compiler build name Blockscout expects
// (e.g. "0.8.20" → "v0.8.20+commit.a1b79de6"). Cached per server instance.
let releasesCache: Record<string, string> | null = null;
async function longCompilerVersion(short: string): Promise<string> {
  if (!releasesCache) {
    const resp = await fetch("https://binaries.soliditylang.org/bin/list.json");
    if (!resp.ok) throw new Error(`Could not load solc version list (${resp.status})`);
    releasesCache = ((await resp.json()) as { releases?: Record<string, string> }).releases ?? {};
  }
  const file = releasesCache[short];
  if (!file) throw new Error(`solc ${short} not found in the release list`);
  // "soljson-v0.8.20+commit.a1b79de6.js" → "v0.8.20+commit.a1b79de6"
  return file.replace(/^soljson-/, "").replace(/\.js$/, "");
}

function explorerBase(chainId: number): string {
  return chainConfig(chainId).explorerUrl.replace(/\/$/, "");
}

const submitInput = z.object({
  chainId: z.number(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  contractName: z.string().min(1),
  sourceCode: z.string().min(1),
  compilerVersion: z.string().min(3), // short, e.g. "0.8.20"
  optimization: z.boolean().default(false),
  optimizationRuns: z.number().int().positive().default(200),
  evmVersion: z.string().default("default"),
  licenseType: z.string().default("mit"),
});

export const submitVerification = createServerFn({ method: "POST" })
  .inputValidator(submitInput)
  .handler(async ({ data }) => {
    let compiler: string;
    try {
      compiler = await longCompilerVersion(data.compilerVersion);
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "version error" };
    }

    const url = `${explorerBase(data.chainId)}/api/v2/smart-contracts/${data.address}/verification/via/flattened-code`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          compiler_version: compiler,
          source_code: data.sourceCode,
          contract_name: data.contractName,
          is_optimization_enabled: data.optimization,
          optimization_runs: data.optimizationRuns,
          evm_version: data.evmVersion,
          autodetect_constructor_args: true,
          license_type: data.licenseType,
        }),
      });
      const text = await resp.text();
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* keep raw text */
      }
      // 200/201 → accepted; 409 → already verified (treat as success).
      if (resp.ok || resp.status === 409) {
        return { ok: true as const, message: message || "Verification submitted" };
      }
      return { ok: false as const, message: message || `Explorer returned ${resp.status}` };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Request failed" };
    }
  });

const statusInput = z.object({
  chainId: z.number(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export const getVerificationStatus = createServerFn({ method: "GET" })
  .inputValidator(statusInput)
  .handler(async ({ data }) => {
    const url = `${explorerBase(data.chainId)}/api/v2/smart-contracts/${data.address}`;
    try {
      const resp = await fetch(url);
      if (resp.status === 404) return { verified: false as const, found: false as const };
      if (!resp.ok) return { verified: false as const, found: false as const };
      const json = (await resp.json()) as { is_verified?: boolean; name?: string };
      return {
        verified: json.is_verified === true,
        found: true as const,
        name: json.name ?? null,
      };
    } catch {
      return { verified: false as const, found: false as const };
    }
  });
