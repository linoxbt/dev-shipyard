// Hardhat 3 settings for QIE. Merge the solidity and networks sections into
// your project's hardhat.config.ts, keeping its plugins.
//
// Set the key once, without putting it in a file:
//   npx hardhat keystore set QIE_PRIVATE_KEY

import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  solidity: {
    version: "0.8.28",
    settings: {
      // QIE's EVM has no MCOPY, so compile for Shanghai rather than Cancun.
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    qie: {
      type: "http",
      chainType: "l1",
      url: "https://rpc1mainnet.qie.digital",
      chainId: 1990,
      accounts: [configVariable("QIE_PRIVATE_KEY")],
    },
    qieTestnet: {
      type: "http",
      chainType: "l1",
      url: "https://rpc1testnet.qie.digital",
      chainId: 1983,
      accounts: [configVariable("QIE_PRIVATE_KEY")],
    },
  },
});
