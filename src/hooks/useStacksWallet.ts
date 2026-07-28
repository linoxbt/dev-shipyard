// Unified Stacks wallet hook. Presents ONE interface to Stacks feature UIs
// regardless of whether the user signs with the in-app generated ("DevStation")
// wallet — a mnemonic-derived STX key that signs + broadcasts directly via
// @stacks/transactions — or an external wallet (Leather / Xverse / Hiro via
// @stacks/connect). The burner wins when unlocked; otherwise the connect
// session is used. Mirrors useSolanaWallet / useSuiWallet.

import { useCallback, useEffect } from "react";
import { create } from "zustand";
import {
  connect as stacksConnect,
  disconnect as stacksDisconnect,
  getLocalStorage,
  request,
} from "@stacks/connect";
import {
  makeContractDeploy,
  makeContractCall,
  broadcastTransaction,
  deserializeCV,
  type ClarityValue,
} from "@stacks/transactions";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import { useStacksPref } from "@/lib/stacks/active-stacks";
import { stacksChain, type StacksNetworkId } from "@/lib/stacks/chains";
import { useStacksBurner, getStacksPrivateKey } from "@/lib/stacks/burner/store";

/* eslint-disable @typescript-eslint/no-explicit-any */

function readStxAddress(): string | null {
  try {
    const data = getLocalStorage() as any;
    return data?.addresses?.stx?.[0]?.address ?? null;
  } catch {
    return null;
  }
}

interface StacksWalletStore {
  address: string | null;
  setAddress: (a: string | null) => void;
}
export const useStacksWalletStore = create<StacksWalletStore>((set) => ({
  address: null,
  setAddress: (address) => set({ address }),
}));

export interface DeployClarityParams {
  name: string;
  code: string;
  postConditionMode?: "deny" | "allow";
}

export interface CallContractParams {
  contract: string; // "address.name"
  functionName: string;
  /** Hex-encoded Clarity value arguments. */
  functionArgs: string[];
  postConditionMode?: "deny" | "allow";
}

export type StacksWalletSource = "burner" | "connect" | null;

export interface StacksWalletView {
  network: StacksNetworkId;
  networkName: "mainnet" | "testnet";
  address: string | null;
  connected: boolean;
  source: StacksWalletSource;
  connect: () => Promise<void>;
  disconnect: () => void;
  deployContract: (p: DeployClarityParams) => Promise<string>;
  callContract: (p: CallContractParams) => Promise<string>;
}

export function useStacksWallet(): StacksWalletView {
  const network = useStacksPref((s) => s.network);
  const chain = stacksChain(network);
  const stacksNet = chain.network === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;

  const connectAddress = useStacksWalletStore((s) => s.address);
  const setConnectAddress = useStacksWalletStore((s) => s.setAddress);

  const burnerUnlocked = useStacksBurner((s) => s.unlocked);
  const burnerAddress = useStacksBurner((s) =>
    chain.network === "mainnet" ? s.addressMainnet : s.addressTestnet,
  );

  // Restore a persisted @stacks/connect session on mount.
  useEffect(() => {
    const a = readStxAddress();
    if (a) setConnectAddress(a);
  }, [setConnectAddress]);

  const source: StacksWalletSource = burnerUnlocked ? "burner" : connectAddress ? "connect" : null;
  const address = source === "burner" ? burnerAddress : connectAddress;

  const connect = useCallback(async () => {
    await stacksConnect();
    setConnectAddress(readStxAddress());
  }, [setConnectAddress]);

  const disconnect = useCallback(() => {
    if (burnerUnlocked) useStacksBurner.getState().lock();
    try {
      stacksDisconnect();
    } catch {
      /* ignore */
    }
    setConnectAddress(null);
  }, [burnerUnlocked, setConnectAddress]);

  const deployContract = useCallback(
    async (p: DeployClarityParams): Promise<string> => {
      const key = getStacksPrivateKey();
      if (burnerUnlocked && key) {
        const tx = await makeContractDeploy({
          contractName: p.name,
          codeBody: p.code,
          senderKey: key,
          network: stacksNet,
          postConditionMode: p.postConditionMode ?? "deny",
        });
        const res = await broadcastTransaction({ transaction: tx, network: stacksNet });
        if ("error" in res) {
          throw new Error(`${res.error}${(res as any).reason ? ` — ${(res as any).reason}` : ""}`);
        }
        return res.txid;
      }
      if (!connectAddress) throw new Error("Connect or generate a Stacks wallet first.");
      const res = (await request("stx_deployContract", {
        name: p.name,
        clarityCode: p.code,
        network: chain.network,
        postConditionMode: p.postConditionMode ?? "deny",
      } as any)) as any;
      const txid: string | undefined = res?.txid ?? res?.txId ?? res?.result?.txid;
      if (!txid) throw new Error("Wallet did not return a transaction id.");
      return txid;
    },
    [burnerUnlocked, connectAddress, chain.network, stacksNet],
  );

  const callContract = useCallback(
    async (p: CallContractParams): Promise<string> => {
      const key = getStacksPrivateKey();
      const [contractAddress, contractName] = p.contract.split(".");
      if (burnerUnlocked && key) {
        const args: ClarityValue[] = p.functionArgs.map((hex) => deserializeCV(hex));
        const tx = await makeContractCall({
          contractAddress,
          contractName,
          functionName: p.functionName,
          functionArgs: args,
          senderKey: key,
          network: stacksNet,
          postConditionMode: p.postConditionMode ?? "deny",
        });
        const res = await broadcastTransaction({ transaction: tx, network: stacksNet });
        if ("error" in res) {
          throw new Error(`${res.error}${(res as any).reason ? ` — ${(res as any).reason}` : ""}`);
        }
        return res.txid;
      }
      if (!connectAddress) throw new Error("Connect or generate a Stacks wallet first.");
      const res = (await request("stx_callContract", {
        contract: p.contract,
        functionName: p.functionName,
        functionArgs: p.functionArgs,
        network: chain.network,
        postConditionMode: p.postConditionMode ?? "deny",
      } as any)) as any;
      const txid: string | undefined = res?.txid ?? res?.txId ?? res?.result?.txid;
      if (!txid) throw new Error("Wallet did not return a transaction id.");
      return txid;
    },
    [burnerUnlocked, connectAddress, chain.network, stacksNet],
  );

  return {
    network,
    networkName: chain.network,
    address,
    connected: !!address,
    source,
    connect,
    disconnect,
    deployContract,
    callContract,
  };
}
