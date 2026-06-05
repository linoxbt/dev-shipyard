import { type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

// Web3 provider. The app already owns a QueryClient (provided in __root.tsx);
// wagmi reuses that QueryClientProvider, so this only adds Wagmi. wagmiConfig
// has ssr:true so SSR/hydration is safe. Wallet connection uses QIE Wallet /
// MetaMask (injected) — no third-party modal library.
export function Web3Provider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}
