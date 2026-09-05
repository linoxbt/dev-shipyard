import { useEffect, useRef, type ReactNode } from "react";
import { WagmiProvider, useAccount, useConnect } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { useBurner } from "@/lib/burner/store";
import { useNetworkPref } from "@/lib/active-chain";
import { hasBurnerSession, touchBurnerSession, isBurnerSessionIdle } from "@/lib/burner/session";

// Auto-locks the burner wallet after the configured unlock window of no
// tracked activity (see UNLOCK_OPTIONS in burner/session.ts) -
// see session.ts's header comment for why this exists (the decrypted
// mnemonic otherwise sits in sessionStorage indefinitely for as long as the
// tab is open). Runs only while the burner is actually unlocked.
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "wheel"] as const;
const IDLE_CHECK_INTERVAL_MS = 30_000;

function BurnerIdleLock() {
  const unlocked = useBurner((s) => s.unlocked);
  const lock = useBurner((s) => s.lock);

  useEffect(() => {
    if (!unlocked) return;
    const onActivity = () => touchBurnerSession();
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") touchBurnerSession();
    };
    document.addEventListener("visibilitychange", onVisible);

    const interval = setInterval(() => {
      if (isBurnerSessionIdle()) lock();
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [unlocked, lock]);

  return null;
}

// On mount, restore the in-app generated (burner) wallet from its session so it
// survives refreshes. Injected wallets (QIE Wallet / MetaMask) are restored by
// wagmi's own reconnectOnMount + localStorage persistence.
function WalletAutoReconnect() {
  const restoreSession = useBurner((s) => s.restoreSession);
  const { connect, connectors } = useConnect();
  const { isConnected } = useAccount();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // hasBurnerSession is the cheap synchronous check; restoring actually
    // decrypts, so the connect MUST wait for it. Connecting first would reach a
    // connector with no account and throw "No burner wallet unlocked", which
    // is what made a refresh ask for the password again.
    // Promote the vault's real presence/address now that localStorage is
    // readable. Kept before the session restore so the UI never shows "no
    // wallet" for a frame when one exists.
    useBurner.getState().refresh();
    if (!hasBurnerSession()) return;
    void (async () => {
      await restoreSession();
      if (isConnected) return;
      const burner = connectors.find((c) => c.id === "devstation-burner");
      if (burner) connect({ connector: burner });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// Web3 provider. The app already owns a QueryClient (provided in __root.tsx);
// wagmi reuses that QueryClientProvider, so this only adds Wagmi. wagmiConfig
// has ssr:true so SSR/hydration is safe, persists to localStorage, and
// reconnectOnMount restores the last wallet after a refresh.
// Applies the persisted network preference once, after mount. The store
// deliberately starts on DEFAULT_CHAIN so SSR and the first client render
// agree; this is what promotes it to the user's actual saved chain.
function NetworkPrefHydrator() {
  const hydrate = useNetworkPref((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return null;
}

export function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <NetworkPrefHydrator />
      <WalletAutoReconnect />
      <BurnerIdleLock />
      {children}
    </WagmiProvider>
  );
}
