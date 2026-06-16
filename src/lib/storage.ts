// localStorage persistence so deployments and inspection history survive a
// page refresh. SSR-safe: every access is guarded for the absence of `window`.

const KEYS = {
  projects: "devstation-projects-v1",
  inspections: "devstation-inspections-v1",
  searches: "devstation-explorer-searches-v1",
} as const;

/** A recent explorer search the user ran (address, tx, or block), persisted so
 *  the SearchBar can offer it again on focus — Etherscan-style. For addresses we
 *  remember the resolved name (contract/token) once the detail page loads it. */
export interface SearchEntry {
  /** The raw query: an address, a tx hash, or a block number. */
  query: string;
  /** "address" | "tx" | "block" — drives the icon and the link target. */
  kind: "address" | "tx" | "block";
  /** Network the search ran on ("testnet" | "mainnet"). */
  network: string;
  /** Resolved label for an address/contract (e.g. token name), when known. */
  name?: string;
  /** Whether the address is a contract (shows a code icon). */
  isContract?: boolean;
  /** When it was last searched (epoch ms), for ordering. */
  ts: number;
}

const MAX_SEARCHES = 12;

export interface StoredProject {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  address: string;
  txHash: string;
  blockNumber: number;
  deployedAt: number;
  status: "VERIFIED" | "PENDING" | "FAILED";
  constructorArgs: Record<string, string>;
  chainId?: number;
  imageUrl?: string;
  /** Compiled ABI, stored so the Projects page can offer contract interaction. */
  abi?: unknown[];
  /** Lowercased wallet address that deployed this, so Projects can scope to the
   *  connected wallet. Absent on legacy records (pre-per-wallet). */
  deployer?: string;
  // ── Source-verification metadata, stored so the Projects page can (re)verify
  //    a deployment later via the robust standard-input path. Absent on legacy
  //    records, which fall back to the manual "paste source" flow. ──
  /** Exact solc standard-JSON the contract was compiled with. */
  standardJsonInput?: string;
  /** Fully-qualified contract name "File.sol:Name". */
  qualifiedName?: string;
  /** solc version used (e.g. "0.8.20"). */
  compilerVersion?: string;
  /** ABI-encoded constructor args (0x, no selector), for explicit verification. */
  constructorArgsEncoded?: string;
}

function hasWindow() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function read<T>(key: string, fallback: T): T {
  if (!hasWindow()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (!hasWindow()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

export const storage = {
  loadProjects(): StoredProject[] {
    return read<StoredProject[]>(KEYS.projects, []);
  },
  saveProjects(projects: StoredProject[]) {
    write(KEYS.projects, projects);
  },
  clearProjects() {
    if (hasWindow()) localStorage.removeItem(KEYS.projects);
  },

  loadInspections(): string[] {
    return read<string[]>(KEYS.inspections, []);
  },
  addInspection(txHash: string) {
    const existing = this.loadInspections().filter((h) => h !== txHash);
    write(KEYS.inspections, [txHash, ...existing].slice(0, 20));
  },
  clearInspections() {
    if (hasWindow()) localStorage.removeItem(KEYS.inspections);
  },

  loadSearches(): SearchEntry[] {
    return read<SearchEntry[]>(KEYS.searches, []);
  },
  // Record a search, de-duped per (network, query). Newest first, capped.
  addSearch(entry: Omit<SearchEntry, "ts">) {
    const q = entry.query.trim();
    if (!q) return;
    const key = `${entry.network}:${q.toLowerCase()}`;
    const existing = this.loadSearches().filter(
      (s) => `${s.network}:${s.query.toLowerCase()}` !== key,
    );
    write(
      KEYS.searches,
      [{ ...entry, query: q, ts: Date.now() }, ...existing].slice(0, MAX_SEARCHES),
    );
  },
  // Attach/refresh the resolved name + contract flag for an address search,
  // once the address detail page has loaded it.
  updateSearchName(network: string, query: string, name: string | undefined, isContract?: boolean) {
    const key = `${network}:${query.toLowerCase()}`;
    const list = this.loadSearches();
    let changed = false;
    for (const s of list) {
      if (`${s.network}:${s.query.toLowerCase()}` === key) {
        if (name && s.name !== name) {
          s.name = name;
          changed = true;
        }
        if (isContract != null && s.isContract !== isContract) {
          s.isContract = isContract;
          changed = true;
        }
      }
    }
    if (changed) write(KEYS.searches, list);
  },
  clearSearches() {
    if (hasWindow()) localStorage.removeItem(KEYS.searches);
  },
};
