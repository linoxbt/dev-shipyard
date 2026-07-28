// Pluggable Solana deploy provider — the single entry point every feature
// (templates, editor, AI agent) calls to deploy on Solana. Binds the pure
// deploy functions to the active wallet context from useSolanaWallet().
//
// Option 1 (client-side, no build infra): deployToken / deployNft, and
// deployProgram from prebuilt .so bytes. Option 2 (remote build): buildProgram
// compiles arbitrary Anchor/Rust source via an external service, then hands the
// resulting .so to deployProgram. Option 2 degrades gracefully — see
// remote-build.ts — so token/NFT/prebuilt deploys always work regardless.

import { useCallback } from "react";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import {
  deployNft as _deployNft,
  deployToken as _deployToken,
  type DeployContext,
  type DeployResult,
  type NftParams,
  type TokenParams,
} from "./spl";
import { deployProgram as _deployProgram, type ProgramDeployResult } from "./program";
import { buildProgram as _buildProgram, isRemoteBuildEnabled, type BuildResult } from "./remote-build";

export function useSolanaDeploy() {
  const wallet = useSolanaWallet();

  const ctx = useCallback((): DeployContext => {
    if (!wallet.publicKey) throw new Error("Connect or unlock a Solana wallet first");
    return {
      connection: wallet.connection,
      payer: wallet.publicKey,
      signAndSend: wallet.signAndSend,
    };
  }, [wallet]);

  return {
    ready: wallet.connected,
    remoteBuildEnabled: isRemoteBuildEnabled(),
    deployToken: useCallback((p: TokenParams) => _deployToken(ctx(), p), [ctx]),
    deployNft: useCallback((p?: NftParams) => _deployNft(ctx(), p), [ctx]),
    deployProgram: useCallback(
      (soBytes: Uint8Array, idl?: unknown) => _deployProgram(ctx(), soBytes, idl),
      [ctx],
    ),
    buildProgram: useCallback(
      (source: string, kind: "anchor" | "native") => _buildProgram(source, kind),
      [],
    ),
  };
}

export type { TokenParams, NftParams, DeployResult, ProgramDeployResult, BuildResult };
