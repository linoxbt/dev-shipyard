// UI-facing state for the in-app generated wallet. Holds only lock status and
// the public address; the mnemonic/private key never enter this store — they
// live transiently in the connector module after unlock.
import { create } from "zustand";
import type { HDAccount } from "viem/accounts";
import {
  accountFromMnemonic,
  clearVault,
  createMnemonic,
  hasVault,
  loadVault,
  saveVault,
  unlockVault,
} from "./vault";
import { setBurnerAccount } from "./connector";
import { clearBurnerSession, loadBurnerSession, saveBurnerSession } from "./session";

interface BurnerState {
  exists: boolean;
  unlocked: boolean;
  address: `0x${string}` | null;
  /** Create + persist a new wallet, returning the mnemonic ONCE for backup. */
  createWallet: (password: string) => Promise<string>;
  /** Import an existing mnemonic and persist it under a password. */
  importWallet: (mnemonic: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  remove: () => void;
  /** Reveal the decrypted seed phrase (requires the password again). */
  revealMnemonic: (password: string) => Promise<string>;
  refresh: () => void;
  /** Restore an unlocked session (sessionStorage) after a page refresh. */
  restoreSession: () => void;
}

function activate(account: HDAccount) {
  setBurnerAccount(account);
}

export const useBurner = create<BurnerState>((set) => ({
  exists: typeof window !== "undefined" && hasVault(),
  unlocked: false,
  address: typeof window !== "undefined" ? (loadVault()?.address ?? null) : null,

  createWallet: async (password) => {
    const { mnemonic, account } = createMnemonic();
    await saveVault(mnemonic, password);
    activate(account);
    saveBurnerSession(mnemonic);
    set({ exists: true, unlocked: true, address: account.address });
    return mnemonic;
  },

  importWallet: async (mnemonic, password) => {
    await saveVault(mnemonic, password);
    const { account } = await unlockVault(password);
    activate(account);
    saveBurnerSession(mnemonic.trim());
    set({ exists: true, unlocked: true, address: account.address });
  },

  unlock: async (password) => {
    const { mnemonic, account } = await unlockVault(password);
    activate(account);
    saveBurnerSession(mnemonic);
    set({ unlocked: true, address: account.address });
  },

  lock: () => {
    setBurnerAccount(null);
    clearBurnerSession();
    set({ unlocked: false });
  },

  remove: () => {
    setBurnerAccount(null);
    clearBurnerSession();
    clearVault();
    set({ exists: false, unlocked: false, address: null });
  },

  revealMnemonic: async (password) => {
    const { mnemonic } = await unlockVault(password);
    return mnemonic;
  },

  refresh: () => {
    const v = loadVault();
    set({ exists: !!v, address: v?.address ?? null });
  },

  // Re-activate the burner from a persisted session (survives refresh, not
  // browser close). No password needed — the mnemonic is in sessionStorage.
  restoreSession: () => {
    const mnemonic = loadBurnerSession();
    if (!mnemonic) return;
    try {
      const account = accountFromMnemonic(mnemonic);
      activate(account);
      set({ exists: true, unlocked: true, address: account.address });
    } catch {
      clearBurnerSession();
    }
  },
}));
