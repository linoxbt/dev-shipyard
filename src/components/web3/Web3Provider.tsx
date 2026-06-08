import { useEffect, useRef, type ReactNode } from "react";
import { WagmiProvider, useAccount, useConnect } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { useBurner } from "@/lib/burner/store";
import { loadBurnerSession } from "@/lib/burner/session";

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
    if (!loadBurnerSession()) return;
    restoreSession();
    if (!isConnected) {
      const burner = connectors.find((c) => c.id === "devstation-burner");
      if (burner) connect({ connector: burner });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// Web3 provider. The app already owns a QueryClient (provided in __root.tsx);
// wagmi reuses that QueryClientProvider, so this only adds Wagmi. wagmiConfig
// has ssr:true so SSR/hydration is safe, persists to localStorage, and
// reconnectOnMount restores the last wallet after a refresh.
export function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <WalletAutoReconnect />
      {children}
    </WagmiProvider>
  );
}
