// Active network state, across every supported chain family — it never
// forces or auto-switches. The active chain is, in priority order:
//   1. the wallet's connected chain, if it's a supported chain
//   2. the user's last explicit selection (persisted)
//   3. the default (DEFAULT_CHAIN, currently BOT Chain mainnet)
// This store holds only the user's explicit preference; the resolved active
// chain is computed in useActiveChain() which also reads the wallet.
import { create } from "zustand";
import { qieTestnet, qieMainnet, DEFAULT_CHAIN, SUPPORTED_CHAINS } from "./chains";

const PREF_KEY = "devstation-network-pref";

function loadPref(): number {
  if (typeof window === "undefined") return DEFAULT_CHAIN.id;
  const raw = Number(localStorage.getItem(PREF_KEY));
  return SUPPORTED_CHAINS.some((c) => c.id === raw) ? raw : DEFAULT_CHAIN.id;
}

interface NetworkPrefState {
  preferredChainId: number;
  setPreferred: (chainId: number) => void;
}

export const useNetworkPref = create<NetworkPrefState>((set) => ({
  preferredChainId: loadPref(),
  setPreferred: (chainId) => {
    if (typeof window !== "undefined") localStorage.setItem(PREF_KEY, String(chainId));
    set({ preferredChainId: chainId });
  },
}));

export function chainById(id: number | undefined) {
  return SUPPORTED_CHAINS.find((c) => c.id === id);
}

export { qieTestnet, qieMainnet, SUPPORTED_CHAINS };
