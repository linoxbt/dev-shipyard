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
}

const SEED: DeployedProject[] = [
  {
    id: "p1",
    name: "QIE Builder Token",
    templateId: "simple-erc20",
    templateName: "SimpleERC20",
    address: "0x4B2a8c2FbB3a2cC5F6e7d2B91A4d8e7C5b3F1a92",
    txHash: "0x7c3e9a4b8f2d1c5e6a9b8c7d4e5f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f",
    blockNumber: 4_318_201,
    deployedAt: Date.now() - 1000 * 60 * 60 * 3,
    status: "VERIFIED",
    constructorArgs: { name_: "QIE Builder Token", symbol_: "QBT", initialSupply_: "1000000" },
  },
  {
    id: "p2",
    name: "Genesis Pass",
    templateId: "simple-erc721",
    templateName: "SimpleERC721",
    address: "0x9a3F1c2D4e5B6a7C8d9E0f1A2b3C4d5E6f7A8b9C",
    txHash: "0xa1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
    blockNumber: 4_318_154,
    deployedAt: Date.now() - 1000 * 60 * 60 * 24,
    status: "VERIFIED",
    constructorArgs: {
      name_: "Genesis Pass",
      symbol_: "GPASS",
      baseURI_: "ipfs://bafy.../",
      maxSupply_: "10000",
    },
  },
  {
    id: "p3",
    name: "Team Vault",
    templateId: "multisig-wallet",
    templateName: "MultiSigWallet",
    address: "0x2D4f5E6a7B8c9D0e1F2a3B4c5D6e7F8a9B0c1D2e",
    txHash: "0xb2c3d4e5f6a7890123456789abcdef0123456789abcdef0123456789abcdef01",
    blockNumber: 4_317_902,
    deployedAt: Date.now() - 1000 * 60 * 60 * 48,
    status: "PENDING",
    constructorArgs: {
      _owners:
        "0x742d35Cc6634C0532925a3b844Bc9e7595f7E8aB,0x4B2a8c2FbB3a2cC5F6e7d2B91A4d8e7C5b3F1a92",
      _required: "2",
    },
  },
];

interface ProjectsState {
  projects: DeployedProject[];
  add: (p: DeployedProject) => void;
  remove: (id: string) => void;
  hydrated: boolean;
  /** Load persisted deployments on the client (call once after mount). */
  hydrate: () => void;
}

// SSR starts from the deterministic SEED set; the client replaces it with
// persisted data in hydrate() to avoid hydration mismatches.
export const useProjects = create<ProjectsState>((set) => ({
  projects: SEED,
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
