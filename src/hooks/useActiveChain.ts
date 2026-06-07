import { useAccount, useSwitchChain } from "wagmi";
import { useNetworkPref, chainById, qieTestnet, SUPPORTED_CHAINS } from "@/lib/active-chain";
import { chainConfig } from "@/lib/chains";

// Resolves the active QIE chain. The user's SELECTED network is authoritative
// for reads everywhere in the app — it is NOT overridden by the wallet's chain.
// When a wallet is connected on a different chain, `walletMismatch` is true and
// write/deploy flows surface a mismatch modal (reads still use the selected
// chain's RPC). `select(id)` records the preference and also asks the wallet to
// switch so the two stay in sync; rejecting the wallet switch just leaves a
// (non-blocking) mismatch.
export function useActiveChain() {
  const { isConnected, chainId: walletChainId } = useAccount();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const { preferredChainId, setPreferred } = useNetworkPref();

  const activeChainId = preferredChainId;
  const chain = chainById(activeChainId) ?? qieTestnet;
  const walletOnSupported = isConnected && SUPPORTED_CHAINS.some((c) => c.id === walletChainId);

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

  // Switch the connected wallet to the currently selected chain (used by the
  // mismatch modal). Returns the promise so callers can await + retry.
  const syncWallet = () => switchChainAsync({ chainId: activeChainId });

  return {
    chainId: activeChainId,
    chain,
    config: chainConfig(activeChainId),
    isTestnet: chain.testnet === true,
    supported: SUPPORTED_CHAINS,
    select,
    syncWallet,
    /** The wallet's current chain id (undefined when disconnected). */
    walletChainId,
    /** Wallet connected but on a different chain than the selected one. */
    walletMismatch: isConnected && walletChainId !== activeChainId,
    /** true when the wallet is connected but on an unsupported chain */
    walletOnWrongNetwork: isConnected && !walletOnSupported,
  };
}
