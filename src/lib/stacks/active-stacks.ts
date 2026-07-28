// Active Stacks network preference (testnet default) — the Stacks analog of
// src/lib/solana/active-solana.ts. Persisted, and kept separate from the EVM /
// Solana selections.

import { create } from "zustand";
import {
  DEFAULT_STACKS_NETWORK,
  isStacksNetwork,
  STACKS_CHAINS,
  stacksChain,
  type StacksNetworkId,
} from "./chains";

const KEY = "devstation-stacks-pref";

function load(): StacksNetworkId {
  if (typeof window === "undefined") return DEFAULT_STACKS_NETWORK;
  const raw = localStorage.getItem(KEY);
  return isStacksNetwork(raw) ? raw : DEFAULT_STACKS_NETWORK;
}

interface StacksPrefState {
  network: StacksNetworkId;
  setNetwork: (n: StacksNetworkId) => void;
}

export const useStacksPref = create<StacksPrefState>((set) => ({
  network: load(),
  setNetwork: (network) => {
    if (typeof window !== "undefined") localStorage.setItem(KEY, network);
    set({ network });
  },
}));

export { STACKS_CHAINS, stacksChain };
