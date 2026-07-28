// Unified Solana wallet hook. Presents ONE interface to feature UIs regardless
// of whether the user signs with the in-app burner keypair or an external
// wallet-adapter wallet (Phantom / Solflare). Mirrors the role src/lib/wallet.ts
// plays for the EVM side, but for Solana.
//
// Signing precedence: a connected external adapter wins; otherwise the unlocked
// burner is used. Reads (balance/airdrop/send) go through getConnection() for
// the active cluster.

import { useCallback } from "react";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  type Keypair,
} from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSolanaPref } from "@/lib/solana/active-solana";
import { solanaChain, type SolanaCluster } from "@/lib/solana/chains";
import { getConnection } from "@/lib/solana/connection";
import { useSolanaBurner, getBurnerKeypair } from "@/lib/solana/burner/store";

export type SolanaWalletSource = "adapter" | "burner" | null;

export interface SolanaWalletView {
  cluster: SolanaCluster;
  connection: Connection;
  source: SolanaWalletSource;
  connected: boolean;
  publicKey: PublicKey | null;
  address: string | null;
  /** Open the wallet-adapter modal to connect an external wallet. */
  openWalletModal: () => void;
  disconnectAdapter: () => void;
  /** Sign + send a transaction with whichever wallet is active. Returns the signature. */
  signAndSend: (tx: Transaction, extraSigners?: Keypair[]) => Promise<string>;
  /** Sign (not send) — used to build an Anchor provider for program interaction. */
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
  /** Request an airdrop of test SOL (devnet only). Returns the tx signature. */
  airdrop: (sol?: number) => Promise<string>;
  getBalanceSol: () => Promise<number>;
}

export function useSolanaWallet(): SolanaWalletView {
  const cluster = useSolanaPref((s) => s.cluster);
  const connection = getConnection(cluster);

  const adapter = useWallet();
  const { setVisible } = useWalletModal();

  const burnerUnlocked = useSolanaBurner((s) => s.unlocked);
  const burnerAddress = useSolanaBurner((s) => s.address);

  const adapterConnected = adapter.connected && !!adapter.publicKey;
  const source: SolanaWalletSource = adapterConnected
    ? "adapter"
    : burnerUnlocked
      ? "burner"
      : null;

  const publicKey: PublicKey | null = adapterConnected
    ? adapter.publicKey
    : burnerUnlocked && burnerAddress
      ? new PublicKey(burnerAddress)
      : null;

  const signAndSend = useCallback(
    async (tx: Transaction, extraSigners: Keypair[] = []): Promise<string> => {
      const payer = adapterConnected ? adapter.publicKey : publicKey;
      if (!payer) throw new Error("No Solana wallet connected");

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer;

      let signature: string;
      if (adapterConnected) {
        // The adapter signs as fee payer; any extra signers (e.g. a new mint
        // keypair) are passed through.
        signature = await adapter.sendTransaction(tx, connection, { signers: extraSigners });
      } else {
        const kp = getBurnerKeypair();
        if (!kp) throw new Error("Burner wallet is locked");
        if (extraSigners.length) tx.partialSign(...extraSigners);
        tx.partialSign(kp);
        signature = await connection.sendRawTransaction(tx.serialize());
      }
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      return signature;
    },
    [adapter, adapterConnected, connection, publicKey],
  );

  const signTransaction = useCallback(
    async (tx: Transaction): Promise<Transaction> => {
      if (adapterConnected) {
        if (!adapter.signTransaction) throw new Error("This wallet cannot sign transactions.");
        return adapter.signTransaction(tx);
      }
      const kp = getBurnerKeypair();
      if (!kp) throw new Error("Burner wallet is locked");
      tx.partialSign(kp);
      return tx;
    },
    [adapter, adapterConnected],
  );

  const signAllTransactions = useCallback(
    async (txs: Transaction[]): Promise<Transaction[]> => {
      if (adapterConnected) {
        if (adapter.signAllTransactions) return adapter.signAllTransactions(txs);
        const out: Transaction[] = [];
        for (const t of txs) out.push(await signTransaction(t));
        return out;
      }
      const kp = getBurnerKeypair();
      if (!kp) throw new Error("Burner wallet is locked");
      txs.forEach((t) => t.partialSign(kp));
      return txs;
    },
    [adapter, adapterConnected, signTransaction],
  );

  const airdrop = useCallback(
    async (sol = 1): Promise<string> => {
      if (solanaChain(cluster).cluster !== "devnet") {
        throw new Error("Airdrops are only available on devnet.");
      }
      if (!publicKey) throw new Error("Connect or unlock a Solana wallet first");
      const sig = await connection.requestAirdrop(publicKey, sol * LAMPORTS_PER_SOL);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
      return sig;
    },
    [cluster, connection, publicKey],
  );

  const getBalanceSol = useCallback(async (): Promise<number> => {
    if (!publicKey) return 0;
    const lamports = await connection.getBalance(publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }, [connection, publicKey]);

  return {
    cluster,
    connection,
    source,
    connected: source !== null,
    publicKey,
    address: publicKey ? publicKey.toBase58() : null,
    openWalletModal: () => setVisible(true),
    disconnectAdapter: () => void adapter.disconnect(),
    signAndSend,
    signTransaction,
    signAllTransactions,
    airdrop,
    getBalanceSol,
  };
}
