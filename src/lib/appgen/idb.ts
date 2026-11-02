// A key-value store in IndexedDB, for what is too big for localStorage.
//
// localStorage holds about 5 MB per site, and a few projects with their builds
// and screenshots fill it; IndexedDB holds hundreds of megabytes, and takes
// objects as they are, without JSON. Every call fails soft: a browser without
// it (or a private window that refuses it) gets `false` / `undefined`, and the
// caller falls back.

const DB = "devstation";
const STORE = "kv";

let opening: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB could not open."));
      req.onblocked = () => reject(new Error("IndexedDB is blocked."));
    }).catch((error) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = act(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB failed."));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB aborted."));
      }),
  );
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  if (!idbAvailable()) return undefined;
  try {
    return (await run("readonly", (s) => s.get(key))) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  if (!idbAvailable()) return false;
  try {
    await run("readwrite", (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

/** Whether IndexedDB works here: opens, writes and reads back. */
export async function idbWorks(): Promise<boolean> {
  if (!idbAvailable()) return false;
  const ok = await idbSet("__probe", 1);
  return ok && (await idbGet<number>("__probe")) === 1;
}
