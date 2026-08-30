// Session persistence for the in-app generated ("burner") wallet.
//
// The wallet must survive a browser close, not just a refresh, so the unlocked
// mnemonic has to reach disk. It is NOT written in plaintext: it is encrypted
// with AES-GCM under a key that lives in IndexedDB and is created
// `extractable: false`, so script can ask the key to decrypt but can never read
// the key itself out of the browser.
//
// What that does and does not buy:
//   - No plaintext seed phrase at rest. Copying localStorage off the machine
//     yields ciphertext and nothing else.
//   - The key cannot be exfiltrated, so it cannot be replayed elsewhere.
//   - It does NOT stop script running on this origin from asking the key to
//     decrypt while the session is live. XSS on the page can still reach the
//     mnemonic. The unlock window is the mitigation, which is why it is capped
//     and why the shortest usable value is the right default.
//
// The encrypted vault in localStorage remains the durable, at-rest store; this
// is only the "already unlocked" shortcut.

const BLOB_KEY = "devstation-burner-session-v2";
const DB_NAME = "devstation-wallet";
const STORE = "keys";
const KEY_ID = "session-key";

/** How long the wallet stays unlocked with no activity. Offered in settings. */
export const UNLOCK_OPTIONS = [
  { label: "5 minutes", ms: 5 * 60 * 1000 },
  { label: "30 minutes", ms: 30 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "5 hours", ms: 5 * 60 * 60 * 1000 },
  { label: "1 day", ms: 24 * 60 * 60 * 1000 },
] as const;

const UNLOCK_PREF_KEY = "devstation-burner-unlock-ms";
/** Deliberately the shortest option: this is how long a stolen tab stays
 *  useful, so a longer window is a choice the user makes, not a default. */
export const DEFAULT_UNLOCK_MS = UNLOCK_OPTIONS[0].ms;

export function getUnlockMs(): number {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_UNLOCK_MS;
    const raw = Number(localStorage.getItem(UNLOCK_PREF_KEY));
    return UNLOCK_OPTIONS.some((o) => o.ms === raw) ? raw : DEFAULT_UNLOCK_MS;
  } catch {
    return DEFAULT_UNLOCK_MS;
  }
}

export function setUnlockMs(ms: number): void {
  try {
    if (!UNLOCK_OPTIONS.some((o) => o.ms === ms)) return;
    localStorage.setItem(UNLOCK_PREF_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

// --- the non-extractable device key ---------------------------------------

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<CryptoKey | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CryptoKey) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPut(db: IDBDatabase, key: string, value: CryptoKey): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** The device key, created on first use. `extractable: false` is the whole
 *  point: the browser will use it but will not hand it back. */
async function deviceKey(create: boolean): Promise<CryptoKey | null> {
  const db = await idb();
  if (!db) return null;
  const existing = await idbGet(db, KEY_ID);
  if (existing) return existing;
  if (!create) return null;
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await idbPut(db, KEY_ID, key);
    return key;
  } catch {
    return null;
  }
}

interface SessionBlob {
  ct: string;
  iv: string;
  /** Absolute ms. Pushed forward by touchBurnerSession on activity. */
  expiresAt: number;
}

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function readBlob(): SessionBlob | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(BLOB_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as SessionBlob;
    return typeof b?.ct === "string" && typeof b?.iv === "string" ? b : null;
  } catch {
    return null;
  }
}

export async function saveBurnerSession(mnemonic: string): Promise<void> {
  try {
    const key = await deviceKey(true);
    if (!key) return; // no IndexedDB: refuse rather than fall back to plaintext
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(mnemonic),
    );
    const blob: SessionBlob = {
      ct: b64(ct),
      iv: b64(iv.buffer),
      expiresAt: Date.now() + getUnlockMs(),
    };
    localStorage.setItem(BLOB_KEY, JSON.stringify(blob));
  } catch {
    /* a failure here means the user re-enters their password, which is safe */
  }
}

/** Bumps the unlock window. Cheap no-op when nothing is unlocked. */
export function touchBurnerSession(): void {
  const blob = readBlob();
  if (!blob) return;
  if (blob.expiresAt <= Date.now()) return;
  try {
    localStorage.setItem(
      BLOB_KEY,
      JSON.stringify({ ...blob, expiresAt: Date.now() + getUnlockMs() }),
    );
  } catch {
    /* ignore */
  }
}

export function isBurnerSessionIdle(): boolean {
  const blob = readBlob();
  return !!blob && blob.expiresAt <= Date.now();
}

/** True when something is stored, without decrypting it. Lets callers skip the
 *  async work when there is plainly nothing to restore. */
export function hasBurnerSession(): boolean {
  const blob = readBlob();
  return !!blob && blob.expiresAt > Date.now();
}

export async function loadBurnerSession(): Promise<string | null> {
  const blob = readBlob();
  if (!blob) return null;
  if (blob.expiresAt <= Date.now()) {
    clearBurnerSession();
    return null;
  }
  try {
    const key = await deviceKey(false);
    if (!key) {
      // The key is gone (cleared site data, different profile). The ciphertext
      // is now undecryptable, so it is dead weight.
      clearBurnerSession();
      return null;
    }
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(blob.iv) },
      key,
      unb64(blob.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    clearBurnerSession();
    return null;
  }
}

export function clearBurnerSession(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(BLOB_KEY);
    // v1 kept the plaintext mnemonic in sessionStorage. Anyone upgrading may
    // still have one sitting there; remove it rather than leave it behind.
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("devstation-burner-session-v1");
      sessionStorage.removeItem("devstation-burner-activity-v1");
    }
  } catch {
    /* ignore */
  }
}
