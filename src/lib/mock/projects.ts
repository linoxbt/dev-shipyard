import { create } from "zustand";
import { storage } from "@/lib/storage";

export interface DeployedProject {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  address: string;
  txHash: string;
  blockNumber: number;
  deployedAt: number; // ms
  status: "VERIFIED" | "PENDING" | "FAILED";
  constructorArgs: Record<string, string>;
  /** Compiled ABI, when available (local deployments) — powers the Interact panel. */
  abi?: unknown[];
  chainId?: number;
}

interface ProjectsState {
  projects: DeployedProject[];
  add: (p: DeployedProject) => void;
  remove: (id: string) => void;
  hydrated: boolean;
  /** Load persisted deployments on the client (call once after mount). */
  hydrate: () => void;
}

// No seed data — projects come only from the user's real deployments
// (persisted to localStorage) and the on-chain ProjectRegistry. SSR starts
// empty; the client hydrates from storage to avoid hydration mismatches.
export const useProjects = create<ProjectsState>((set) => ({
  projects: [],
  hydrated: false,
  hydrate: () =>
    set(() => {
      const stored = storage.loadProjects();
      return stored.length
        ? { projects: stored as DeployedProject[], hydrated: true }
        : { hydrated: true };
    }),
  add: (p) =>
    set((s) => {
      const next = [p, ...s.projects];
      storage.saveProjects(next);
      return { projects: next };
    }),
  remove: (id) =>
    set((s) => {
      const next = s.projects.filter((x) => x.id !== id);
      storage.saveProjects(next);
      return { projects: next };
    }),
}));
