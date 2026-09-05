// UI-facing state for the in-app generated wallet. Holds only lock status and
// the public address; the mnemonic/private key never enter this store: they
// live transiently in the connector module after unlock.
import { create } from "zustand";
import type { HDAccount } from "viem/accounts";
import {
  accountFromMnemonic,
  clearVault,
  createMnemonic,
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
  /** Restore an unlocked session after a refresh or a browser restart.
   *  Async because the mnemonic is decrypted with a device key from IndexedDB. */
  restoreSession: () => Promise<void>;
}
function activate(account: HDAccount) {
  setBurnerAccount(account);
}
export const useBurner = create<BurnerState>((set) => ({
  // Deliberately storage-free: reading localStorage here makes the server
  // render "no wallet" and the first client render "wallet 0x…", which React
  // reports as a hydration mismatch and then throws the tree away. Web3Provider
  // calls refresh() on mount to promote these to the real values, the same
  // pattern the network preference already uses.
  exists: false,
  unlocked: false,
  address: null,
  createWallet: async (password) => {
    const { mnemonic, account } = createMnemonic();
    await saveVault(mnemonic, password);
    activate(account);
    await saveBurnerSession(mnemonic);
    set({ exists: true, unlocked: true, address: account.address });
    return mnemonic;
  },
  importWallet: async (mnemonic, password) => {
    await saveVault(mnemonic, password);
    const { account } = await unlockVault(password);
    activate(account);
    await saveBurnerSession(mnemonic.trim());
    set({ exists: true, unlocked: true, address: account.address });
  },
  unlock: async (password) => {
    const { mnemonic, account } = await unlockVault(password);
    activate(account);
    await saveBurnerSession(mnemonic);
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
  // Re-activate the burner from a persisted session. Survives a refresh AND a
  // browser restart, for as long as the configured unlock window: the mnemonic
  // is decrypted with a non-extractable device key, so no password is needed.
  restoreSession: async () => {
    const mnemonic = await loadBurnerSession();
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
