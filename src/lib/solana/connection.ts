// Solana RPC connection factory. Feature code (deploy, explorer, routebook)
// creates its own Connection from the active cluster's RPC URL rather than
// depending on wallet-adapter's ConnectionProvider, so reads work even before
// a wallet is connected and on paths that never mount the provider.

import { Connection, type Commitment } from "@solana/web3.js";
import { solanaChain, type SolanaCluster } from "./chains";

const CACHE = new Map<string, Connection>();

export function getConnection(cluster: SolanaCluster, commitment: Commitment = "confirmed") {
  const key = `${cluster}:${commitment}`;
  let conn = CACHE.get(key);
  if (!conn) {
    conn = new Connection(solanaChain(cluster).rpcUrl, commitment);
    CACHE.set(key, conn);
  }
  return conn;
}
