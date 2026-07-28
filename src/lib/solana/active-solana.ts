// Active Solana cluster preference — the Solana analog of
// src/lib/active-chain.ts. Holds only the user's explicit cluster choice,
// persisted to localStorage. Kept separate from the EVM network preference so
// switching Solana clusters never disturbs the EVM active-chain state (and vice
// versa). The resolved connection lives in useActiveSolana().

import { create } from "zustand";
import {
  DEFAULT_SOLANA_CLUSTER,
  isSolanaCluster,
  SOLANA_CHAINS,
  solanaChain,
  type SolanaCluster,
} from "./chains";

const PREF_KEY = "devstation-solana-pref";

function loadPref(): SolanaCluster {
  if (typeof window === "undefined") return DEFAULT_SOLANA_CLUSTER;
  const raw = localStorage.getItem(PREF_KEY);
  return isSolanaCluster(raw) ? raw : DEFAULT_SOLANA_CLUSTER;
}

interface SolanaPrefState {
  cluster: SolanaCluster;
  setCluster: (cluster: SolanaCluster) => void;
}

export const useSolanaPref = create<SolanaPrefState>((set) => ({
  cluster: loadPref(),
  setCluster: (cluster) => {
    if (typeof window !== "undefined") localStorage.setItem(PREF_KEY, cluster);
    set({ cluster });
  },
}));

export { SOLANA_CHAINS, solanaChain };
