// Session persistence for the in-app generated ("burner") wallet.
//
// The decrypted mnemonic is kept in sessionStorage while unlocked so the wallet
// survives page refreshes WITHOUT re-entering the password — but is dropped when
// the tab/browser closes (sessionStorage semantics) or the cache is cleared.
// This matches "stay connected across refresh, disconnect on browser close".
// The encrypted vault in localStorage remains the durable, at-rest store.

const SESSION_KEY = "devstation-burner-session-v1";

export function saveBurnerSession(mnemonic: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_KEY, mnemonic);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export function loadBurnerSession(): string | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
  } catch {
    return null;
  }
}

export function clearBurnerSession(): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
