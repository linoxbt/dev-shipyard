// Real wallet/network state, backed by wagmi. `useWallet` keeps the same shape
// the UI already consumes so existing call sites work unchanged.
import { useCallback } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { DEFAULT_CHAIN } from "./chains";

export interface WalletView {
  connected: boolean;
  address: `0x${string}` | null;
  chainId: number;
  connect: () => void;
  disconnect: () => void;
}

export function useWallet(): WalletView {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const doConnect = useCallback(() => {
    const injectedConnector = connectors.find((c) => c.type === "injected") ?? connectors[0];
    if (injectedConnector) connect({ connector: injectedConnector });
  }, [connect, connectors]);

  return {
    connected: isConnected,
    address: address ?? null,
    chainId: chainId ?? DEFAULT_CHAIN.id,
    connect: doConnect,
    disconnect: () => disconnect(),
  };
}

export function truncateAddress(addr: string, head = 6, tail = 4) {
  if (!addr) return "";
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function truncateHash(hash: string) {
  if (!hash) return "";
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}
