---
name: qie-deploy
description: Deploy and verify Solidity contracts on QIE Mainnet (chain 1990) or QIE Testnet (chain 1983) with Foundry or Hardhat, avoiding QIE's gas-estimate and MCOPY pitfalls.
---

# Deploy a contract to QIE

Use this skill whenever a Solidity contract has to go live on QIE Mainnet or QIE Testnet: a first deployment, a redeploy, or verifying a contract that is already deployed.

## QIE facts

Checked against the live network; use these rather than a web search, where older and unrelated chains carry similar names.

| | QIE Mainnet | QIE Testnet |
| --- | --- | --- |
| Chain ID | 1990 | 1983 |
| RPC | https://rpc1mainnet.qie.digital (rpc1 to rpc5) | https://rpc1testnet.qie.digital, or https://testnet.qie.digital/api/eth-rpc when that is down |
| Explorer (Blockscout) | https://mainnet.qie.digital | https://testnet.qie.digital |
| Explorer API | https://mainnet.qie.digital/api | https://testnet.qie.digital/api |
| Gas coin | QIE, 18 decimals | QIE, from https://qie.digital/faucet |

Chain ID 5656, listed in public registries as "QIE Blockchain", is a different chain. Never configure it for QIE.

## Two differences from Ethereum

1. **No MCOPY opcode.** Bytecode compiled for Cancun (Solidity ≥ 0.8.25's default) can fail on QIE. Always compile with `evm_version = "shanghai"` (Foundry) or `evmVersion: "shanghai"` (Hardhat).
2. **`eth_estimateGas` underestimates writes that touch storage.** A transaction sent with the estimate can run out of gas, and a mined, reverted transaction still costs its fee. Give deployments and storage writes an explicit gas limit, then check the receipt's `status`, not just that a hash came back.

## Steps

1. **Pick the network.** Deploy to QIE Testnet first unless the user explicitly asked for Mainnet. Confirm before any Mainnet deployment: it spends real QIE.
2. **Check the toolchain.** Use what the project already uses (`foundry.toml` means Foundry, `hardhat.config.*` means Hardhat). For a new project, prefer Foundry: `forge --version`.
3. **Configure the network and compiler.** Copy the matching file from this skill's folder:
   - `foundry.toml`: `evm_version = "shanghai"` and `rpc_endpoints` for `qie` and `qie_testnet`.
   - `hardhat.config.ts` (Hardhat 3): `evmVersion: "shanghai"` and the `qie` and `qieTestnet` networks.
4. **Keep the key out of files.** Read it from the environment (`QIE_PRIVATE_KEY`). Make sure `.env` is in `.gitignore`. Never print, log or commit a private key.
5. **Build and test.** `forge build && forge test`, or `npx hardhat test`. Fix failures before deploying.
6. **Fund the deployer.** On Testnet use the faucet. On Mainnet the wallet needs QIE: check it with `cast balance <address> --rpc-url qie --ether`.
7. **Deploy with an explicit gas limit.**
   - Foundry, one contract:
     ```
     forge create src/MyToken.sol:MyToken \
       --rpc-url qie_testnet --private-key $QIE_PRIVATE_KEY \
       --broadcast --gas-limit 3000000 \
       --constructor-args "My Token" MTK
     ```
     `--broadcast` is required: without it, current Foundry only simulates.
   - Foundry, a deploy script: `forge script script/Deploy.s.sol --rpc-url qie_testnet --private-key $QIE_PRIVATE_KEY --broadcast --slow`. A script sizes gas from its own local simulation, not from QIE's estimate.
   - Hardhat: deploy from a script and pass the limit yourself: `gas: 3_000_000n` with viem, `{ gasLimit: 3_000_000 }` with ethers.
8. **Confirm it worked.** The transaction's status must be 1, and the address must have code:
   ```
   cast receipt <txHash> status --rpc-url qie_testnet
   cast code <address> --rpc-url qie_testnet
   ```
   `0x` from `cast code` means nothing was deployed.
9. **Verify the source on the explorer.**
   ```
   forge verify-contract <address> src/MyToken.sol:MyToken \
     --chain 1983 \
     --verifier blockscout --verifier-url https://testnet.qie.digital/api/ \
     --constructor-args $(cast abi-encode "constructor(string,string)" "My Token" MTK) \
     --watch
   ```
   For Mainnet use `--chain 1990` and `https://mainnet.qie.digital/api/`. Hardhat projects can verify through the explorer's "Verify & Publish" page with the Standard JSON input from `artifacts/build-info`, or through DevStation's Deploy page, which verifies automatically.
10. **Report.** Give the user the address, the explorer link (`https://testnet.qie.digital/address/<address>` or the Mainnet equivalent), the transaction hash, and whether verification succeeded.

## Done means

- The receipt status is 1 and `cast code` returns bytecode.
- The contract page on the explorer shows the verified source, or you have said plainly why verification did not go through.
- No private key appears in any file, command history you wrote, or output.
