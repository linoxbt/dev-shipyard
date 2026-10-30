// Starting points offered on the Coding Agent's first screen: as quick chips
// under the prompt, and as cards on its Templates tab.

export type IdeaKind = "community" | "token" | "api" | "nft" | "dashboard" | "game";

export const IDEAS: { label: string; prompt: string; blurb: string; kind: IdeaKind }[] = [
  {
    label: "Token-gated community page",
    prompt: "Build a token-gated community page for QIE holders, with a members-only feed",
    blurb: "A members-only feed that checks the visitor's QIE balance.",
    kind: "community",
  },
  {
    label: "ERC-20 with a faucet",
    prompt:
      "Write and test an ERC-20 with a capped supply and a faucet, then build a page to use it",
    blurb: "A tested token contract, plus a page to claim from the faucet.",
    kind: "token",
  },
  {
    label: "Tips API with tests",
    prompt: "Make a small REST API with tests that tracks tips per wallet",
    blurb: "A small backend with a test suite, no web page needed.",
    kind: "api",
  },
  {
    label: "NFT mint page",
    prompt: "Build an NFT mint page with a live supply counter and a gallery of minted tokens",
    blurb: "Mint button, live supply and a gallery of what has been minted.",
    kind: "nft",
  },
  {
    label: "Wallet dashboard",
    prompt: "Build a dashboard that shows a wallet's balances and recent transactions",
    blurb: "Balances and recent transactions for any address.",
    kind: "dashboard",
  },
  {
    label: "On-chain guessing game",
    prompt:
      "Build a small on-chain number guessing game: a contract that holds the pot and a page to play it",
    blurb: "A contract that holds the pot, and a page to play against it.",
    kind: "game",
  },
];
