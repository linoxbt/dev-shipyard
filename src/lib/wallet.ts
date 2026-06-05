// Mock wallet/network state. Replace with wagmi later.
import { create } from "zustand";

interface WalletState {
  connected: boolean;
  address: string | null;
  chainId: number;
  qiePassVerified: boolean;
  connect: () => void;
  disconnect: () => void;
  switchToQIE: () => void;
  setChainId: (id: number) => void;
}

const MOCK_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB";
export const QIE_CHAIN_ID = 1983;

export const useWallet = create<WalletState>((set) => ({
  connected: true,
  address: MOCK_ADDRESS,
  chainId: QIE_CHAIN_ID,
  qiePassVerified: true,
  connect: () => set({ connected: true, address: MOCK_ADDRESS, chainId: QIE_CHAIN_ID }),
  disconnect: () => set({ connected: false, address: null }),
  switchToQIE: () => set({ chainId: QIE_CHAIN_ID }),
  setChainId: (id) => set({ chainId: id }),
}));

export function truncateAddress(addr: string, head = 6, tail = 4) {
  if (!addr) return "";
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function truncateHash(hash: string) {
  if (!hash) return "";
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}
