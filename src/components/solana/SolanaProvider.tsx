// Solana wallet-adapter provider (Phantom / Solflare). Mounts alongside the EVM
// WagmiProvider without touching it — see src/components/web3/Web3Provider.tsx,
// which nests <SolanaProvider> around its children.
//
// SSR note: the app uses TanStack Start (SSR). We ALWAYS render the provider
// tree so useWallet()/useConnection() have a context (calling them outside a
// WalletProvider throws), but only construct the wallet *adapters* on the
// client — adapter constructors touch browser globals. During SSR / first
// render the wallet list is empty, which is SSR-safe. Reads never depend on
// ConnectionProvider anyway (feature code uses getConnection()).

import "@/lib/solana/buffer-polyfill";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
// Import the specific adapters (NOT the @solana/wallet-adapter-wallets barrel):
// the barrel pulls in the Ledger adapter → @ledgerhq/errors, whose broken ESM
// export crashes SSR for the whole app. Phantom/Solflare have no such dep.
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { useSolanaPref } from "@/lib/solana/active-solana";
import { solanaChain } from "@/lib/solana/chains";
import { useSolanaBurner } from "@/lib/solana/burner/store";
import {
  loadSolanaSession,
  touchSolanaSession,
  isSolanaSessionIdle,
} from "@/lib/solana/burner/session";
// NOTE: intentionally NOT importing "@solana/wallet-adapter-react-ui/styles.css"
// — its first line is a remote `@import url('https://fonts.googleapis.com/...')`
// that esbuild's SSR CSS transform rejects, crashing SSR. The wallet modal still
// functions unstyled, and the primary in-app burner UI (SolanaWalletPanel) is
// self-styled with the app's own Tailwind tokens.

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "wheel"] as const;
const IDLE_CHECK_INTERVAL_MS = 30_000;

// Restores the burner from its session after a refresh and auto-locks it after
// idle — the Solana analog of the EVM BurnerIdleLock in Web3Provider.tsx.
function SolanaBurnerLifecycle() {
  const restoreSession = useSolanaBurner((s) => s.restoreSession);
  const unlocked = useSolanaBurner((s) => s.unlocked);
  const lock = useSolanaBurner((s) => s.lock);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (loadSolanaSession()) restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (!unlocked) return;
    const onActivity = () => touchSolanaSession();
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true });
    const interval = setInterval(() => {
      if (isSolanaSessionIdle()) lock();
    }, IDLE_CHECK_INTERVAL_MS);
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
      clearInterval(interval);
    };
  }, [unlocked, lock]);

  return null;
}

export function SolanaProvider({ children }: { children: ReactNode }) {
  const cluster = useSolanaPref((s) => s.cluster);
  const endpoint = solanaChain(cluster).rpcUrl;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const wallets = useMemo(
    () => (mounted ? [new PhantomWalletAdapter(), new SolflareWalletAdapter()] : []),
    [mounted],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <SolanaBurnerLifecycle />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
