// Session persistence for the in-app generated Stacks ("DevStation") wallet. The
// decrypted mnemonic is kept in sessionStorage while unlocked so the wallet
// survives refreshes without re-entering the password, and is dropped on
// tab/browser close. Mirrors src/lib/sui/burner/session.ts.

const SESSION_KEY = "devstation-stacks-wallet-session-v1";
const ACTIVITY_KEY = "devstation-stacks-wallet-activity-v1";
export const IDLE_LOCK_MS = 20 * 60 * 1000; // 20 minutes

export function saveStacksSession(mnemonic: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(SESSION_KEY, mnemonic);
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export function touchStacksSession(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (!sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function isStacksSessionIdle(): boolean {
  try {
    if (typeof sessionStorage === "undefined") return false;
    if (!sessionStorage.getItem(SESSION_KEY)) return false;
    const touchedAt = Number(sessionStorage.getItem(ACTIVITY_KEY) ?? 0);
    return !touchedAt || Date.now() - touchedAt > IDLE_LOCK_MS;
  } catch {
    return false;
  }
}

export function loadStacksSession(): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const mnemonic = sessionStorage.getItem(SESSION_KEY);
    if (!mnemonic) return null;
    if (isStacksSessionIdle()) {
      clearStacksSession();
      return null;
    }
    return mnemonic;
  } catch {
    return null;
  }
}

export function clearStacksSession(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(ACTIVITY_KEY);
  } catch {
    /* ignore */
  }
}
