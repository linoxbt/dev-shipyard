// Session persistence for the in-app generated ("burner") wallet.
//
// The decrypted mnemonic is kept in sessionStorage while unlocked so the wallet
// survives page refreshes WITHOUT re-entering the password — but is dropped when
// the tab/browser closes (sessionStorage semantics) or the cache is cleared.
// This matches "stay connected across refresh, disconnect on browser close".
// The encrypted vault in localStorage remains the durable, at-rest store.
//
// Idle auto-lock: sessionStorage has no built-in expiry, so once unlocked the
// plaintext mnemonic would otherwise sit there for as long as the tab stays
// open — readable by any XSS with no further password prompt. An activity
// timestamp caps that exposure window: the session is treated as expired
// (and cleared) once IDLE_LOCK_MS elapses with no tracked user activity,
// same idea as a wallet extension's auto-lock timer. See
// src/components/web3/Web3Provider.tsx for the watcher that calls
// touchBurnerSession() on activity and lock()s the store when idle.

const SESSION_KEY = "devstation-burner-session-v1";
const ACTIVITY_KEY = "devstation-burner-activity-v1";
export const IDLE_LOCK_MS = 20 * 60 * 1000; // 20 minutes

export function saveBurnerSession(mnemonic: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(SESSION_KEY, mnemonic);
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** Bumps the idle clock. Cheap no-op if there's no active session to keep alive. */
export function touchBurnerSession(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (!sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** True once the session has gone longer than IDLE_LOCK_MS without a touch. Doesn't clear anything. */
export function isBurnerSessionIdle(): boolean {
  try {
    if (typeof sessionStorage === "undefined") return false;
    if (!sessionStorage.getItem(SESSION_KEY)) return false;
    const touchedAt = Number(sessionStorage.getItem(ACTIVITY_KEY) ?? 0);
    return !touchedAt || Date.now() - touchedAt > IDLE_LOCK_MS;
  } catch {
    return false;
  }
}

// Returns the stored mnemonic, or null (and clears the session) if it's
// missing or has been idle longer than IDLE_LOCK_MS.
export function loadBurnerSession(): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const mnemonic = sessionStorage.getItem(SESSION_KEY);
    if (!mnemonic) return null;
    if (isBurnerSessionIdle()) {
      clearBurnerSession();
      return null;
    }
    return mnemonic;
  } catch {
    return null;
  }
}

export function clearBurnerSession(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(ACTIVITY_KEY);
  } catch {
    /* ignore */
  }
}
