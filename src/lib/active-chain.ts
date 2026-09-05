// Active network state. It never forces or auto-switches. The user's explicit
// selection is authoritative for reads everywhere in the app and is NOT
// overridden by the wallet's chain: a wallet on a different chain surfaces a
// mismatch instead (see useActiveChain, which resolves the active chain and
// owns that rule). Falls back to DEFAULT_CHAIN (currently QIE Mainnet).
import { create } from "zustand";
import { qieTestnet, qieMainnet, DEFAULT_CHAIN, SUPPORTED_CHAINS } from "./chains";

const PREF_KEY = "devstation-network-pref";

function readStoredPref(): number {
  if (typeof window === "undefined") return DEFAULT_CHAIN.id;
  try {
    const raw = Number(localStorage.getItem(PREF_KEY));
    return SUPPORTED_CHAINS.some((c) => c.id === raw) ? raw : DEFAULT_CHAIN.id;
  } catch {
    // Private mode / blocked storage: fall back rather than throwing at init.
    return DEFAULT_CHAIN.id;
  }
}

interface NetworkPrefState {
  preferredChainId: number;
  /** False until the stored preference has been read on the client. Anything
   *  that renders differently per chain must treat pre-hydration state as the
   *  default chain, or SSR and the first client render disagree. */
  hydrated: boolean;
  hydrate: () => void;
  setPreferred: (chainId: number) => void;
}

// The initial value is DETERMINISTIC: always DEFAULT_CHAIN, on both the
// server and the client's first render, and the stored preference is applied
// afterwards by hydrate().
//
// Reading localStorage here instead (the previous behaviour) meant the server
// rendered DEFAULT_CHAIN's wording while a client whose stored chain differed
// rendered something else, so any chain-dependent text (token standards,
// template names, network labels) produced a React hydration mismatch and a
// flash of the wrong chain's content. See src/lib/terminology.ts.
export const useNetworkPref = create<NetworkPrefState>((set, get) => ({
  preferredChainId: DEFAULT_CHAIN.id,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ preferredChainId: readStoredPref(), hydrated: true });
  },
  setPreferred: (chainId) => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(PREF_KEY, String(chainId));
      } catch {
        /* preference just won't persist; the in-memory selection still works */
      }
    }
    set({ preferredChainId: chainId, hydrated: true });
  },
}));

export function chainById(id: number | undefined) {
  return SUPPORTED_CHAINS.find((c) => c.id === id);
}

export { qieTestnet, qieMainnet, SUPPORTED_CHAINS };
