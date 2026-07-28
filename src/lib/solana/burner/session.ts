// Session persistence for the in-app generated Solana ("burner") wallet — the
// Solana analog of src/lib/burner/session.ts. The decrypted secret key (base64)
// is kept in sessionStorage while unlocked so the wallet survives refreshes
// without re-entering the password, and is dropped on tab/browser close. An
// idle timestamp caps the plaintext-exposure window (same as the EVM burner).

const SESSION_KEY = "devstation-solana-burner-session-v1";
const ACTIVITY_KEY = "devstation-solana-burner-activity-v1";
export const IDLE_LOCK_MS = 20 * 60 * 1000; // 20 minutes

export function saveSolanaSession(secretB64: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(SESSION_KEY, secretB64);
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export function touchSolanaSession(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (!sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function isSolanaSessionIdle(): boolean {
  try {
    if (typeof sessionStorage === "undefined") return false;
    if (!sessionStorage.getItem(SESSION_KEY)) return false;
    const touchedAt = Number(sessionStorage.getItem(ACTIVITY_KEY) ?? 0);
    return !touchedAt || Date.now() - touchedAt > IDLE_LOCK_MS;
  } catch {
    return false;
  }
}

export function loadSolanaSession(): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const secret = sessionStorage.getItem(SESSION_KEY);
    if (!secret) return null;
    if (isSolanaSessionIdle()) {
      clearSolanaSession();
      return null;
    }
    return secret;
  } catch {
    return null;
  }
}

export function clearSolanaSession(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(ACTIVITY_KEY);
  } catch {
    /* ignore */
  }
}
