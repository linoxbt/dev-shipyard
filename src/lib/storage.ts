// localStorage persistence so deployments and inspection history survive a
// page refresh. SSR-safe: every access is guarded for the absence of `window`.

const KEYS = {
  projects: "devstation-projects-v1",
  inspections: "devstation-inspections-v1",
} as const;

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
};
