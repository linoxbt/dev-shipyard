// Real wallet/network state, backed by wagmi. `useWallet` keeps the same shape
// the UI already consumes so existing call sites work unchanged.
import { useCallback } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { qieTestnet } from "./chains";

export const QIE_CHAIN_ID = qieTestnet.id;

export interface WalletView {
  connected: boolean;
  address: `0x${string}` | null;
  chainId: number;
  connect: () => void;
  disconnect: () => void;
  switchToQIE: () => void;
}

export function useWallet(): WalletView {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const doConnect = useCallback(() => {
    const injectedConnector = connectors.find((c) => c.type === "injected") ?? connectors[0];
    if (injectedConnector) connect({ connector: injectedConnector });
  }, [connect, connectors]);

  return {
    connected: isConnected,
    address: address ?? null,
    chainId: chainId ?? QIE_CHAIN_ID,
    connect: doConnect,
    disconnect: () => disconnect(),
    switchToQIE: () => switchChain({ chainId: QIE_CHAIN_ID }),
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
