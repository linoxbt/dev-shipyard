// Unified "which chain family is active" state, spanning the EVM chains
// (src/lib/active-chain.ts) and Solana (src/lib/solana/active-solana.ts). The
// shared feature pages (Templates, Editor, Code with AI, Deploy) read this to
// render the EVM or the Solana variant — so Solana lives inside the SAME
// features and the SAME network selector as every other chain, not a separate
// section.

import { create } from "zustand";

export type ChainFamily = "evm" | "solana" | "stacks";

const KEY = "devstation-active-family";

function load(): ChainFamily {
  if (typeof window === "undefined") return "evm";
  const v = localStorage.getItem(KEY);
  return v === "solana" || v === "stacks" ? v : "evm";
}

interface ActiveFamilyState {
  family: ChainFamily;
  setFamily: (f: ChainFamily) => void;
}

export const useActiveFamily = create<ActiveFamilyState>((set) => ({
  family: load(),
  setFamily: (family) => {
    if (typeof window !== "undefined") localStorage.setItem(KEY, family);
    set({ family });
  },
}));
