// A wagmi connector for the in-app generated burner wallet. It exposes the
// unlocked viem account through a minimal EIP-1193 provider so the rest of the
// app (deploys, writes, signing) treats it like any injected wallet.
//
// The account is held in module memory and only populated after the vault is
// unlocked (see ./vault and ./store). Locking clears it.

import { createConnector } from "wagmi";
import {
  createPublicClient,
  createWalletClient,
  http,
  numberToHex,
  type EIP1193Parameters,
  type Hex,
} from "viem";
import type { HDAccount } from "viem/accounts";
import { qieTestnet, qieMainnet, DEFAULT_CHAIN, SUPPORTED_CHAINS } from "../chains";
import { useNetworkPref } from "../active-chain";
import { confirmSign, consumePreapproval, describeRequest, userRejected } from "./confirm";

let activeAccount: HDAccount | null = null;
// Starts on the app's default network, not testnet: the selected network
// defaults to mainnet, and a burner restored onto testnet made every write
// start out on a different chain from the one the page was reading.
let activeChainId: number = DEFAULT_CHAIN.id;
const listeners = new Set<(account: HDAccount | null) => void>();

/** Set (or clear) the unlocked burner account and notify the connector. */
export function setBurnerAccount(account: HDAccount | null) {
  activeAccount = account;
  for (const fn of listeners) fn(account);
}

// Called when wagmi disconnects the burner: the store locks the wallet, so a
// "disconnected" in-app wallet is not one that can still sign.
let onDisconnectRequest: (() => void) | null = null;
export function onBurnerDisconnect(fn: () => void) {
  onDisconnectRequest = fn;
}

export function getBurnerAccount(): HDAccount | null {
  return activeAccount;
}

function chainById(id: number) {
  return SUPPORTED_CHAINS.find((c) => c.id === id) ?? qieTestnet;
}

// Minimal EIP-1193 provider: signing methods use a viem wallet client bound to
// the local account; everything else is forwarded to the chain's HTTP RPC.
function makeProvider() {
  function publicClient(chainId: number) {
    return createPublicClient({ chain: chainById(chainId), transport: http() });
  }

  /** Every method that signs needs the person's approval first, or a matching
   *  approval the preview bridge already obtained for this exact request. */
  async function approve(method: string, params: unknown) {
    if (!activeAccount) throw new Error("Wallet locked");
    if (consumePreapproval(method, params)) return;
    const req = describeRequest(method, params, chainById(activeChainId).name, "app");
    if (!req || !(await confirmSign(req))) throw userRejected();
  }

  async function request({ method, params }: EIP1193Parameters): Promise<unknown> {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return activeAccount ? [activeAccount.address] : [];
      case "eth_chainId":
        return numberToHex(activeChainId);
      case "wallet_switchEthereumChain": {
        const target = Number((params as [{ chainId: Hex }])[0].chainId);
        if (!SUPPORTED_CHAINS.some((c) => c.id === target)) {
          throw new Error(`Unsupported chain ${target}`);
        }
        activeChainId = target;
        return null;
      }
      case "eth_sendTransaction": {
        await approve(method, params);
        if (!activeAccount) throw new Error("Wallet locked");
        const wallet = createWalletClient({
          account: activeAccount,
          chain: chainById(activeChainId),
          transport: http(),
        });
        const tx = (params as [Record<string, unknown>])[0];
        return wallet.sendTransaction(tx as never);
      }
      case "personal_sign": {
        await approve(method, params);
        if (!activeAccount) throw new Error("Wallet locked");
        const [message] = params as [Hex, string];
        return activeAccount.signMessage({ message: { raw: message } });
      }
      case "eth_signTypedData_v4": {
        await approve(method, params);
        if (!activeAccount) throw new Error("Wallet locked");
        const [, json] = params as [string, string];
        return activeAccount.signTypedData(JSON.parse(json));
      }
      case "eth_sign":
      case "eth_signTransaction":
      case "eth_signTypedData":
      case "eth_signTypedData_v3":
        // Raw-hash and legacy signing: nothing in DevStation uses them, and
        // forwarding them to the node would only produce a confusing error.
        throw new Error(`${method} is not supported by the DevStation wallet.`);
      default:
        // Read-only RPC methods → forward to the node.
        return publicClient(activeChainId).request({ method, params } as never);
    }
  }

  return { request };
}

const provider = makeProvider();

export function burnerConnector() {
  return createConnector((config) => ({
    id: "devstation-burner",
    name: "DevStation Wallet",
    type: "burner",
    async setup() {
      listeners.add((account) => {
        if (account) {
          config.emitter.emit("change", {
            accounts: [account.address],
            chainId: activeChainId,
          });
        } else {
          config.emitter.emit("disconnect");
        }
      });
    },
    async connect({ chainId } = {}) {
      if (!activeAccount) throw new Error("No burner wallet unlocked");
      // Connect on the network the person has selected unless told otherwise.
      activeChainId = chainId ?? useNetworkPref.getState().preferredChainId ?? activeChainId;
      // `accounts` cast: wagmi's connect return is generic over `withCapabilities`,
      // which a concrete value can't satisfy. The runtime shape is correct.
      return { accounts: [activeAccount.address] as never, chainId: activeChainId };
    },
    async disconnect() {
      // Account lifetime is owned by the vault store; ask it to lock.
      if (onDisconnectRequest) onDisconnectRequest();
      else setBurnerAccount(null);
    },
    async getAccounts() {
      return activeAccount ? [activeAccount.address] : [];
    },
    async getChainId() {
      return activeChainId;
    },
    async getProvider() {
      return provider;
    },
    async isAuthorized() {
      return !!activeAccount;
    },
    async switchChain({ chainId }) {
      activeChainId = chainId;
      const chain = chainById(chainId);
      config.emitter.emit("change", { chainId });
      return chain;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }));
}

export { qieTestnet, qieMainnet };
