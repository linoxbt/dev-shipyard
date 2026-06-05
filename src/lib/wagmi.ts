import { createConfig, http } from "wagmi";
import { injected, metaMask } from "@wagmi/connectors";
import { qieTestnet, qieMainnet } from "./chains";
import { burnerConnector } from "./burner/connector";

// QIE Wallet is a MetaMask-style EVM browser extension (docs.qie.digital), so it
// is picked up by the injected() connector via EIP-6963 discovery — no special
// SDK required. We also register metaMask() and the in-app burner wallet.
export const wagmiConfig = createConfig({
  chains: [qieTestnet, qieMainnet],
  connectors: [injected(), metaMask(), burnerConnector()],
  transports: {
    [qieTestnet.id]: http(),
    [qieMainnet.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
