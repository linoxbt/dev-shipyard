// UI-facing state for the in-app generated Stacks ("DevStation") wallet. Holds
// lock status + both-network addresses; the STX private key lives in a
// module-level variable after unlock (read by the deploy/call layer to sign),
// never in the store. Mirrors src/lib/sui/burner/store.ts.

import { create } from "zustand";
import {
  clearVault,
  createMnemonic,
  hasVault,
  keyInfoFromMnemonic,
  loadVault,
  saveVault,
  unlockMnemonic,
} from "./vault";
import { clearStacksSession, loadStacksSession, saveStacksSession } from "./session";

let activeStxKey: string | null = null;

/** The unlocked STX private key, or null. Used by the sign/deploy layer. */
export function getStacksPrivateKey(): string | null {
  return activeStxKey;
}

interface StacksBurnerState {
  exists: boolean;
  unlocked: boolean;
  addressTestnet: string | null;
  addressMainnet: string | null;
  /** Create + persist a new wallet under a password; returns the 24-word mnemonic ONCE for backup. */
  createWallet: (password: string) => Promise<string>;
  /** Import an existing BIP-39 mnemonic and persist it under a password. */
  importWallet: (mnemonic: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  remove: () => void;
  /** Reveal the mnemonic (requires the password again). */
  revealMnemonic: (password: string) => Promise<string>;
  refresh: () => void;
  restoreSession: () => Promise<void>;
}

export const useStacksBurner = create<StacksBurnerState>((set) => ({
  exists: typeof window !== "undefined" && hasVault(),
  unlocked: false,
  addressTestnet: typeof window !== "undefined" ? (loadVault()?.addressTestnet ?? null) : null,
  addressMainnet: typeof window !== "undefined" ? (loadVault()?.addressMainnet ?? null) : null,

  createWallet: async (password) => {
    const mnemonic = createMnemonic();
    await saveVault(mnemonic, password);
    const info = await keyInfoFromMnemonic(mnemonic);
    activeStxKey = info.stxPrivateKey;
    saveStacksSession(mnemonic);
    set({ exists: true, unlocked: true, addressTestnet: info.addressTestnet, addressMainnet: info.addressMainnet });
    return mnemonic;
  },

  importWallet: async (mnemonic, password) => {
    const clean = mnemonic.trim();
    await saveVault(clean, password);
    const info = await keyInfoFromMnemonic(clean);
    activeStxKey = info.stxPrivateKey;
    saveStacksSession(clean);
    set({ exists: true, unlocked: true, addressTestnet: info.addressTestnet, addressMainnet: info.addressMainnet });
  },

  unlock: async (password) => {
    const mnemonic = await unlockMnemonic(password);
    const info = await keyInfoFromMnemonic(mnemonic);
    activeStxKey = info.stxPrivateKey;
    saveStacksSession(mnemonic);
    set({ unlocked: true, addressTestnet: info.addressTestnet, addressMainnet: info.addressMainnet });
  },

  lock: () => {
    activeStxKey = null;
    clearStacksSession();
    set({ unlocked: false });
  },

  remove: () => {
    activeStxKey = null;
    clearStacksSession();
    clearVault();
    set({ exists: false, unlocked: false, addressTestnet: null, addressMainnet: null });
  },

  revealMnemonic: async (password) => unlockMnemonic(password),

  refresh: () => {
    const v = loadVault();
    set({ exists: !!v, addressTestnet: v?.addressTestnet ?? null, addressMainnet: v?.addressMainnet ?? null });
  },

  restoreSession: async () => {
    const mnemonic = loadStacksSession();
    if (!mnemonic) return;
    try {
      const info = await keyInfoFromMnemonic(mnemonic);
      activeStxKey = info.stxPrivateKey;
      set({ exists: true, unlocked: true, addressTestnet: info.addressTestnet, addressMainnet: info.addressMainnet });
    } catch {
      clearStacksSession();
    }
  },
}));
