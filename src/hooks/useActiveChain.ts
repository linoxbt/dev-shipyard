import { useAccount, useSwitchChain } from "wagmi";
import { toast } from "sonner";
import { useNetworkPref, chainById, SUPPORTED_CHAINS } from "@/lib/active-chain";
import { chainConfig, DEFAULT_CHAIN } from "@/lib/chains";

// Resolves the active QIE chain. The user's SELECTED network is authoritative
// for reads everywhere in the app: it is NOT overridden by the wallet's chain.
// When a wallet is connected on a different chain, `walletMismatch` is true and
// write/deploy flows surface a mismatch modal (reads still use the selected
// chain's RPC). `select(id)` records the preference and also asks the wallet to
// switch so the two stay in sync; rejecting the wallet switch just leaves a
// (non-blocking) mismatch.
/** The chain ids wagmi's config knows; preferences are stored as plain numbers. */
type SupportedChainId = (typeof SUPPORTED_CHAINS)[number]["id"];

export function useActiveChain() {
  const { isConnected, chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { preferredChainId, setPreferred } = useNetworkPref();

  const activeChainId = preferredChainId;
  const chain = chainById(activeChainId) ?? DEFAULT_CHAIN;
  const walletOnSupported = isConnected && SUPPORTED_CHAINS.some((c) => c.id === walletChainId);

  const select = (chainId: number) => {
    setPreferred(chainId);
    if (isConnected) {
      // Reads already follow the preference; the wallet switch only matters for
      // writes, so a rejection is reported rather than swallowed, and the
      // mismatch modal picks it up again before any transaction.
      switchChainAsync({ chainId: chainId as SupportedChainId }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast.warning("Your wallet stayed on its current network", {
          description: /reject|denied/i.test(msg)
            ? "You declined the switch. Switch in your wallet before sending a transaction."
            : msg.slice(0, 160),
        });
      });
    }
  };

  // Switch the connected wallet to the currently selected chain (used by the
  // mismatch modal). Returns the promise so callers can await + retry.
  const syncWallet = () => switchChainAsync({ chainId: activeChainId as SupportedChainId });

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
