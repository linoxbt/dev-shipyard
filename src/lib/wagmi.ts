import { createConfig, createStorage, fallback, http } from "wagmi";
import { injected, metaMask } from "@wagmi/connectors";
import { SUPPORTED_CHAINS } from "./chains";
import { burnerConnector } from "./burner/connector";

// Every supported chain's wallet is a MetaMask-style EVM browser extension, so
// they are picked up by the injected() connector via EIP-6963 discovery: no
// special SDK required. We also register metaMask() and the in-app burner wallet.
//
// Connection state persists to localStorage (durable across refreshes/sessions
// until the cache is cleared); reconnectOnMount (in Web3Provider) restores it.
export const wagmiConfig = createConfig({
  chains: SUPPORTED_CHAINS,
  connectors: [injected(), metaMask(), burnerConnector()],
  storage: createStorage({
    key: "devstation-wagmi",
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  }),
  // Every RPC a chain lists, in order: when the first is down (QIE testnet's
  // rpc1 has been, for days at a time) calls move to the next instead of failing.
  transports: Object.fromEntries(
    SUPPORTED_CHAINS.map((c) => [c.id, fallback(c.rpcUrls.default.http.map((url) => http(url)))]),
  ),
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
