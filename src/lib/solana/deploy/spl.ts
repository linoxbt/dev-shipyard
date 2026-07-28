// Client-side SPL deploys (Option 1). Builds the token/NFT-creation transaction
// from spl-token instruction primitives (works with BOTH the burner keypair and
// an external wallet-adapter via useSolanaWallet.signAndSend). When name/symbol
// are given, a Metaplex Token Metadata (CreateMetadataAccountV3) instruction is
// appended so the token/NFT gets real on-chain name/symbol/URI. Runs fully in
// the browser on devnet; no compiler or backend needed.

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";

/** Context the deploy functions need, sourced from useSolanaWallet(). */
export interface DeployContext {
  connection: Connection;
  payer: PublicKey;
  signAndSend: (tx: Transaction, extraSigners?: Keypair[]) => Promise<string>;
}

export interface TokenParams {
  name?: string;
  symbol?: string;
  /** Off-chain metadata JSON / image URI. */
  uri?: string;
  decimals: number;
  /** Initial whole-token supply minted to the payer (0 = none). */
  supply: number;
  /** Keep the freeze authority (payer) on the mint. */
  freezable?: boolean;
  /** Revoke mint authority after the initial mint (fixed supply). */
  fixedSupply?: boolean;
}

export interface NftParams {
  name?: string;
  symbol?: string;
  uri?: string;
  /** How many editions to mint (1 = a 1/1). */
  count?: number;
}

export interface DeployResult {
  mint: string;
  signature: string;
}

const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("metadata"), METADATA_PROGRAM.toBytes(), mint.toBytes()],
    METADATA_PROGRAM,
  )[0];
}

// Borsh helpers (Uint8Array, no Node Buffer dependency at module scope).
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function bstr(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  out.set(u32le(bytes.length), 0);
  out.set(bytes, 4);
  return out;
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// CreateMetadataAccountV3 instruction (DataV2 with no creators/collection/uses).
function createMetadataIx(mint: PublicKey, payer: PublicKey, name: string, symbol: string, uri: string): TransactionInstruction {
  const metadata = metadataPda(mint);
  const data = concat([
    Uint8Array.of(33), // discriminator: CreateMetadataAccountV3
    bstr(name),
    bstr(symbol),
    bstr(uri),
    Uint8Array.of(0, 0), // sellerFeeBasisPoints u16 = 0
    Uint8Array.of(0), // creators: Option = None
    Uint8Array.of(0), // collection: Option = None
    Uint8Array.of(0), // uses: Option = None
    Uint8Array.of(1), // isMutable = true
    Uint8Array.of(0), // collectionDetails: Option = None
  ]);
  return new TransactionInstruction({
    programId: METADATA_PROGRAM,
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: false }, // mint authority
      { pubkey: payer, isSigner: true, isWritable: true }, // payer
      { pubkey: payer, isSigner: false, isWritable: false }, // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/** Create a new SPL fungible token mint (+ optional metadata + initial supply). */
export async function deployToken(ctx: DeployContext, p: TokenParams): Promise<DeployResult> {
  const { connection, payer } = ctx;
  const mint = Keypair.generate();
  const rent = await getMinimumBalanceForRentExemptMint(connection);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, p.decimals, payer, p.freezable ? payer : null),
  );

  if (p.name) {
    tx.add(createMetadataIx(mint.publicKey, payer, p.name, p.symbol ?? "", p.uri ?? ""));
  }

  if (p.supply > 0) {
    const ata = getAssociatedTokenAddressSync(mint.publicKey, payer);
    const rawAmount = BigInt(Math.trunc(p.supply)) * 10n ** BigInt(p.decimals);
    tx.add(
      createAssociatedTokenAccountInstruction(payer, ata, payer, mint.publicKey),
      createMintToInstruction(mint.publicKey, ata, payer, rawAmount),
    );
    if (p.fixedSupply) {
      tx.add(createSetAuthorityInstruction(mint.publicKey, payer, AuthorityType.MintTokens, null));
    }
  }

  const signature = await ctx.signAndSend(tx, [mint]);
  return { mint: mint.publicKey.toBase58(), signature };
}

/** Mint an NFT-style asset: a 0-decimal, supply-1 mint with Metaplex metadata. */
export async function deployNft(ctx: DeployContext, p: NftParams = {}): Promise<DeployResult> {
  const count = Math.max(1, p.count ?? 1);
  return deployToken(ctx, {
    name: p.name,
    symbol: p.symbol,
    uri: p.uri,
    decimals: 0,
    supply: count,
    freezable: false,
    fixedSupply: true,
  });
}
