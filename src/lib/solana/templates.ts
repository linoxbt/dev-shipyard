// Solana deploy templates — the Solana analog of src/lib/mock/templates.ts, but
// shaped for Solana's model (SPL tokens/NFTs need no compiler; programs are
// Rust/Anchor source). Token/NFT templates deploy fully client-side; program
// templates carry Rust source that the editor/AI can build via the remote build
// service (Option 2) or that ship as prebuilt .so (Option 1).

export type SolanaTemplateKind = "token" | "nft" | "program";

export interface TokenDefaults {
  name: string;
  symbol: string;
  /** Off-chain metadata JSON / image URI. */
  uri?: string;
  decimals: number;
  supply: number;
  fixedSupply?: boolean;
  freezable?: boolean;
}

export interface SolanaTemplate {
  id: string;
  name: string;
  kind: SolanaTemplateKind;
  category: string;
  description: string;
  /** Default params for token/nft kinds. */
  token?: TokenDefaults;
  /** Rust/Anchor source for program kind. */
  source?: string;
  buildKind?: "anchor" | "native";
}

export const SOLANA_CATEGORIES = ["Token", "NFT", "Program"] as const;

const ANCHOR_COUNTER = `use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[program]
pub mod counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.counter.count = 0;
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        ctx.accounts.counter.count += 1;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = user, space = 8 + 8)]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut)]
    pub counter: Account<'info, Counter>,
}

#[account]
pub struct Counter {
    pub count: u64,
}
`;

export const SOLANA_TEMPLATES: SolanaTemplate[] = [
  {
    id: "spl-token",
    name: "SPL Token",
    kind: "token",
    category: "Token",
    description:
      "A standard SPL fungible token with on-chain Metaplex metadata (name, symbol, URI). Creates the mint and mints an initial supply to your wallet. Deploys fully in-browser on devnet.",
    token: { name: "DevStation Token", symbol: "DEV", uri: "", decimals: 9, supply: 1_000_000, fixedSupply: false, freezable: false },
  },
  {
    id: "fixed-supply-token",
    name: "Fixed-Supply Token",
    kind: "token",
    category: "Token",
    description:
      "An SPL token with a capped supply — the mint authority is revoked after the initial mint, so no more can ever be created. Ships with on-chain name/symbol/URI.",
    token: { name: "Fixed Token", symbol: "FIX", uri: "", decimals: 6, supply: 21_000_000, fixedSupply: true, freezable: false },
  },
  {
    id: "simple-nft",
    name: "Simple NFT (1/1)",
    kind: "nft",
    category: "NFT",
    description:
      "A 0-decimal, supply-1 mint with mint authority revoked — a one-of-one collectible with on-chain Metaplex name/symbol and a metadata/image URI.",
    token: { name: "DevStation NFT", symbol: "DNFT", uri: "", decimals: 0, supply: 1, fixedSupply: true, freezable: false },
  },
  {
    id: "anchor-counter",
    name: "Anchor Counter",
    kind: "program",
    category: "Program",
    description:
      "A minimal Anchor program with an on-chain counter (initialize + increment). Open in the editor / AI and build via the remote build service to deploy.",
    source: ANCHOR_COUNTER,
    buildKind: "anchor",
  },
];

export function solanaTemplate(id: string): SolanaTemplate | undefined {
  return SOLANA_TEMPLATES.find((t) => t.id === id);
}

export function categoryColor(category: string): string {
  switch (category) {
    case "Token":
      return "text-info border-info/40 bg-info/10";
    case "NFT":
      return "text-primary border-primary/40 bg-primary/10";
    case "Program":
      return "text-warning border-warning/40 bg-warning/10";
    default:
      return "text-meta border-border bg-surface-2";
  }
}
