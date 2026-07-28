// UI-facing state for the in-app generated Solana ("burner") wallet — the
// Solana analog of src/lib/burner/store.ts. Holds lock status + the base58
// address; the secret key lives in the module-level `activeKeypair` after
// unlock (read by the deploy layer to sign), never in the store.

import { create } from "zustand";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import {
  clearVault,
  createKeypairWithMnemonic,
  hasVault,
  keypairFromSecretB64,
  loadVault,
  saveVault,
  secretKeyToB64,
  unlockVault,
} from "./vault";
import { clearSolanaSession, loadSolanaSession, saveSolanaSession } from "./session";

// The active keypair. Kept out of the zustand store so React devtools / state
// snapshots never surface the secret key.
let activeKeypair: Keypair | null = null;

/** The unlocked burner keypair, or null. Used by the deploy layer to sign. */
export function getBurnerKeypair(): Keypair | null {
  return activeKeypair;
}

interface SolanaBurnerState {
  exists: boolean;
  unlocked: boolean;
  address: string | null;
  /** Create + persist a new wallet under a password; returns the 24-word seed phrase ONCE for backup. */
  createWallet: (password: string) => Promise<string>;
  /** Import an existing base58 secret key and persist it under a password. */
  importWallet: (secretBase58: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  remove: () => void;
  /** Reveal the base58 secret key (requires the password again). */
  revealSecret: (password: string) => Promise<string>;
  refresh: () => void;
  /** Restore an unlocked session (sessionStorage) after a page refresh. */
  restoreSession: () => void;
}

function activate(kp: Keypair) {
  activeKeypair = kp;
}

export const useSolanaBurner = create<SolanaBurnerState>((set) => ({
  exists: typeof window !== "undefined" && hasVault(),
  unlocked: false,
  address: typeof window !== "undefined" ? (loadVault()?.address ?? null) : null,

  createWallet: async (password) => {
    const { keypair: kp, mnemonic } = createKeypairWithMnemonic();
    await saveVault(kp, password);
    activate(kp);
    saveSolanaSession(secretKeyToB64(kp));
    set({ exists: true, unlocked: true, address: kp.publicKey.toBase58() });
    return mnemonic;
  },

  importWallet: async (secretBase58, password) => {
    const kp = Keypair.fromSecretKey(bs58.decode(secretBase58.trim()));
    await saveVault(kp, password);
    activate(kp);
    saveSolanaSession(secretKeyToB64(kp));
    set({ exists: true, unlocked: true, address: kp.publicKey.toBase58() });
  },

  unlock: async (password) => {
    const kp = await unlockVault(password);
    activate(kp);
    saveSolanaSession(secretKeyToB64(kp));
    set({ unlocked: true, address: kp.publicKey.toBase58() });
  },

  lock: () => {
    activeKeypair = null;
    clearSolanaSession();
    set({ unlocked: false });
  },

  remove: () => {
    activeKeypair = null;
    clearSolanaSession();
    clearVault();
    set({ exists: false, unlocked: false, address: null });
  },

  revealSecret: async (password) => {
    const kp = await unlockVault(password);
    return bs58.encode(kp.secretKey);
  },

  refresh: () => {
    const v = loadVault();
    set({ exists: !!v, address: v?.address ?? null });
  },

  // Re-activate the burner from a persisted session (survives refresh, not
  // browser close). No password needed — the secret key is in sessionStorage.
  restoreSession: () => {
    const secretB64 = loadSolanaSession();
    if (!secretB64) return;
    try {
      const kp = keypairFromSecretB64(secretB64);
      activate(kp);
      set({ exists: true, unlocked: true, address: kp.publicKey.toBase58() });
    } catch {
      clearSolanaSession();
    }
  },
}));
