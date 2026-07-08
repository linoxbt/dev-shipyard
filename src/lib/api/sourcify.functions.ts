import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { avalancheMainnet, avalancheTestnet, xlayerMainnet, xlayerTestnet } from "@/lib/chains";
import { longCompilerVersion } from "./verify.functions";

// Contract verification for chains whose own explorer doesn't speak
// Blockscout's verification API (Avalanche's Snowtrace runs on Routescan; X
// Layer's OKLink needs a registered key we don't have). Sourcify
// (sourcify.dev) is a free, keyless, public verification service that
// recompiles from source and matches against onchain bytecode via its own
// RPC — confirmed live and listed as a supported chain for all 4 networks
// below (checked https://sourcify.dev/server/chains).
//
// Flow mirrors verify.functions.ts's standard-input path: submit the exact
// solc standard-JSON the in-browser worker compiled, then poll the returned
// job id until Sourcify reports a match.

const SOURCIFY_BASE = "https://sourcify.dev/server";

const SOURCIFY_CHAINS = new Set<number>([
  avalancheMainnet.id,
  avalancheTestnet.id,
  xlayerMainnet.id,
  xlayerTestnet.id,
]);

export function isSourcifyChain(chainId: number): boolean {
  return SOURCIFY_CHAINS.has(chainId);
}

function isMatch(match: unknown): boolean {
  return match === "match" || match === "exact_match";
}

const statusInput = z.object({
  chainId: z.number(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

// Is this address already verified on Sourcify? Used both as the deploy
// flow's "already verified, skip" pre-check and the explorer's Contract tab.
export const getSourcifyStatus = createServerFn({ method: "GET" })
  .inputValidator(statusInput)
  .handler(async ({ data }) => {
    try {
      const resp = await fetch(`${SOURCIFY_BASE}/v2/contract/${data.chainId}/${data.address}`);
      if (resp.status === 404) return { verified: false as const, found: false as const };
      if (!resp.ok) return { verified: false as const, found: false as const };
      const json = (await resp.json()) as { match?: string | null };
      return { verified: isMatch(json.match), found: true as const };
    } catch {
      return { verified: false as const, found: false as const };
    }
  });

const submitInput = z.object({
  chainId: z.number(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  contractIdentifier: z.string().min(1), // "File.sol:ContractName"
  standardJsonInput: z.string().min(1), // exact solc standard-JSON
  compilerVersion: z.string().min(3), // short, e.g. "0.8.20"
});

export const submitSourcifyVerification = createServerFn({ method: "POST" })
  .inputValidator(submitInput)
  .handler(async ({ data }) => {
    let compiler: string;
    try {
      compiler = await longCompilerVersion(data.compilerVersion);
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "version error" };
    }

    let stdJsonInput: unknown;
    try {
      stdJsonInput = JSON.parse(data.standardJsonInput);
    } catch {
      return { ok: false as const, message: "Invalid standard-JSON input" };
    }

    try {
      const resp = await fetch(`${SOURCIFY_BASE}/v2/verify/${data.chainId}/${data.address}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stdJsonInput,
          compilerVersion: compiler,
          contractIdentifier: data.contractIdentifier,
        }),
      });
      const text = await resp.text();
      let json: { verificationId?: string; message?: string } | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* keep raw text as the message below */
      }
      if (resp.status === 202 && json?.verificationId) {
        return {
          ok: true as const,
          verificationId: json.verificationId,
          message: "Verification submitted",
        };
      }
      return {
        ok: false as const,
        message: json?.message || text || `Sourcify returned ${resp.status}`,
      };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Request failed" };
    }
  });

export interface SourcifyContractDetail {
  is_verified: boolean;
  name?: string;
  source_code?: string;
  compiler_version?: string;
  evm_version?: string;
  optimization_enabled?: boolean;
  optimization_runs?: number;
  abi?: unknown[];
  creation_bytecode?: string;
  deployed_bytecode?: string;
}

interface SourcifyCompilation {
  name?: string;
  compilerVersion?: string;
  compilerSettings?: {
    evmVersion?: string;
    optimizer?: { enabled?: boolean; runs?: number };
  };
}

// Full contract detail (source, ABI, compiler settings, bytecode) for the
// explorer's Contract tab on Sourcify-backed chains (Avalanche, X Layer).
// Not wrapped in createServerFn — this is called server-side, from
// routescan.functions.ts's own server function, not directly from the client.
export async function fetchSourcifyContractDetail(
  chainId: number,
  address: string,
): Promise<SourcifyContractDetail> {
  try {
    const resp = await fetch(
      `${SOURCIFY_BASE}/v2/contract/${chainId}/${address}` +
        "?fields=abi,sources,compilation,creationBytecode.onchainBytecode,runtimeBytecode.onchainBytecode",
    );
    if (!resp.ok) return { is_verified: false };
    const json = (await resp.json()) as {
      match?: string | null;
      abi?: unknown[];
      sources?: Record<string, string>;
      compilation?: SourcifyCompilation;
      creationBytecode?: { onchainBytecode?: string };
      runtimeBytecode?: { onchainBytecode?: string };
    };
    if (!isMatch(json.match)) return { is_verified: false };

    const sources = json.sources ?? {};
    const sourceCode = Object.entries(sources)
      .map(([file, content]) => `// ${file}\n${content}`)
      .join("\n\n");

    return {
      is_verified: true,
      name: json.compilation?.name,
      source_code: sourceCode || undefined,
      compiler_version: json.compilation?.compilerVersion,
      evm_version: json.compilation?.compilerSettings?.evmVersion,
      optimization_enabled: json.compilation?.compilerSettings?.optimizer?.enabled,
      optimization_runs: json.compilation?.compilerSettings?.optimizer?.runs,
      abi: json.abi,
      creation_bytecode: json.creationBytecode?.onchainBytecode,
      deployed_bytecode: json.runtimeBytecode?.onchainBytecode,
    };
  } catch {
    return { is_verified: false };
  }
}

const jobInput = z.object({ verificationId: z.string().min(1) });

export const getSourcifyJobStatus = createServerFn({ method: "GET" })
  .inputValidator(jobInput)
  .handler(async ({ data }) => {
    try {
      const resp = await fetch(`${SOURCIFY_BASE}/v2/verify/${data.verificationId}`);
      if (!resp.ok) {
        return {
          completed: false as const,
          verified: false as const,
          message: `Sourcify returned ${resp.status}`,
        };
      }
      const json = (await resp.json()) as {
        isJobCompleted?: boolean;
        contract?: { match?: string | null };
        error?: { message?: string };
      };
      if (!json.isJobCompleted) {
        return { completed: false as const, verified: false as const, message: "Verifying…" };
      }
      const verified = isMatch(json.contract?.match);
      return {
        completed: true as const,
        verified,
        message: verified
          ? "Contract verified on Sourcify."
          : (json.error?.message ?? "Bytecode did not match the deployed contract."),
      };
    } catch (e) {
      return {
        completed: false as const,
        verified: false as const,
        message: e instanceof Error ? e.message : "Request failed",
      };
    }
  });
