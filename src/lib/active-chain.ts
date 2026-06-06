// Active QIE network state. The app supports BOTH QIE Testnet (1983) and
// Mainnet (1990) equally — it never forces or auto-switches. The active chain
// is, in priority order:
//   1. the wallet's connected chain, if it's a supported QIE chain
//   2. the user's last explicit selection (persisted)
//   3. the default (testnet)
// This store holds only the user's explicit preference; the resolved active
// chain is computed in useActiveChain() which also reads the wallet.
import { create } from "zustand";
import { qieTestnet, qieMainnet, SUPPORTED_CHAINS } from "./chains";

const PREF_KEY = "devstation-network-pref";

function loadPref(): number {
  if (typeof window === "undefined") return qieTestnet.id;
  const raw = Number(localStorage.getItem(PREF_KEY));
  return SUPPORTED_CHAINS.some((c) => c.id === raw) ? raw : qieTestnet.id;
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
