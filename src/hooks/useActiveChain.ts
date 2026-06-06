import { useAccount, useSwitchChain } from "wagmi";
import { useNetworkPref, chainById, qieTestnet, SUPPORTED_CHAINS } from "@/lib/active-chain";
import { chainConfig } from "@/lib/chains";

// Resolves the active QIE chain without hardcoding or forcing:
//  - if a wallet is connected to a supported QIE chain, that wins
//  - otherwise the user's persisted preference
//  - otherwise testnet
// `select(chainId)` switches the wallet when connected, and always records the
// preference so reads use the chosen chain even with no wallet.
export function useActiveChain() {
  const { isConnected, chainId: walletChainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { preferredChainId, setPreferred } = useNetworkPref();

  const walletOnSupported = isConnected && SUPPORTED_CHAINS.some((c) => c.id === walletChainId);
  const activeChainId = walletOnSupported ? (walletChainId as number) : preferredChainId;
  const chain = chainById(activeChainId) ?? qieTestnet;

  const select = (chainId: number) => {
    setPreferred(chainId);
    if (isConnected) {
      try {
        switchChain({ chainId });
      } catch {
        /* user can switch manually in their wallet */
      }
    }
  };

  return {
    chainId: activeChainId,
    chain,
    config: chainConfig(activeChainId),
    isTestnet: chain.testnet === true,
    supported: SUPPORTED_CHAINS,
    select,
    /** true when the wallet is connected but on an unsupported chain */
    walletOnWrongNetwork: isConnected && !walletOnSupported,
  };
}
