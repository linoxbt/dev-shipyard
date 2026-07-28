// Deploy a compiled Solana program (.so BPF bytecode) — used for prebuilt
// program templates (Option 1) and for the .so returned by the remote build
// service (Option 2).
//
// Honest limitation: streaming program bytes to the chain requires many signed
// transactions with a program *account* keypair as a signer. An external
// wallet-adapter wallet exposes no keypair for that account, so client-side
// program deployment uses the in-app burner keypair (a real Signer). Token/NFT
// deploys have no such restriction and work with any wallet. web3.js's legacy
// BpfLoader is used; it deploys a non-upgradeable program, which is sufficient
// for devnet testing.

import { BpfLoader, BPF_LOADER_PROGRAM_ID, Keypair } from "@solana/web3.js";
import { getBurnerKeypair } from "@/lib/solana/burner/store";
import type { DeployContext } from "./spl";

export interface ProgramDeployResult {
  programId: string;
  idl?: unknown;
}

export async function deployProgram(
  ctx: DeployContext,
  soBytes: Uint8Array,
  idl?: unknown,
): Promise<ProgramDeployResult> {
  const kp = getBurnerKeypair();
  if (!kp) {
    throw new Error(
      "Deploying a program requires the in-app burner wallet (external wallets can't sign the program-account stream client-side). Generate or unlock a Solana burner, then retry.",
    );
  }
  if (!soBytes || soBytes.length === 0) {
    throw new Error("No program bytecode to deploy.");
  }

  const programAccount = Keypair.generate();
  const ok = await BpfLoader.load(
    ctx.connection,
    kp,
    programAccount,
    soBytes,
    BPF_LOADER_PROGRAM_ID,
  );
  if (!ok) throw new Error("Program failed to load onto the cluster.");

  return { programId: programAccount.publicKey.toBase58(), idl };
}
