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
export async function longCompilerVersion(short: string): Promise<string> {
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

// Standard-JSON ("standard-input") verification. This is the robust path: we
// resubmit the EXACT solc standard-JSON input the in-browser worker compiled, so
// the explorer recompiles to byte-identical bytecode regardless of how many
// source files (e.g. OpenZeppelin imports) the contract pulls in. Flattened-code
// verification can't do this — it only carries the top source file.
const stdInput = z.object({
  chainId: z.number(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  contractName: z.string().min(1), // fully-qualified "File.sol:Name"
  standardJsonInput: z.string().min(1), // exact solc standard-JSON
  compilerVersion: z.string().min(3), // short, e.g. "0.8.20"
  constructorArgs: z.string().optional(), // 0x ABI-encoded tail, no selector
  licenseType: z.string().default("mit"),
});

export const submitStandardJsonVerification = createServerFn({ method: "POST" })
  .inputValidator(stdInput)
  .handler(async ({ data }) => {
    let compiler: string;
    try {
      compiler = await longCompilerVersion(data.compilerVersion);
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "version error" };
    }

    const url = `${explorerBase(data.chainId)}/api/v2/smart-contracts/${data.address}/verification/via/standard-input`;
    const explicitArgs = data.constructorArgs && data.constructorArgs !== "0x";

    const parse = (text: string) => {
      try {
        return (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        return text;
      }
    };
    const ok = (status: number) => status === 200 || status === 201 || status === 409;

    // Primary: multipart/form-data with the standard-JSON as an uploaded file —
    // the shape Blockscout's v2 standard-input endpoint expects. Never set the
    // content-type manually; fetch derives the multipart boundary.
    try {
      const fd = new FormData();
      fd.append("compiler_version", compiler);
      fd.append("contract_name", data.contractName);
      fd.append("license_type", data.licenseType);
      if (explicitArgs) {
        fd.append("autodetect_constructor_args", "false");
        fd.append("constructor_args", data.constructorArgs as string);
      } else {
        fd.append("autodetect_constructor_args", "true");
      }
      fd.append(
        "files[0]",
        new Blob([data.standardJsonInput], { type: "application/json" }),
        "input.json",
      );

      const resp = await fetch(url, { method: "POST", body: fd });
      const text = await resp.text();
      if (ok(resp.status)) {
        return { ok: true as const, message: parse(text) || "Verification submitted" };
      }
      // Some Blockscout builds want a JSON body instead — fall back on a
      // request-shape rejection (400/422) before giving up.
      if (resp.status !== 400 && resp.status !== 422) {
        return { ok: false as const, message: parse(text) || `Explorer returned ${resp.status}` };
      }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Request failed" };
    }

    // Fallback: JSON body carrying the standard-JSON as `source_code`.
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          compiler_version: compiler,
          contract_name: data.contractName,
          source_code: data.standardJsonInput,
          license_type: data.licenseType,
          autodetect_constructor_args: !explicitArgs,
          ...(explicitArgs ? { constructor_args: data.constructorArgs } : {}),
        }),
      });
      const text = await resp.text();
      if (ok(resp.status)) {
        return { ok: true as const, message: parse(text) || "Verification submitted" };
      }
      return { ok: false as const, message: parse(text) || `Explorer returned ${resp.status}` };
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

// Has the explorer's indexer registered this address as a contract yet? Right
// after a deploy the creation tx is mined but Blockscout may not have indexed
// the address — submitting verification too early returns 404 "Address is not a
// smart-contract". Callers poll this until it returns true before submitting.
export const getIsContractIndexed = createServerFn({ method: "GET" })
  .inputValidator(statusInput)
  .handler(async ({ data }) => {
    const url = `${explorerBase(data.chainId)}/api/v2/addresses/${data.address}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return { indexed: false as const };
      const json = (await resp.json()) as { is_contract?: boolean };
      return { indexed: json.is_contract === true };
    } catch {
      return { indexed: false as const };
    }
  });
